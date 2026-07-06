import * as THREE from 'three';
import { buildWorld, heightAt, makeDayNight, DAY_LENGTH } from './world.js';

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x87b5e0, 40, 90);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Lights ---
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
scene.add(sun);
const ambient = new THREE.AmbientLight(0xbfd4ff, 0.6);
scene.add(ambient);

// --- World ---
buildWorld(scene);
const updateDayNight = makeDayNight(scene, sun, ambient);

// --- Player meshes ---
function makeNameTag(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  const w = Math.min(500, ctx.measureText(text).width + 24);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(256 - w / 2, 8, w, 48);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 42);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.scale.set(4.8, 0.6, 1);
  sprite.position.y = 2.2;
  return sprite;
}

function makeHat(kind) {
  if (kind === 'cone') {
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.55, 8),
      new THREE.MeshLambertMaterial({ color: 0xf25c9a })
    );
    hat.position.y = 2.05;
    hat.castShadow = true;
    return hat;
  }
  if (kind === 'crown') {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.21, 0.26, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xf2c94c, side: THREE.DoubleSide })
    );
    hat.position.y = 1.9;
    hat.castShadow = true;
    return hat;
  }
  return null;
}

// little low-poly person: swinging limbs, eyes, optional hat
function makePlayerMesh(color, name, hat = 'none') {
  const base = new THREE.Color(color);
  const skin = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const pants = base.clone().lerp(new THREE.Color(0x000000), 0.35);
  const bodyMat = new THREE.MeshLambertMaterial({ color: base });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });

  const group = new THREE.Group();

  const legGeo = new THREE.BoxGeometry(0.22, 0.65, 0.26);
  legGeo.translate(0, -0.325, 0); // pivot at the hip
  const legL = new THREE.Mesh(legGeo, pantsMat);
  const legR = new THREE.Mesh(legGeo.clone(), pantsMat);
  legL.position.set(-0.16, 0.65, 0);
  legR.position.set(0.16, 0.65, 0);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.7, 0.4), bodyMat);
  body.position.y = 1.0;

  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.2);
  armGeo.translate(0, -0.3, 0); // pivot at the shoulder
  const armL = new THREE.Mesh(armGeo, bodyMat);
  const armR = new THREE.Mesh(armGeo.clone(), bodyMat);
  armL.position.set(-0.42, 1.32, 0);
  armR.position.set(0.42, 1.32, 0);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.42), skinMat);
  head.position.y = 1.57;
  const eyeGeo = new THREE.BoxGeometry(0.07, 0.07, 0.04);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo.clone(), eyeMat);
  eyeL.position.set(-0.11, 1.6, 0.22);
  eyeR.position.set(0.11, 1.6, 0.22);

  for (const m of [legL, legR, body, armL, armR, head]) m.castShadow = true;
  group.add(legL, legR, body, armL, armR, head, eyeL, eyeR);

  const tag = makeNameTag(name);
  tag.position.y = 2.5;
  group.add(tag);
  const hatMesh = makeHat(hat);
  if (hatMesh) group.add(hatMesh);

  // walk ∈ [0,1]; t drives the stride
  group.userData.animate = (walk, t) => {
    const swing = Math.sin(t * 9) * 0.7 * walk;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
    body.position.y = 1.0 + Math.abs(Math.sin(t * 9)) * 0.05 * walk;
  };
  return group;
}

// --- Identity & profile ---
let pid = localStorage.getItem('emergent-pid');
if (!pid) {
  pid = crypto.randomUUID();
  localStorage.setItem('emergent-pid', pid);
}

const PALETTE = [0xe07a5f, 0x3d8bd4, 0xf2cc8f, 0x81b29a, 0xb56dc4, 0xe8628c];
const HATS = ['none', 'cone', 'crown'];

function loadProfile() {
  try { return JSON.parse(localStorage.getItem('emergent-profile')); } catch { return null; }
}

