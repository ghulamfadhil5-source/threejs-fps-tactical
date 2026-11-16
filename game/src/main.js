// Ashfall Yard — boot and the one loop. A fixed 60 Hz simulation (sim.js + bots +
// player + grenades) feeds a render at the display's rate; rendering never writes
// game state. ?shot=start|play|site|end with &seed=N stages a deterministic frame
// for a capture, renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { MAP, createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS, GRENADE_DAMAGE, GRENADE_RADIUS } from './weapons.js';
import { createBots } from './bots.js';
import { createSim, PLANT_TIME } from './sim.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const sim = createSim();
const audio = createAudio();
const hud = createHud();
const player = createPlayer(map.colliders, MAP.attackerSpawn);
const rig = createWeaponRig(camera);
rig.equip('kestrel'); // show the starting rifle's view model from the first frame
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const shootables = map.shootables.slice();
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

let hp = 100;
let playerAlive = true;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let buyOpen = true;
let noise = null; // last gunshot {pos, time} — bots hear it

// --- Grenades: thrown spheres with gravity, a ground bounce and a timed blast. ---
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), roughness: 0.4, metalness: 0.4 });
function throwGrenade() {
  if (rig.state.grenades <= 0 || !playerAlive) return;
  rig.state.grenades -= 1;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  mesh.position.copy(camera.position);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: direction.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 1.7,
  });
  audio.shot('hornet');
}
function explodeGrenade(g) {
  const pos = g.mesh.position;
  const flash = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 60, 18);
  flash.position.copy(pos);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 180);
  audio.explosion();
  const pd = Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z);
  if (playerAlive && pd < GRENADE_RADIUS) hurtPlayer(Math.round(GRENADE_DAMAGE * (1 - pd / GRENADE_RADIUS)) + 15, null);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const bd = Math.hypot(bot.position.x - pos.x, bot.position.z - pos.z);
    if (bd < GRENADE_RADIUS) {
      const killed = bots.damage(bot, Math.round(GRENADE_DAMAGE * (1 - bd / GRENADE_RADIUS)) + 15, true);
      if (killed) hud.feed(`Your frag took down a ${bot.team === 'enemy' ? 'defender' : 'teammate'}.`);
    }
  }
  scene.remove(g.mesh);
}
function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 13 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    if (g.mesh.position.y < 0.12) {
      g.mesh.position.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.4;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
}

// --- Tracers: a small pool of fading lines, reused so shooting allocates nothing. ---
const tracers = [];
for (let i = 0; i < 10; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0 });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function spawnTracer(from, to, colour) {
  let best = tracers[0];
  for (const t of tracers) if (t.life <= 0) { best = t; break; }
  const pos = best.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  best.line.material.color.set(colour);
  best.life = 0.09;
}
function stepTracers(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
  }
}

// --- Bots, wired to the world through callbacks. ---
const bots = createBots(scene, map.colliders, map.shootables, {
  random,
  onShoot(origin, end, team) {
    spawnTracer(origin, end, team === 'enemy' ? PALETTE.enemy : PALETTE.accent);
    audio.enemyShot(origin.distanceTo(camera.position));
    noise = { pos: origin.clone(), time: elapsed };
  },
  onDamagePlayer(amount) { hurtPlayer(amount); },
  onKill(bot) {
    sim.addKillReward();
    hud.feed(`You eliminated a defender  +$300`);
    audio.kill();
  },
});
shootables.push(...bots.hitMeshes);

