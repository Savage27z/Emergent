import * as THREE from 'three';

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0); // hazy day sky
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
scene.add(new THREE.AmbientLight(0xbfd4ff, 0.6));

// --- Ground ---
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshLambertMaterial({ color: 0x6aa84f })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Trees (seeded so every client sees the same forest) ---
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260706);
const rng = (min, max) => min + rand() * (max - min);
for (let i = 0; i < 30; i++) {
  const h = rng(1, 3);
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, h * 0.5, 5),
    new THREE.MeshLambertMaterial({ color: 0x7a5230 })
  );
  trunk.position.y = h * 0.25;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(rng(0.6, 1.1), h, 6),
    new THREE.MeshLambertMaterial({ color: 0x3f7d3a })
  );
  crown.position.y = h * 0.5 + h * 0.45;
  trunk.castShadow = crown.castShadow = true;
  tree.add(trunk, crown);
  tree.position.set(rng(-50, 50), 0, rng(-50, 50));
  if (tree.position.length() > 6) scene.add(tree); // keep spawn area clear
}

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

function updateHud(count) {
  hud.innerHTML = `EMERGENT — day 1<br />WASD to move · ${count} online`;
}

socket.on('welcome', ({ self: me, players }) => {
  self = makePlayerMesh(me.color, me.name + ' (you)');
  self.position.set(me.x, 0, me.z);
  self.rotation.y = me.ry;
  scene.add(self);
  camera.position.copy(self.position).add(new THREE.Vector3(0, 7, 10));
  for (const p of players) if (p.id !== me.id) addOther(p);
  updateHud(players.length);
});

socket.on('player-joined', (p) => {
  addOther(p);
  updateHud(others.size + 1);
});

socket.on('player-left', (id) => {
  const o = others.get(id);
  if (o) {
    scene.remove(o.mesh);
    others.delete(id);
  }
  updateHud(others.size + 1);
});

socket.on('snapshot', (players) => {
  for (const p of players) {
    if (self && p.id === socket.id) continue; // we simulate ourselves
    const o = others.get(p.id) ?? addOther(p);
    o.target = { x: p.x, z: p.z, ry: p.ry };
  }
});

function addOther(p) {
  if (others.has(p.id)) return others.get(p.id);
  const mesh = makePlayerMesh(p.color, p.name);
  mesh.position.set(p.x, 0, p.z);
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

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

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

    const camTarget = self.position.clone().add(new THREE.Vector3(0, 7, 10));
    camera.position.lerp(camTarget, 0.08);
    camera.lookAt(self.position.x, self.position.y + 1, self.position.z);
  }

  // interpolate other players toward their latest snapshot
  for (const { mesh, target } of others.values()) {
    mesh.position.x += (target.x - mesh.position.x) * 0.2;
    mesh.position.z += (target.z - mesh.position.z) * 0.2;
    mesh.rotation.y += (target.ry - mesh.rotation.y) * 0.2;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
