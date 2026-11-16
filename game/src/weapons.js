// Weapons: three guns and one grenade, each with its own numbers, view model and
// feel. Damage is per hit; headshots multiply it. Spread grows with speed and with
// sustained fire, so stopping to aim pays. The buy menu (sim.js) owns prices.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'KESTREL rifle', price: 0, auto: true, mag: 25, reserve: 75,
    damage: 26, headMul: 3.8, gap: 0.115, reload: 2.0, spreadStill: 0.0025, spreadMove: 0.026,
    kick: 0.011, range: 90,
  },
  hornet: {
    id: 'hornet', name: 'HORNET smg', price: 900, auto: true, mag: 32, reserve: 96,
    damage: 17, headMul: 3.5, gap: 0.068, reload: 1.6, spreadStill: 0.006, spreadMove: 0.03,
    kick: 0.007, range: 60,
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT dmr', price: 2200, auto: false, mag: 8, reserve: 24,
    damage: 68, headMul: 2.2, gap: 0.85, reload: 2.6, spreadStill: 0.0006, spreadMove: 0.04,
    kick: 0.028, range: 120,
  },
};
export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 95;
export const GRENADE_RADIUS = 5.5;

export function createWeaponRig(camera) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2620'), roughness: 0.6, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f8578'), roughness: 0.45, metalness: 0.5 });
  const teal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const models = {};
  // One simple view model per gun, built from boxes: receiver, barrel, stock, grip.
  function buildModel(accent) {
    const g = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.46), steel);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), dark);
    barrel.position.set(0, 0.03, -0.42);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.24), dark);
    stock.position.set(0, -0.02, 0.33);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.08), dark);
    grip.position.set(0, -0.11, 0.08);
    grip.rotation.x = 0.35;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.2), accent ? teal : steel);
    stripe.position.set(0, 0.065, -0.05);
    g.add(receiver, barrel, stock, grip, stripe);
    g.position.set(0.24, -0.2, -0.58);
    g.scale.setScalar(0.72);
    return g;
  }
  models.kestrel = buildModel(true);
  models.hornet = buildModel(false);
  models.hornet.scale.set(0.85, 0.85, 0.8);
  models.longshot = buildModel(false);
  models.longshot.scale.set(1.05, 1.05, 1.35);
  for (const m of Object.values(models)) {
    m.visible = false;
    camera.add(m);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hazard), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.19, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.hazard), 0, 6);
  flashLight.position.set(0.24, -0.17, -0.75);
  camera.add(flashLight);

  const state = {
    id: 'kestrel', mag: 25, reserve: 75, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, heat: 0, grenades: 0,
  };

  function equip(id) {
    const def = WEAPONS[id];
    if (!def) return;
    for (const key of Object.keys(models)) models[key].visible = key === id;
    state.id = id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.heat = 0;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.heat = Math.max(0, state.heat - dt * 0.9);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    const model = models[state.id];
    model.position.z = -0.58 + state.kick;
    model.rotation.x = state.kick * 2.4;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.5 * Math.min(1, (WEAPONS[state.id].reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const def = WEAPONS[state.id];
        const take = Math.min(def.mag - state.mag, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 40;
    flashLight.intensity = state.flash > 0 ? 22 : 0;
  }

  return {
    state,
    equip,
    step,
    def() { return WEAPONS[state.id]; },
    ready() { return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() {
      state.cooldown = WEAPONS[state.id].gap;
      state.flash = 0.06;
      state.kick = 0.06;
      state.heat = Math.min(1, state.heat + 0.16);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[state.id];
      const move = Math.min(1, speed / 5.2);
      return def.spreadStill + move * def.spreadMove + state.heat * 0.012;
    },
    refillAmmo() {
      const def = WEAPONS[state.id];
      state.mag = def.mag;
      state.reserve = def.reserve;
    },
  };
}