function hurtPlayer(amount) {
  if (!playerAlive) return;
  hp -= amount;
  audio.hurt();
  if (hp <= 0) {
    hp = 0;
    playerAlive = false;
    sim.state.deaths += 1;
    hud.feed('You were eliminated.');
    hud.banner('ELIMINATED', 2000);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function playerSite() {
  const p = player.state.position;
  for (const key of ['A', 'B']) {
    const s = MAP.sites[key];
    if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) return key;
  }
  return null;
}

function resetRound() {
  player.reset(MAP.attackerSpawn);
  hp = 100;
  playerAlive = true;
  bots.reset(sim.state.round);
  rig.refillAmmo();
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  noise = null;
  buyOpen = true;
  hud.showBuy(true);
}

const ctx = {
  playerSite: null,
  enemiesAlive: 4,
  alliesAlive: 2,
  playerDead: false,
  defuseProgress: 0,
  bombPlanted: false,
  bombPos: null,
  noise: null,
  onRoundStart(round) {
    resetRound();
    hud.banner(`ROUND ${round} — BUY PHASE`, 2200);
    hud.showOverlay('start', 0);
    if (!shot) input.requestLock();
  },
  onBombExploded(pos) {
    audio.explosion();
    hud.banner('SITE DESTROYED', 3000);
  },
  onPlanted(pos) {
    audio.plant();
    hud.banner('CHARGE PLANTED — DEFEND IT', 3000);
  },
};

function shoot(spread) {
  if (!rig.takeRound()) {
    audio.dry();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const muzzle = camera.position.clone().addScaledVector(direction, 0.6);
  const end = hit ? hit.point.clone() : camera.position.clone().addScaledVector(direction, 60);
  spawnTracer(muzzle, end, PALETTE.hazard);
  rig.pullTrigger();
  player.recoil(rig.def().kick * (0.8 + random() * 0.4), (random() * 2 - 1) * 0.004);
  audio.shot(rig.state.id);
  noise = { pos: player.state.position.clone(), time: elapsed };
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const isHead = hit.object.userData.part === 'head';
    const dmg = Math.round(rig.def().damage * (isHead ? rig.def().headMul : 1));
    const killed = bots.damage(bot, dmg, true);
    hud.hitMarker(killed, shot ? 4000 : 90);
    audio.hit();
    if (!killed) hud.feed(isHead ? `Headshot — ${dmg} damage` : `Hit — ${dmg} damage`);
    else hud.feed(isHead ? 'Headshot elimination!' : 'Elimination!');
  }
  hud.setAmmo(rig.state.mag, rig.state.reserve, rig.def().name, rig.state.grenades);
  return true;
}

function syncCamera() {
  const body = player.state;
  const eye = playerAlive ? body.eye : 0.5;
  camera.position.set(body.position.x, body.position.y + eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  ctx.playerSite = playerSite();
  ctx.enemiesAlive = bots.aliveCount('enemy');
  ctx.alliesAlive = bots.aliveCount('ally');
  ctx.playerDead = !playerAlive;
  ctx.defuseProgress = sim.state.defuseProgress;
  ctx.bombPlanted = sim.state.bombPlanted;
  ctx.bombPos = sim.state.bombPos;
  ctx.noise = noise;
  sim.state.planting = playerAlive && input.state.keys.has('KeyE') && sim.state.phase === 'live';
  const prevPhase = sim.state.phase;
  sim.step(dt, ctx);
  if (sim.state.phase !== prevPhase && sim.state.phase === 'roundEnd') {
    const won = sim.state.winner === 'us';
    if (won) audio.roundWin(); else audio.roundLose();
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', 2600);
  }
  if (playerAlive) player.step(dt, input.state.keys);
  rig.step(dt);
  const botCtx = {
    time: elapsed,
    playerPos: player.state.position,
    playerAlive,
    playerCrouch: player.state.crouching,
    playerSpeed: player.groundSpeed(),
    playerHp: hp,
    bombPlanted: sim.state.bombPlanted,
    bombPos: sim.state.bombPos ? new THREE.Vector3(sim.state.bombPos.x, 0, sim.state.bombPos.z) : null,
    noise,
    defuseProgress: sim.state.defuseProgress,
  };
  bots.step(dt, botCtx);
  // A defender bot channels the defuse onto this shared field; carry it back.
  sim.state.defuseProgress = botCtx.defuseProgress || 0;
  stepGrenades(dt);
  stepTracers(dt);
}

function pushHud() {
  const s = sim.state;
  hud.setAmmo(rig.state.mag, rig.state.reserve, rig.def().name, rig.state.grenades);
  hud.setHealth(hp);
  hud.setMoney(s.money);
  hud.setTimer(s.roundTime, s.phase);
  hud.setScore(s.scoreUs, s.scoreThem);
  hud.setRound(s.round);
  hud.setBomb(
    s.bombPlanted ? `CHARGE LIVE AT SITE ${s.bombSite} — ${Math.max(0, Math.ceil(s.bombTimer))}s` :
    s.bombCarrier ? 'CARRY THE CHARGE TO SITE A OR B — HOLD E ON A SITE' : 'CHARGE PLANTED',
    s.bombPlanted,
  );
  hud.setPlant(s.plantProgress > 0 ? s.plantProgress : (s.defuseProgress > 0 ? s.defuseProgress : 0),
    s.plantProgress > 0 ? 'PLANTING THE CHARGE…' : 'DEFUSE IN PROGRESS!');
  hud.setCrosshairGap(2 + player.groundSpeed() * 1.6 + rig.state.heat * 6);
  hud.showBuy(s.phase === 'buy' && buyOpen && !shot);
}

function buyWeapon(id) {
  const def = sim.buy(id);
  if (!def) { hud.feed('Not enough money.'); return; }
  rig.equip(id);
  audio.buy();
  hud.feed(`Bought ${def.name} for $${def.price}.`);
  pushHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAlive) player.look(look.x, look.y);
    // Edge-triggered keys.
    if (input.wasPressed('KeyR') && rig.reload()) audio.reload();
    if (input.wasPressed('KeyG')) throwGrenade();
    if (input.wasPressed('KeyB')) { buyOpen = !buyOpen; }
    if (sim.state.phase === 'buy') {
      if (input.wasPressed('Digit1')) buyWeapon('kestrel');
      if (input.wasPressed('Digit2')) buyWeapon('hornet');
      if (input.wasPressed('Digit3')) buyWeapon('longshot');
      if (input.wasPressed('Digit4')) {
        if (sim.buyGrenade()) { rig.state.grenades += 1; audio.buy(); hud.feed('Bought a Spark frag grenade.'); }
        else hud.feed('Not enough money for a grenade.');
      }
    }
    if (input.state.firing && playerAlive && sim.state.phase === 'live' && rig.ready()) {
      shoot(rig.spread(player.groundSpeed()));
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    pushHud();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (sim.state.phase === 'live' || sim.state.phase === 'buy') {
    if (playerAlive) hud.showOverlay('paused', 0);
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (sim.state.phase === 'menu') {
    sim.startMatch();
    resetRound();
    hud.banner('ROUND 1 — BUY PHASE', 2200);
    input.requestLock();
  } else if (sim.state.phase === 'roundEnd') {
    sim.state.roundTime = 0.05; // skip the wait, advance now
  } else if (sim.state.matchOver) {
    sim.startMatch();
    resetRound();
    input.requestLock();
  } else {
    input.requestLock();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Deterministic staging for screenshots (no pointer lock needed). ---
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    sim.state.phase = 'menu';
    player.state.position.set(0, 0, 14.5);
    player.state.yaw = Math.PI - 0.35;
    player.state.pitch = -0.04;
    settle(10);
    syncCamera();
    // Let the yard show through around the menu panel for the cover shot.
    document.getElementById('overlay').style.background = 'rgba(42,33,26,0.35)';
    hud.showOverlay('start', 0);
    pushHud();
  } else if (name === 'play') {
    sim.startMatch();
    resetRound();
    sim.beginLive();
    sim.state.roundTime = 87;
    player.state.position.set(-6, 0, 4);
    player.state.yaw = Math.PI - 0.08;
    player.state.pitch = 0.02;
    settle(30);
    // Walk the enemies into mid and trade fire with the nearest one, down a
    // clear west lane (the furnace block hides the centre lane).
    const foe = bots.bots.find((b) => b.team === 'enemy' && b.alive);
    foe.position.set(-6.5, 0, -6);
    foe.group.position.copy(foe.position);
    foe.yaw = 0;
    const ally = bots.bots.find((b) => b.team === 'ally' && b.alive);
    ally.position.set(-9, 0, 7);
    ally.group.position.copy(ally.position);
    aimAt(new THREE.Vector3(foe.position.x, 1.3, foe.position.z));
    shoot(0);
    settle(6);
    aimAt(new THREE.Vector3(foe.position.x, 1.0, foe.position.z));
    shoot(0);
    settle(4);
    syncCamera();
    pushHud();
  } else if (name === 'site') {
    sim.startMatch();
    resetRound();
    sim.beginLive();
    sim.state.roundTime = 64;
    sim.state.bombPlanted = true;
    sim.state.bombSite = 'A';
    sim.state.bombPos = { x: MAP.sites.A.x, z: MAP.sites.A.z };
    sim.state.bombTimer = 28;
    sim.state.bombCarrier = false;
    player.state.position.set(-11, 0, -6);
    player.state.yaw = Math.PI + 0.5;
    player.state.pitch = 0.01;
    const foe = bots.bots.find((b) => b.team === 'enemy' && b.alive);
    foe.position.set(-14, 0, -9);
    foe.group.position.copy(foe.position);
    foe.yaw = Math.PI * 0.75;
    settle(20);
    syncCamera();
    hud.banner('CHARGE PLANTED — DEFEND SITE A', 4000);
    pushHud();
  } else { // end
    sim.startMatch();
    sim.state.scoreUs = 1; // endRound() adds the winning round: 1 -> 2, matching the copy
    sim.state.scoreThem = 1;
    sim.state.round = 3;
    sim.endRound('us', 'Enemy team eliminated. You take Round 3 — 2 to 1.');
    resetRound();
    player.state.position.set(0, 0, 10);
    player.state.yaw = Math.PI;
    settle(10);
    syncCamera();
    hud.showOverlay('end', 'Enemy team eliminated. You take Round 3 — 2 to 1.');
    pushHud();
  }
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }());
}

window.__ashfall = { sim, player, bots, rig, input, get hp() { return hp; }, get alive() { return playerAlive; } };

syncCamera();
pushHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
