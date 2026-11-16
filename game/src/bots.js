// Bots: two teams of simple soldiers. Defenders hold the sites and patrol mid;
// attackers push a lane toward a site, rotate when the bomb is planted, and one of
// them defuses. Each bot runs the same loop: pick a goal, walk the waypoint graph
// toward it, look for the enemy, and when it sees one, stop, aim and fire in
// bursts. They hear gunfire nearby and investigate it, and they miss more against
// a moving, crouched target — the same rules that punish the player.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS } from './map.js';
import { makeMover } from './mover.js';

const BOT_SPEED = 3.4;
const BOT_HEIGHT = 1.72;
const RADIUS = 0.34;
const SEE_DIST = 30;
const SEE_HALF_ANGLE = 1.05;
const HEAR_DIST = 20;

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const d = (WAYPOINTS[i].x - x) ** 2 + (WAYPOINTS[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function nextNode(from, goal, random) {
  const here = WAYPOINTS[from];
  let best = from;
  let bestD = Infinity;
  for (const n of here.n) {
    const d = (WAYPOINTS[n].x - WAYPOINTS[goal].x) ** 2 + (WAYPOINTS[n].z - WAYPOINTS[goal].z) ** 2;
    const jitter = random() * 4;
    if (d + jitter < bestD) { bestD = d + jitter; best = n; }
  }
  return best;
}

export function createBots(scene, colliders, shootables, opts) {
  const { random, onShoot, onDamagePlayer, onKill } = opts;
  const mover = makeMover(colliders, RADIUS, BOT_HEIGHT);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 40;
  const losDir = new THREE.Vector3();
  const bots = [];
  const hitMeshes = [];

  const enemyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.65 });
  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.65 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#33302a'), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.54, 0.8, 0.32);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.62);

  function buildBot(team, x, z, role) {
    const group = new THREE.Group();
    const mat = team === 'enemy' ? enemyMat : allyMat;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.02;
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9b48f'), roughness: 0.7 }));
    head.position.y = 1.58;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), darkMat);
    visor.position.set(0, 1.6, -0.15);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.14, 0.38, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.14, 0.38, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    group.position.set(x, 0, z);
    scene.add(group);
    const bot = {
      team, role, group, torso, head, gun, legL, legR,
      position: new THREE.Vector3(x, 0, z),
      velocity: new THREE.Vector3(),
      yaw: 0, hp: 100, alive: true, fall: 0,
      node: nearestNode(x, z), goalNode: 0, repathAt: 0,
      state: 'hold', holdPos: new THREE.Vector3(x, 0, z),
      lastSeen: null, lastSeenAt: -99, hearPos: null, hearAt: -99,
      burstLeft: 0, fireAt: 0, nextBurstAt: 1 + random() * 2,
      strafeDir: 1, strafeAt: 0, defuseAt: 0, walkPhase: random() * 6,
      target: null,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  // 4 defenders: two hold the sites, two patrol mid. 2 allies push with the player.
  buildBot('enemy', -16, -13, 'holdA');
  buildBot('enemy', 16, -13, 'holdB');
  buildBot('enemy', -2, -4, 'patrol');
  buildBot('enemy', 4, 6, 'patrol');
  buildBot('ally', -3, 13, 'push');
  buildBot('ally', 3, 13, 'push');

  function hasLOS(from, to) {
    losDir.copy(to).sub(from);
    const dist = losDir.length();
    if (dist < 0.1) return true;
    losDir.normalize();
    raycaster.set(from, losDir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(shootables, false)[0];
    return !hit || hit.distance > dist - 0.6;
  }

  function eyeOf(bot) {
    return new THREE.Vector3(bot.position.x, bot.position.y + 1.5, bot.position.z);
  }

  function damage(bot, amount, byPlayer) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp > 0) {
      // Being shot reveals the shooter: the bot turns to investigate.
      bot.hearAt = 99;
      return false;
    }
    bot.alive = false;
    bot.hp = 0;
    bot.fall = 0;
    if (byPlayer) onKill(bot);
    return true;
  }

  function pickGoal(bot, ctx) {
    if (bot.team === 'enemy') {
      if (ctx.bombPlanted) {
        // Defenders converge on the planted bomb; the closest one defuses.
        return nearestNode(ctx.bombPos.x, ctx.bombPos.z);
      }
      if (bot.role === 'holdA') return 9;
      if (bot.role === 'holdB') return 13;
      return 7; // patrol the furnace hall
    }
    // Allies push the site the player is nearest to, or mid if undecided.
    const siteA = (bot.position.x + 16) ** 2 + (bot.position.z + 11) ** 2;
    const siteB = (bot.position.x - 16) ** 2 + (bot.position.z + 11) ** 2;
    if (ctx.bombPlanted) return nearestNode(ctx.bombPos.x, ctx.bombPos.z);
    return siteA < siteB ? 9 : 13;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.45);
      bot.group.rotation.x = -bot.fall * 1.5;
      bot.group.position.y = -bot.fall * 0.12;
      return;
    }
    const now = ctx.time;
    // --- Sense: find the nearest living enemy in view. ---
    let foe = null;
    let foeDist = Infinity;
    const foes = bot.team === 'enemy'
      ? [{ pos: ctx.playerPos, alive: ctx.playerAlive, crouch: ctx.playerCrouch, speed: ctx.playerSpeed, isPlayer: true, hp: ctx.playerHp }]
      : [];
    // Allies and enemies both also see opposing bots.
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      foes.push({ pos: other.position, alive: true, crouch: false, speed: Math.hypot(other.velocity.x, other.velocity.z), isPlayer: false, bot: other, hp: other.hp });
    }
    const eye = eyeOf(bot);
    for (const f of foes) {
      if (!f.alive) continue;
      const target = new THREE.Vector3(f.pos.x, f.pos.y + (f.crouch ? 1.0 : 1.35), f.pos.z);
      const d = eye.distanceTo(target);
      if (d > SEE_DIST) continue;
      const ang = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
      let dyaw = ang - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(dyaw) > SEE_HALF_ANGLE && d > 4) continue;
      if (!hasLOS(eye, target)) continue;
      if (d < foeDist) { foeDist = d; foe = f; }
    }
    bot.target = foe;
    if (foe) {
      bot.lastSeen = new THREE.Vector3(foe.pos.x, 0, foe.pos.z);
      bot.lastSeenAt = now;
    }
    // Hearing: a recent gunshot within range pulls the bot toward it.
    if (ctx.noise && now - ctx.noise.time < 1.2) {
      const nd = bot.position.distanceTo(ctx.noise.pos);
      if (nd < HEAR_DIST) {
        bot.hearPos = ctx.noise.pos.clone();
        bot.hearAt = now;
      }
    }

    // --- Decide: engage, defuse, or walk. ---
    let moveTarget = null;
    let speed = BOT_SPEED;
    if (foe) {
      // Face the foe; strafe sideways while firing in bursts.
      const ang = Math.atan2(-(foe.pos.x - bot.position.x), -(foe.pos.z - bot.position.z));
      bot.yaw = ang;
      if (now > bot.strafeAt) { bot.strafeDir *= -1; bot.strafeAt = now + 0.7 + random() * 0.8; }
      const side = new THREE.Vector3(Math.cos(bot.yaw), 0, -Math.sin(bot.yaw)).multiplyScalar(bot.strafeDir * 1.6);
      bot.velocity.x = side.x;
      bot.velocity.z = side.z;
      if (now >= bot.nextBurstAt) {
        bot.burstLeft = 3 + Math.floor(random() * 3);
        bot.nextBurstAt = now + 0.9 + random() * 0.7;
      }
      if (bot.burstLeft > 0 && now >= bot.fireAt) {
        bot.fireAt = now + 0.13;
        bot.burstLeft -= 1;
        fireAt(bot, foe, foeDist, ctx);
      }
    } else {
      // Defuse: an enemy bot standing on the planted bomb channels the defuse.
      if (bot.team === 'enemy' && ctx.bombPlanted) {
        const bd = Math.hypot(bot.position.x - ctx.bombPos.x, bot.position.z - ctx.bombPos.z);
        if (bd < 1.6) {
          if (bot.defuseAt === 0) bot.defuseAt = now;
          ctx.defuseProgress = Math.max(ctx.defuseProgress || 0, (now - bot.defuseAt) / 5);
          bot.velocity.set(0, 0, 0);
          return;
        }
        bot.defuseAt = 0;
      }
      if (now >= bot.repathAt) {
        bot.repathAt = now + 1.4;
        bot.goalNode = pickGoal(bot, ctx);
        if (bot.role === 'holdA' || bot.role === 'holdB') {
          // Holders stay near their site unless the bomb is planted or they heard a shot.
          const heard = bot.hearPos && now - bot.hearAt < 4;
          const seen = bot.lastSeen && now - bot.lastSeenAt < 4;
          if (!ctx.bombPlanted && !heard && !seen) {
            moveTarget = bot.holdPos;
          }
        }
        if (!moveTarget) {
          const dest = bot.hearPos && now - bot.hearAt < 4
            ? nearestNode(bot.hearPos.x, bot.hearPos.z)
            : bot.goalNode;
          if (bot.node === dest) bot.node = nextNode(bot.node, dest, random);
          else bot.node = nextNode(bot.node, dest, random);
          moveTarget = new THREE.Vector3(WAYPOINTS[bot.node].x, 0, WAYPOINTS[bot.node].z);
        }
      } else {
        moveTarget = new THREE.Vector3(WAYPOINTS[bot.node].x, 0, WAYPOINTS[bot.node].z);
        if (bot.hearPos && now - bot.hearAt < 4) moveTarget = bot.hearPos;
      }
      if (moveTarget) {
        const dx = moveTarget.x - bot.position.x;
        const dz = moveTarget.z - bot.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.6) {
          bot.yaw = Math.atan2(-dx, -dz);
          bot.velocity.x = (dx / d) * speed;
          bot.velocity.z = (dz / d) * speed;
        } else {
          bot.velocity.x = 0;
          bot.velocity.z = 0;
          if (bot.role === 'patrol' && bot.node === 7) {
            // Patrolling bots pause and scan at the hall.
            bot.yaw += dt * 0.6;
          }
        }
      }
    }
    bot.velocity.y -= 20 * dt;
    mover.move(bot, dt, true);
    bot.velocity.y = 0;
    // Walk cycle: legs swing, body bobs.
    const moving = Math.hypot(bot.velocity.x, bot.velocity.z) > 0.4;
    if (moving) bot.walkPhase += dt * 9;
    bot.legL.rotation.x = moving ? Math.sin(bot.walkPhase) * 0.5 : 0;
    bot.legR.rotation.x = moving ? -Math.sin(bot.walkPhase) * 0.5 : 0;
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
    bot.group.rotation.x = 0;
  }

  function fireAt(bot, foe, dist, ctx) {
    const muzzle = new THREE.Vector3(bot.position.x, bot.position.y + 1.35, bot.position.z);
    const aim = new THREE.Vector3(foe.pos.x, foe.pos.y + (foe.crouch ? 1.0 : 1.35), foe.pos.z);
    // Hit chance falls with distance and with the target's speed; crouching helps.
    let p = 0.55 - dist * 0.011 - foe.speed * 0.035 + (foe.crouch ? 0.06 : 0);
    p = Math.max(0.07, Math.min(0.6, p));
    const hit = random() < p;
    const end = hit ? aim.clone() : aim.clone().add(new THREE.Vector3((random() - 0.5) * 1.6, (random() - 0.5) * 1.2, (random() - 0.5) * 1.6));
    onShoot(muzzle, end, bot.team);
    if (hit) {
      const dmg = 11 + Math.floor(random() * 9);
      if (foe.isPlayer) onDamagePlayer(dmg, bot);
      else if (foe.bot) damage(foe.bot, dmg, false);
    }
  }

  function step(dt, ctx) {
    // Defuse progress only survives while a bot is actively channelling it.
    ctx.defuseProgress = 0;
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  function reset(round) {
    const spawns = {
      enemy: [[-16, -13], [16, -13], [-2, -4], [4, 6]],
      ally: [[-3, 13], [3, 13]],
    };
    let ei = 0;
    let ai = 0;
    for (const bot of bots) {
      const list = spawns[bot.team];
      const s = list[(bot.team === 'enemy' ? ei : ai) % list.length];
      if (bot.team === 'enemy') ei += 1; else ai += 1;
      bot.position.set(s[0], 0, s[1]);
      bot.velocity.set(0, 0, 0);
      bot.hp = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.node = nearestNode(s[0], s[1]);
      bot.holdPos.set(s[0], 0, s[1]);
      bot.lastSeen = null;
      bot.hearPos = null;
      bot.defuseAt = 0;
      bot.burstLeft = 0;
      bot.nextBurstAt = 1 + random() * 2;
      bot.group.rotation.set(0, bot.team === 'enemy' ? 0 : Math.PI, 0);
      bot.group.position.copy(bot.position);
      bot.yaw = bot.team === 'enemy' ? 0 : Math.PI;
    }
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  return { bots, hitMeshes, step, reset, damage, aliveCount };
}
