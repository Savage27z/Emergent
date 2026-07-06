import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { buildWorld, heightAt, makeDayNight, DAY_LENGTH, BOUND, toon } from './world.js';

// --- Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x8fd4c9, 55, 170); // far enough to see the mountains

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ink outlines around everything — the hand-drawn look is outlines + cel bands
const effect = new OutlineEffect(renderer, {
  defaultThickness: 0.007,
  defaultColor: [0.13, 0.11, 0.1],
});

// --- Lights ---
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 6; // soft edges
scene.add(sun);
// sky-and-ground bounce: blue-ish from above, grass-tinted from below
const ambient = new THREE.HemisphereLight(0xbfd8ff, 0x7a9a5a, 0.65);
scene.add(ambient);

// --- World ---
buildWorld(scene);
const updateDayNight = makeDayNight(scene, sun, ambient);

// --- Player meshes ---
// hand-drawn label: white bubble, wobbly ink border, handwritten text
function makeNameTag(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 30px "Segoe Print", "Comic Sans MS", cursive';
  ctx.textAlign = 'center';
  const w = Math.min(490, ctx.measureText(text).width + 44);
  const x0 = 256 - w / 2, y0 = 14, h = 62, r = 14;

  // slightly irregular rounded rect = drawn by hand
  const wob = (i) => Math.sin(i * 12.9898) * 2.2;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0 + wob(1));
  ctx.lineTo(x0 + w - r, y0 + wob(2));
  ctx.quadraticCurveTo(x0 + w + wob(3), y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w + wob(4), y0 + h - r);
  ctx.quadraticCurveTo(x0 + w, y0 + h + wob(5), x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h + wob(6));
  ctx.quadraticCurveTo(x0 + wob(7), y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0 + wob(8), y0 + r);
  ctx.quadraticCurveTo(x0, y0 + wob(1), x0 + r, y0);
  ctx.closePath();
  ctx.fillStyle = '#fbf7ee';
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#211d1a';
  ctx.stroke();

  ctx.fillStyle = '#211d1a';
  ctx.fillText(text.toUpperCase(), 256, y0 + 44);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  );
  sprite.scale.set(4.3, 0.8, 1);
  sprite.position.y = 2.2;
  return sprite;
}

function makeHat(kind) {
  if (kind === 'cone') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.4, 8), toon(0xf2a0bd));
    hat.position.y = 1.85;
    hat.castShadow = true;
    return hat;
  }
  if (kind === 'crown') {
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.12, 0.16, 6, 1, true),
      toon(0xf2d27c, { side: THREE.DoubleSide })
    );
    hat.position.y = 1.74;
    hat.castShadow = true;
    return hat;
  }
  return null;
}

// Messenger-style person: rounded proportioned body, hair cap, backpack,
// chunky shoes. Shirt takes the player color; everything cel-shaded + inked.
const SKIN = 0xf0c9a6;
const HAIR = 0x4a3f4a; // dark plum, like the messenger kid
const SHOE = 0xf4f1e8;
const PACK = 0xefe9dc;

function makePlayerMesh(color, name, hat = 'none') {
  const shirt = new THREE.Color(color);
  const pants = shirt.clone().lerp(new THREE.Color(0x22202a), 0.55);
  const shirtMat = toon(shirt);
  const pantsMat = toon(pants);
  const skinMat = toon(SKIN);
  const hairMat = toon(HAIR);
  const shoeMat = toon(SHOE);

  const group = new THREE.Group();

  // legs: capsules pivoted at the hip, shoes ride along
  const makeLeg = (side) => {
    const leg = new THREE.Group();
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.5, 4, 8), pantsMat);
    limb.position.y = -0.36;
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 8), shoeMat);
    shoe.scale.set(1, 0.7, 1.5);
    shoe.position.set(0, -0.68, 0.04);
    limb.castShadow = true;
    leg.add(limb, shoe);
    leg.position.set(side * 0.09, 0.78, 0);
    return leg;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // torso: capsule in the shirt color
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.3, 4, 10), shirtMat);
  torso.scale.set(1.15, 1, 0.85);
  torso.position.y = 1.08;
  torso.castShadow = true;

  // arms: skin capsules with a short sleeve, pivoted at the shoulder
  const makeArm = (side) => {
    const arm = new THREE.Group();
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.42, 4, 8), skinMat);
    limb.position.y = -0.26;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.062, 0.16, 8), shirtMat);
    sleeve.position.y = -0.08;
    limb.castShadow = true;
    arm.add(limb, sleeve);
    arm.position.set(side * 0.235, 1.32, 0);
    arm.rotation.z = side * 0.08; // relaxed, slightly out
    return arm;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // head + hair cap + eyes
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), skinMat);
  head.scale.set(1, 1.08, 1);
  head.position.y = 1.56;
  head.castShadow = true;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hairMat
  );
  hair.position.set(0, 1.585, -0.02);
  hair.rotation.x = -0.22; // fringe falls forward
  const eyeGeo = new THREE.SphereGeometry(0.021, 6, 6);
  const eyeMat = toon(0x2a2430);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo.clone(), eyeMat);
  eyeL.position.set(-0.062, 1.57, 0.148);
  eyeR.position.set(0.062, 1.57, 0.148);

  // little backpack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.13), toon(PACK));
  pack.position.set(0, 1.14, -0.19);
  const strapGeo = new THREE.BoxGeometry(0.035, 0.26, 0.02);
  const strapL = new THREE.Mesh(strapGeo, toon(PACK));
  strapL.position.set(-0.09, 1.2, -0.11);
  const strapR = new THREE.Mesh(strapGeo.clone(), toon(PACK));
  strapR.position.set(0.09, 1.2, -0.11);

  group.add(legL, legR, torso, armL, armR, head, hair, eyeL, eyeR, pack, strapL, strapR);

  const tag = makeNameTag(name);
  tag.position.y = 2.25;
  group.add(tag);
  const hatMesh = makeHat(hat);
  if (hatMesh) group.add(hatMesh);

  // walk ∈ [0,1]; t drives the stride
  group.userData.animate = (walk, t) => {
    const swing = Math.sin(t * 9) * 0.65 * walk;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.75;
    armR.rotation.x = swing * 0.75;
    const bob = Math.abs(Math.sin(t * 9)) * 0.04 * walk;
    torso.position.y = 1.08 + bob;
    head.position.y = 1.56 + bob;
    hair.position.y = 1.585 + bob;
    torso.rotation.x = walk * 0.08; // slight forward lean when moving
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
  hud.innerHTML = `EMERGENT<br />WASD move · Space jump · Shift sprint · drag look · C customize · M memories<br />${count} online · ${icon}`;
}

