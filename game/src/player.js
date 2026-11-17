// The player: acceleration-based movement with friction, gravity, jump and crouch,
// resolved through the shared mover. Eye height lerps when crouching; the body is
// a capsule approximated by the mover's box.
import * as THREE from 'three';
import { makeMover } from './mover.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const WALK = 5.2;
const CROUCH_SPEED = 2.4;
const ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP = 6.2;

export function createPlayer(colliders, spawn) {
  const mover = makeMover(colliders, RADIUS, HEIGHT);
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: 0, // face north, toward the sites (-z): forward is (-sin yaw, 0, -cos yaw)
    pitch: 0,
    eye: EYE_STAND,
    onGround: true,
    crouching: false,
    height: HEIGHT,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && body.crouching && !mover.overlaps(body.position.x, body.position.y, body.position.z, HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = HEIGHT;
    }
    const eyeTarget = body.crouching ? EYE_CROUCH : EYE_STAND;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (fwd || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe).normalize();
    }
    const speed = body.crouching ? CROUCH_SPEED : WALK;
    const blend = Math.min(1, (body.onGround ? ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;
    body.onGround = mover.move(body, dt, body.onGround);
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function reset(spawnPoint) {
    body.position.set(spawnPoint.x, 0, spawnPoint.z);
    body.velocity.set(0, 0, 0);
    body.yaw = 0; // face north, toward the sites
    body.pitch = 0;
    body.crouching = false;
    body.height = HEIGHT;
    body.eye = EYE_STAND;
  }

  return {
    state: body,
    step, look, recoil, reset,
    groundSpeed() { return Math.hypot(body.velocity.x, body.velocity.z); },
  };
}
