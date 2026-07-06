import * as THREE from 'three';

// --- Socket (connection only today; server authority comes later this phase) ---
const socket = io();
socket.on('connect', () => console.log('connected to server as', socket.id));

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

// --- Scatter some low-poly props so movement is legible ---
const rng = (min, max) => min + Math.random() * (max - min);
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

// --- Player ---
const player = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 1.6, 0.8),
  new THREE.MeshLambertMaterial({ color: 0xe07a5f })
);
player.position.y = 0.8;
player.castShadow = true;
scene.add(player);

// --- Input ---
const keys = {};
addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

// --- Movement (client-side for now; TODO: move authority to server in Phase 1) ---
const SPEED = 8;
const clock = new THREE.Clock();
camera.position.copy(player.position).add(new THREE.Vector3(0, 7, 10));

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  const dir = new THREE.Vector3(
    (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    0,
    (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0)
  );
  if (dir.lengthSq() > 0) {
    dir.normalize();
    player.position.addScaledVector(dir, SPEED * dt);
    player.rotation.y = Math.atan2(dir.x, dir.z);
  }
  // keep the player on the map
  player.position.x = THREE.MathUtils.clamp(player.position.x, -58, 58);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -58, 58);

  // third-person follow camera
  const camTarget = player.position.clone().add(new THREE.Vector3(0, 7, 10));
  camera.position.lerp(camTarget, 0.08);
  camera.lookAt(player.position.x, player.position.y + 1, player.position.z);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
