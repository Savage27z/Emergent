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
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 42);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 2.2;
  return sprite;
}

function makePlayerMesh(color, name) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.8),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 0.8;
  body.castShadow = true;
  group.add(body, makeNameTag(name));
  return group;
}

// --- Networking ---
let pid = localStorage.getItem('emergent-pid');
if (!pid) {
  pid = crypto.randomUUID();
  localStorage.setItem('emergent-pid', pid);
}
const socket = io({ auth: { pid } });
let self = null; // our player mesh (locally simulated)
const others = new Map(); // id -> { mesh, target: {x, z, ry} }
const hud = document.getElementById('hud');

function updateHud(count, timeOfDay) {
  const icons = ['🌅', '☀️', '🌇', '🌙'];
  const icon = icons[Math.floor((timeOfDay ?? 0.25) * 4) % 4];
  hud.innerHTML = `EMERGENT — day 1<br />WASD to move · ${count} online · ${icon}`;
}

socket.on('welcome', ({ self: me }) => {
  self = makePlayerMesh(me.color, me.name + ' (you)');
  self.position.set(me.x, heightAt(me.x, me.z), me.z);
  self.rotation.y = me.ry;
  scene.add(self);
  camera.position.copy(self.position).add(new THREE.Vector3(0, 7, 10));
});

let playerCount = 1;
socket.on('snapshot', ({ time, entities }) => {
  elapsed = time + DAY_LENGTH * 0.2; // server owns world time; offset starts us mid-morning
  const seen = new Set();
  playerCount = 0;
  for (const p of entities) {
    if (!p.id.startsWith('npc-')) playerCount++;
    if (p.id === socket.id) continue; // we simulate ourselves (welcome may not have landed yet)
    seen.add(p.id);
    const o = others.get(p.id) ?? addOther(p);
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

function addOther(p) {
  if (others.has(p.id)) return others.get(p.id);
  const mesh = makePlayerMesh(p.color, p.name);
  mesh.position.set(p.x, heightAt(p.x, p.z), p.z);
  scene.add(mesh);
  const entry = { mesh, target: { x: p.x, z: p.z, ry: p.ry } };
  others.set(p.id, entry);
  return entry;
}

// send our position at 20Hz
setInterval(() => {
  if (self) socket.emit('move', { x: self.position.x, z: self.position.z, ry: self.rotation.y });
}, 50);

// --- Input ---
const keys = {};
addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

// --- Game loop (local movement is predicted client-side; server relays) ---
const SPEED = 8;
const clock = new THREE.Clock();
let elapsed = DAY_LENGTH * 0.2; // overwritten by server snapshots; offset = mid-morning start

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt; // advance locally between snapshots

  if (self) {
    const dir = new THREE.Vector3(
      (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
      0,
      (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0)
    );
    if (dir.lengthSq() > 0) {
      dir.normalize();
      self.position.addScaledVector(dir, SPEED * dt);
      self.rotation.y = Math.atan2(dir.x, dir.z);
    }
    self.position.x = THREE.MathUtils.clamp(self.position.x, -58, 58);
    self.position.z = THREE.MathUtils.clamp(self.position.z, -58, 58);
    self.position.y = heightAt(self.position.x, self.position.z);

    const camTarget = self.position.clone().add(new THREE.Vector3(0, 7, 10));
    camera.position.lerp(camTarget, 0.08);
    camera.lookAt(self.position.x, self.position.y + 1, self.position.z);

    // keep the shadow camera centred on the action as the sun orbits
    sun.target.position.copy(self.position);
    sun.target.updateMatrixWorld();
  }

  // interpolate other players toward their latest snapshot
  for (const { mesh, target } of others.values()) {
    mesh.position.x += (target.x - mesh.position.x) * 0.2;
    mesh.position.z += (target.z - mesh.position.z) * 0.2;
    mesh.position.y = heightAt(mesh.position.x, mesh.position.z);
    mesh.rotation.y += (target.ry - mesh.rotation.y) * 0.2;
  }

  const timeOfDay = updateDayNight(elapsed, self?.position);
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
