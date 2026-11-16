// Ashfall Yard — the map. An open-air foundry yard, 44 x 36 m, with three lanes:
// west lane to Site A (the foundry), east lane to Site B (the depot), and a mid
// lane through the furnace hall. Attackers spawn south, defenders north. Every box
// is both a collider and a bullet stop; crates are low cover, containers are tall
// sightline-breakers, and the two marked sites are where the bomb goes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  halfX: 22,
  halfZ: 18,
  wallH: 5,
  // Bomb sites: centre + half-extent of the plant zone.
  sites: {
    A: { x: -16, z: -11, r: 3.4, label: 'SITE A — FOUNDRY' },
    B: { x: 16, z: -11, r: 3.4, label: 'SITE B — DEPOT' },
  },
  attackerSpawn: { x: 0, z: 14.5 },
  defenderSpawn: { x: 0, z: -14.5 },
};

// Waypoint graph the bots walk: nodes with neighbours. Lanes run south->north;
// the mid hall connects both sites, so a bot can rotate between them.
export const WAYPOINTS = [
  { x: 0, z: 14, n: [1, 2, 3] },       // 0 attacker spawn
  { x: -8, z: 10, n: [0, 4, 5] },     // 1 west approach
  { x: 0, z: 9, n: [0, 4, 6, 7] },    // 2 mid south
  { x: 8, z: 10, n: [0, 6, 8] },      // 3 east approach
  { x: -13, z: 4, n: [1, 2, 9] },     // 4 west mid
  { x: -16, z: -5, n: [4, 9, 10] },   // 5 A approach
  { x: 13, z: 4, n: [2, 3, 11] },     // 6 east mid
  { x: 0, z: 2, n: [2, 4, 6, 12] },   // 7 furnace hall
  { x: 16, z: -5, n: [6, 11, 13] },   // 8 B approach
  { x: -16, z: -11, n: [5, 10, 12] }, // 9 site A
  { x: -8, z: -12, n: [5, 9, 12] },   // 10 A back
  { x: 8, z: -12, n: [6, 8, 12] },    // 11 B back
  { x: 0, z: -8, n: [7, 9, 10, 11, 13, 14] }, // 12 north mid
  { x: 16, z: -11, n: [8, 11, 12] },  // 13 site B
  { x: 0, z: -15, n: [12] },          // 14 defender spawn
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'hazard' || name === 'accent' ? 0.5 : 0.92,
      metalness: name === 'containerRust' ? 0.35 : 0.04,
    });
  }
  const colliders = [];
  const shootables = [];
  const siteMarkers = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: two tones, a darker apron around the furnace hall.
  box(44.6, 0.4, 36.6, 0, -0.2, 0, 'ground');
  const apron = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 10), mats.groundDark);
  apron.position.set(0, 0.03, 2);
  apron.receiveShadow = true;
  group.add(apron);

  // Perimeter walls.
  box(0.6, 5, 36.6, -22.3, 2.5, 0, 'wall');
  box(0.6, 5, 36.6, 22.3, 2.5, 0, 'wall');
  box(44.6, 5, 0.6, 0, 2.5, -18.3, 'wallDark');
  box(44.6, 5, 0.6, 0, 2.5, 18.3, 'wallDark');

  // Furnace hall: two pillars + a low furnace block splitting mid.
  box(1.4, 4.2, 1.4, -3.4, 2.1, 2, 'wallDark');
  box(1.4, 4.2, 1.4, 3.4, 2.1, 2, 'wallDark');
  box(4.4, 1.5, 2.2, 0, 0.75, -2.5, 'containerRust');
  box(4.4, 0.3, 2.2, 0, 1.65, -2.5, 'hazard', false);

  // West lane: crates stepping toward Site A.
  box(2.2, 1.1, 1.4, -10, 0.55, 8, 'crate');
  box(1.4, 1.1, 2.2, -13, 0.55, 2, 'crate');
  box(2.2, 1.1, 1.4, -11, 0.55, -5, 'crate');
  box(1.2, 2.2, 1.2, -18.5, 1.1, -6, 'containerTeal');
  // East lane: containers stepping toward Site B.
  box(2.4, 2.4, 1.4, 10, 1.2, 8, 'containerRust');
  box(1.4, 1.1, 2.2, 13, 0.55, 2, 'crate');
  box(2.2, 1.1, 1.4, 11, 0.55, -5, 'crate');
  box(1.2, 2.2, 1.2, 18.5, 1.1, -6, 'containerTeal');
  // North cover: low walls in front of each site, and spawn cover south.
  box(4.5, 1.15, 0.8, -14, 0.58, -7.5, 'wall');
  box(4.5, 1.15, 0.8, 14, 0.58, -7.5, 'wall');
  box(3.2, 1.0, 1.0, -6, 0.5, 11.5, 'crate');
  box(3.2, 1.0, 1.0, 6, 0.5, 11.5, 'crate');
  box(1.6, 1.1, 1.6, -19.5, 0.55, 12, 'crate');
  box(1.6, 1.1, 1.6, 19.5, 0.55, 12, 'crate');
  // Site markers: flat hazard pads + a glowing beacon pole at each site.
  for (const key of ['A', 'B']) {
    const site = MAP.sites[key];
    const pad = new THREE.Mesh(new THREE.BoxGeometry(site.r * 2, 0.08, site.r * 2), mats.hazard);
    pad.position.set(site.x, 0.05, site.z);
    pad.receiveShadow = true;
    group.add(pad);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 10),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hazard), emissive: new THREE.Color(PALETTE.hazard), emissiveIntensity: 0.7 }),
    );
    pole.position.set(site.x + site.r + 0.6, 1.7, site.z - site.r - 0.4);
    pole.castShadow = true;
    group.add(pole);
    siteMarkers.push(pad);
  }

  // Sky: dusk hemisphere + low orange sun with shadows + cool fill.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#e8c9a0'), new THREE.Color(PALETTE.groundDark), 1.25));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.8);
  sun.position.set(-14, 18, 10);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d9bb3'), 0.5);
  fill.position.set(12, 10, -14);
  scene.add(fill);

  return { colliders, shootables, siteMarkers, group };
}