let playerCount = 1;

function connect(profile) {
  socket = io({ auth: { pid, ...profile } });

  socket.on('welcome', ({ self: me }) => {
    self = makePlayerMesh(me.color, me.name + ' (you)', me.hat);
    // dev: ?pos=x,z spawns you at a specific spot
    const devPos = new URLSearchParams(location.search).get('pos')?.split(',').map(Number);
    if (devPos?.length === 2 && devPos.every(Number.isFinite)) [me.x, me.z] = devPos;
    self.position.set(me.x, heightAt(me.x, me.z), me.z);
    self.rotation.y = me.ry;
    scene.add(self);
    camera.position.copy(self.position).add(new THREE.Vector3(0, 7, 10));
  });

  socket.on('snapshot', ({ time, entities }) => {
    if (forcedT === null) elapsed = time + DAY_LENGTH * 0.2; // server owns world time
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
  if (e.code === 'KeyM') toggleMemoryPanel();
});

// --- Ember's memory panel (M) — a live window into the agent's memory stream ---
let memTimer = null;
function toggleMemoryPanel() {
  const panel = document.getElementById('memories');
  if (panel.classList.toggle('hidden')) {
    clearInterval(memTimer);
    memTimer = null;
    return;
  }
  const render = async () => {
    try {
      const { count, memories: mems } = await (await fetch('/api/agents/npc-ember/memories')).json();
      panel.innerHTML =
        `<h2>EMBER'S MEMORY · ${count} total</h2>` +
        mems.map((m) => {
          const t = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `<div class="mem${m.importance >= 3 ? ' imp3' : ''}"><span class="t">${t}</span>${m.text}</div>`;
        }).join('');
    } catch { /* server briefly unavailable */ }
  };
  render();
  memTimer = setInterval(render, 2000);
}
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
// dev: freeze time of day with ?t=0..1 (0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight)
const forcedT = new URLSearchParams(location.search).get('t');

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
    self.position.x = THREE.MathUtils.clamp(self.position.x, -BOUND, BOUND);
    self.position.z = THREE.MathUtils.clamp(self.position.z, -BOUND, BOUND);

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
    // don't let the camera burrow into hills — check along the whole boom,
    // shortening it if terrain (e.g. a mountain face) is in the way
    for (let t = 0.35; t <= 1; t += 0.15) {
      const px = self.position.x + camOffset.x * t;
      const pz = self.position.z + camOffset.z * t;
      const py = self.position.y + 1.2 + (camTarget.y - self.position.y - 1.2) * t;
      const ground = heightAt(px, pz);
      if (py < ground + 0.3) {
        camTarget.copy(self.position).addScaledVector(camOffset, Math.max(0.3, t - 0.1));
        camTarget.y += 0.8; // peek over the obstruction
        break;
      }
    }
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

  const timeOfDay = updateDayNight(forcedT !== null ? DAY_LENGTH * parseFloat(forcedT) : elapsed, self?.position);
  scene.userData.flicker?.(elapsed);
  scene.userData.driftClouds?.(dt);
  scene.userData.waterBob?.(elapsed);
  scene.userData.updateBirds?.(dt, elapsed);
  scene.userData.updateSnow?.(dt, elapsed, self?.position);
  scene.userData.updateCritters?.(dt, elapsed);
  updateHud(playerCount, timeOfDay);

  effect.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
