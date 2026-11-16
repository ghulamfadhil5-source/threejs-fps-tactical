// Shared AABB movement: one axis at a time against the map's box colliders, so a
// wall never swallows a body and sliding along it feels natural. Used by the player
// and by every bot; the physics lives here, not duplicated in two places.
import * as THREE from 'three';

export function makeMover(colliders, radius, height) {
  const probe = new THREE.Box3();
  function overlaps(x, y, z, h, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + h - lift, z + radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // Move a body (position Vector3, velocity Vector3) one step; returns ground state.
  function move(body, dt, onGround) {
    const nx = body.position.x + body.velocity.x * dt;
    if (!overlaps(nx, body.position.y, body.position.z, height, 0.04)) body.position.x = nx;
    else body.velocity.x = 0;
    const nz = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nz, height, 0.04)) body.position.z = nz;
    else body.velocity.z = 0;
    body.position.y += body.velocity.y * dt;
    let grounded = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      grounded = true;
    } else if (hit) {
      body.position.y = hit.min.y - height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      grounded = true;
    }
    return grounded || onGround;
  }

  return { overlaps, move };
}
