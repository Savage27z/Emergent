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

function makeHat(kind) {
  if (kind === 'cone') {
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.6, 8),
      new THREE.MeshLambertMaterial({ color: 0xf25c9a })
    );
    hat.position.y = 1.85;
    hat.castShadow = true;
    return hat;
  }
  if (kind === 'crown') {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.24, 0.28, 6, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xf2c94c, side: THREE.DoubleSide })
    );
    hat.position.y = 1.72;
    hat.castShadow = true;
    return hat;
  }
  return null;
}

function makePlayerMesh(color, name, hat = 'none') {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.8),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 0.8;
  body.castShadow = true;
  group.add(body, makeNameTag(name));
  const hatMesh = makeHat(hat);
  if (hatMesh) group.add(hatMesh);
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
  hud.innerHTML = `EMERGENT — day 1<br />WASD move · C customize · ${count} online · ${icon}`;
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

  // send our position at 20Hz
  setInterval(() => {
    if (self) socket.emit('move', { x: self.position.x, z: self.position.z, ry: self.rotation.y });
  }, 50);
}

function addOther(p) {
  if (others.has(p.id)) return others.get(p.id);
  const mesh = makePlayerMesh(p.color, p.name, p.hat);
  mesh.position.set(p.x, heightAt(p.x, p.z), p.z);
  scene.add(mesh);
  const entry = { mesh, target: { x: p.x, z: p.z, ry: p.ry } };
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