function showJoinOverlay(existing) {
  const overlay = document.getElementById('join');
  overlay.classList.remove('hidden');
  const nameInput = document.getElementById('name-input');
  nameInput.value = existing?.name ?? '';

  let color = existing?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];
  let hat = existing?.hat ?? 'none';

  const swatches = document.getElementById('swatches');
  swatches.innerHTML = '';
  for (const c of PALETTE) {
    const el = document.createElement('div');
    el.className = 'swatch' + (c === color ? ' sel' : '');
    el.style.background = '#' + c.toString(16).padStart(6, '0');
    el.onclick = () => {
      color = c;
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('sel'));
      el.classList.add('sel');
    };
    swatches.appendChild(el);
  }

  const hats = document.getElementById('hats');
  hats.innerHTML = '';
  for (const h of HATS) {
    const el = document.createElement('button');
    el.className = 'hat' + (h === hat ? ' sel' : '');
    el.textContent = h;
    el.onclick = () => {
      hat = h;
      hats.querySelectorAll('.hat').forEach((b) => b.classList.remove('sel'));
      el.classList.add('sel');
    };
    hats.appendChild(el);
  }

  document.getElementById('enter').onclick = () => {
    const profile = { name: nameInput.value.trim().slice(0, 16), color, hat };
    localStorage.setItem('emergent-profile', JSON.stringify(profile));
    overlay.classList.add('hidden');
    if (socket) {
      location.reload(); // re-customizing: reconnect with the new profile
    } else {
      connect(profile);
    }
  };
}

// --- Networking ---
let socket = null;
let self = null; // our player mesh (locally simulated)
const others = new Map(); // id -> { mesh, target: {x, z, ry} }
const hud = document.getElementById('hud');

function updateHud(count, timeOfDay) {
  const icons = ['🌅', '☀️', '🌇', '🌙'];
  const icon = icons[Math.floor((timeOfDay ?? 0.25) * 4) % 4];
  hud.innerHTML = `EMERGENT — day 1<br />WASD move · Space jump · Shift sprint · drag to look · C customize<br />${count} online · ${icon}`;
}

let playerCount = 1;

function connect(profile) {
  socket = io({ auth: { pid, ...profile } });

  socket.on('welcome', ({ self: me }) => {
    self = makePlayerMesh(me.color, me.name + ' (you)', me.hat);
    self.position.set(me.x, heightAt(me.x, me.z), me.z);
    self.rotation.y = me.ry;
    scene.add(self);
    camera.position.copy(self.position).add(new THREE.Vector3(0, 7, 10));
  });

  socket.on('snapshot', ({ time, entities }) => {
    elapsed = time + DAY_LENGTH * 0.2; // server owns world time; offset starts us mid-morning
    const seen = new Set();
    playerCount = 0;
    for (const p of entities) {
      if (!p.id.startsWith('npc-')) playerCount++;
      if (p.id === socket.id) continue; // we simulate ourselves (welcome may not have landed yet)
      seen.add(p.id);
      let o = others.get(p.id) ?? addOther(p);
      // NPC activity changed → rebuild so the tag shows what they're doing
      if (p.status !== undefined && o.status !== p.status) {
        scene.remove(o.mesh);
        others.delete(p.id);
        o = addOther(p);
      }
      o.target = { x: p.x, z: p.z, ry: p.ry };
    }
    // the snapshot is authoritative: drop anyone the server no longer knows
    for (const [id, o] of others) {
      if (!seen.has(id)) {
        scene.remove(o.mesh);
        others.delete(id);
      }
    }
  });

  socket.on('player-left', (id) => {
    const o = others.get(id);
    if (o) {
      scene.remove(o.mesh);
      others.delete(id);
    }
  });

  // send our position at 20Hz
  setInterval(() => {
    if (self) socket.emit('move', { x: self.position.x, z: self.position.z, ry: self.rotation.y });
  }, 50);
}

function addOther(p) {
  if (others.has(p.id)) return others.get(p.id);
  const label = p.status ? `${p.name} · ${p.status}` : p.name;
  const mesh = makePlayerMesh(p.color, label, p.hat);
  mesh.position.set(p.x, heightAt(p.x, p.z), p.z);
  scene.add(mesh);
  const entry = { mesh, target: { x: p.x, z: p.z, ry: p.ry }, status: p.status };
  others.set(p.id, entry);
  return entry;
}

// boot: returning players connect straight away, newcomers customize first
const savedProfile = loadProfile();
if (savedProfile) connect(savedProfile);
else showJoinOverlay(null);

// --- Input ---
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  // C re-opens the customization screen
  if (e.code === 'KeyC' && document.getElementById('join').classList.contains('hidden')) {
    showJoinOverlay(loadProfile());
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));

// --- Camera orbit (drag to rotate, wheel to zoom) ---
let camYaw = 0;
let camPitch = 0.62; // radians above horizontal
let camDist = 12;
let dragging = false;

addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'CANVAS') dragging = true;
});
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camYaw -= e.movementX * 0.005;
  camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * 0.005, 0.15, 1.35);
});
addEventListener('wheel', (e) => {
  camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 5, 25);
});

// --- Game loop (local movement is predicted client-side; server relays) ---
const WALK_SPEED = 8;
const SPRINT_SPEED = 14;
const GRAVITY = 30;
const JUMP_V = 9;
let vy = 0;
let airborne = false;
let selfWalk = 0; // smoothed 0..1 walk blend
let selfStride = 0; // accumulated stride time
const clock = new THREE.Clock();
let elapsed = DAY_LENGTH * 0.2; // overwritten by server snapshots; offset = mid-morning start

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt; // advance locally between snapshots

  if (self) {
    // camera-relative movement: W walks away from the camera
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3()
      .addScaledVector(fwd, (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0))
      .addScaledVector(right, (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
    const sprinting = keys.ShiftLeft || keys.ShiftRight;
    const moving = dir.lengthSq() > 0;
    if (moving) {
      dir.normalize();
      self.position.addScaledVector(dir, (sprinting ? SPRINT_SPEED : WALK_SPEED) * dt);
      self.rotation.y = Math.atan2(dir.x, dir.z);
    }
    selfWalk += ((moving ? 1 : 0) - selfWalk) * Math.min(1, dt * 12);
    selfStride += dt * (moving ? (sprinting ? 1.7 : 1) : 0);
    self.userData.animate(selfWalk, selfStride);
    self.position.x = THREE.MathUtils.clamp(self.position.x, -58, 58);
    self.position.z = THREE.MathUtils.clamp(self.position.z, -58, 58);

    // gravity & jumping over the terrain
    const groundY = heightAt(self.position.x, self.position.z);
    if (keys.Space && !airborne) {
      vy = JUMP_V;
      airborne = true;
    }
    if (airborne) {
      vy -= GRAVITY * dt;
      self.position.y += vy * dt;
      if (self.position.y <= groundY) {
        self.position.y = groundY;
        vy = 0;
        airborne = false;
      }
    } else {
      self.position.y = groundY;
    }

    // orbit camera around the player
    const camOffset = new THREE.Vector3(
      Math.sin(camYaw) * Math.cos(camPitch),
      Math.sin(camPitch),
      Math.cos(camYaw) * Math.cos(camPitch)
    ).multiplyScalar(camDist);
    const camTarget = self.position.clone().add(camOffset);
    // don't let the camera burrow into hills
    camTarget.y = Math.max(camTarget.y, heightAt(camTarget.x, camTarget.z) + 1.2);
    camera.position.lerp(camTarget, 0.12);
    camera.lookAt(self.position.x, self.position.y + 1.2, self.position.z);

    // keep the shadow camera centred on the action as the sun orbits
    sun.target.position.copy(self.position);
    sun.target.updateMatrixWorld();
  }

  // interpolate other players toward their latest snapshot
  for (const o of others.values()) {
    const { mesh, target } = o;
    const dx = target.x - mesh.position.x;
    const dz = target.z - mesh.position.z;
    mesh.position.x += dx * 0.2;
    mesh.position.z += dz * 0.2;
    mesh.position.y = heightAt(mesh.position.x, mesh.position.z);
    mesh.rotation.y += (target.ry - mesh.rotation.y) * 0.2;
    // walk blend from how fast they're actually moving
    const speed = Math.hypot(dx, dz) * 0.2 / Math.max(dt, 1e-4);
    o.walk = (o.walk ?? 0) + (Math.min(1, speed / 3) - (o.walk ?? 0)) * Math.min(1, dt * 10);
    o.stride = (o.stride ?? 0) + dt * (o.walk > 0.05 ? 1 : 0);
    mesh.userData.animate(o.walk, o.stride);
  }

  const timeOfDay = updateDayNight(elapsed, self?.position);
  scene.userData.flicker?.(elapsed);
  scene.userData.driftClouds?.(dt);
  scene.userData.waterBob?.(elapsed);
  updateHud(playerCount, timeOfDay);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
