// world.js — terrain, water, props, sky/day-night. Deterministic from WORLD_SEED
// so every client sees the same world. TODO: when the server needs terrain
// knowledge (NPC pathing), lift the noise/height functions into a shared module.
import * as THREE from 'three';

export const WORLD_SEED = 20260706;
export const WORLD_SIZE = 120; // world spans [-60, 60]
export const WATER_Y = -0.55;

// --- Seeded noise (value noise + fbm) ---
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRID = 64;
const noiseGrid = (() => {
  const rand = mulberry32(WORLD_SEED);
  const g = new Float32Array((GRID + 1) * (GRID + 1));
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return g;
})();

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, z) {
  // x, z in grid units; wraps at GRID
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = smooth(x - xi), zf = smooth(z - zi);
  const w = GRID + 1;
  const i = ((xi % GRID) + GRID) % GRID;
  const j = ((zi % GRID) + GRID) % GRID;
  const a = noiseGrid[j * w + i], b = noiseGrid[j * w + i + 1];
  const c = noiseGrid[(j + 1) * w + i], d = noiseGrid[(j + 1) * w + i + 1];
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
}

function fbm(x, z) {
  let v = 0, amp = 0.62, freq = 0.016;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * freq * GRID / 8, z * freq * GRID / 8);
    amp *= 0.45;
    freq *= 2.2;
  }
  return v; // ~[0, 1.1]
}

export function heightAt(x, z) {
  let h = (fbm(x, z) - 0.44) * 6; // broad rolling hills, some valleys dip below water
  // flatten toward spawn so the village center is walkable
  const r = Math.hypot(x, z);
  const flat = Math.max(0, 1 - r / 20);
  h = h * (1 - smooth(flat)) + 0.55 * smooth(flat);
  return h;
}

// --- Build the static world into a scene ---
export function buildWorld(scene) {
  const rand = mulberry32(WORLD_SEED ^ 0x5eed);
  const rng = (min, max) => min + rand() * (max - min);

  // Terrain mesh with vertex colors by height
  const segs = 110;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xc8b87a);
  const grass = new THREE.Color(0x6aa84f);
  const dark = new THREE.Color(0x4c7d3a);
  const rock = new THREE.Color(0x8d8d84);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    if (h < WATER_Y + 0.35) c.copy(sand);
    else if (h > 2.6) c.copy(rock);
    else c.lerpColors(grass, dark, Math.min(1, Math.max(0, h / 3)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Water
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x3a7ca5, transparent: true, opacity: 0.82 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // Trees, rocks, grass tufts — placed on land only
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f7d3a });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9a9a90 });
  const tuftMat = new THREE.MeshLambertMaterial({ color: 0x55964a });

  for (let i = 0; i < 55; i++) {
    const x = rng(-56, 56), z = rng(-56, 56);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.4 || Math.hypot(x, z) < 7) continue;
    const th = rng(1.2, 3.2);
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, th * 0.5, 5), trunkMat);
    trunk.position.y = th * 0.25;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(rng(0.6, 1.2), th, 6), crownMat);
    crown.position.y = th * 0.5 + th * 0.45;
    trunk.castShadow = crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(x, h, z);
    scene.add(tree);
  }

  for (let i = 0; i < 25; i++) {
    const x = rng(-56, 56), z = rng(-56, 56);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.2) continue;
    const s = rng(0.25, 0.9);
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    stone.position.set(x, h + s * 0.3, z);
    stone.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    stone.castShadow = true;
    scene.add(stone);
  }

  for (let i = 0; i < 120; i++) {
    const x = rng(-56, 56), z = rng(-56, 56);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3) continue;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.12, rng(0.25, 0.5), 4), tuftMat);
    tuft.position.set(x, h + 0.1, z);
    scene.add(tuft);
  }

  buildVillage(scene);
  buildClouds(scene, rand);
}

// --- Village at spawn: the NPCs' future home ---
function makeHouse(wallColor) {
  const house = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.2, 2.6),
    new THREE.MeshLambertMaterial({ color: wallColor })
  );
  walls.position.y = 1.1;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.6, 1.6, 4),
    new THREE.MeshLambertMaterial({ color: 0x8a4b32 })
  );
  roof.position.y = 3;
  roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.3, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x5a3a22 })
  );
  door.position.set(0, 0.65, 1.33);
  walls.castShadow = roof.castShadow = true;
  house.add(walls, roof, door);
  return house;
}

export const CAMPFIRE_POS = new THREE.Vector3(0, 0, 0);

function buildVillage(scene) {
  const houses = [
    { x: -6, z: -4, ry: 0.6, color: 0xd9c8a9 },
    { x: 6, z: -5, ry: -0.7, color: 0xc9a9a0 },
    { x: 0, z: -8, ry: 0, color: 0xb9c4a5 },
    { x: -5, z: 5, ry: 2.4, color: 0xd9c8a9 },
  ];
  for (const h of houses) {
    const house = makeHouse(h.color);
    house.position.set(h.x, heightAt(h.x, h.z), h.z);
    house.rotation.y = h.ry;
    scene.add(house);
  }

  // campfire at the village centre
  CAMPFIRE_POS.set(0, heightAt(0, 0), 0);
  const fire = new THREE.Group();
  const logMat = new THREE.MeshLambertMaterial({ color: 0x5a3a22 });
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), logMat);
    log.rotation.z = Math.PI / 2.3;
    log.rotation.y = (i / 3) * Math.PI;
    log.position.y = 0.12;
    fire.add(log);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.7, 6),
    new THREE.MeshBasicMaterial({ color: 0xff9a3c })
  );
  flame.position.y = 0.5;
  fire.add(flame);
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8d8d84 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
    fire.add(stone);
  }
  fire.position.copy(CAMPFIRE_POS);
  scene.add(fire);

  // firelight matters at night
  const fireLight = new THREE.PointLight(0xff8a2a, 12, 18, 1.8);
  fireLight.position.set(CAMPFIRE_POS.x, CAMPFIRE_POS.y + 1, CAMPFIRE_POS.z);
  scene.add(fireLight);

  // flicker (exported via userData so main.js can call it in the loop)
  scene.userData.flicker = (elapsed) => {
    fireLight.intensity = 10 + Math.sin(elapsed * 11) * 1.6 + Math.sin(elapsed * 23) * 1.1;
    flame.scale.setScalar(1 + Math.sin(elapsed * 13) * 0.12);
  };
}

function buildClouds(scene, rand) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 1.5 + rand() * 2.5;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      puff.position.set(p * 2.2 - puffs, rand() * 0.8, rand() * 2 - 1);
      cloud.add(puff);
    }
    cloud.position.set(rand() * 160 - 80, 26 + rand() * 8, rand() * 160 - 80);
    scene.add(cloud);
    clouds.push(cloud);
  }
  scene.userData.driftClouds = (dt) => {
    for (const c of clouds) {
      c.position.x += dt * 0.6;
      if (c.position.x > 90) c.position.x = -90;
    }
  };
}

// --- Day/night cycle ---
export const DAY_LENGTH = 180; // seconds per full day, tuned for demos

const DAY_SKY = new THREE.Color(0x87b5e0);
const DUSK_SKY = new THREE.Color(0xd98e6a);
const NIGHT_SKY = new THREE.Color(0x0b1026);

export function makeDayNight(scene, sun, ambient) {
  // stars: points on a dome, visible only at night
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  const rand = mulberry32(WORLD_SEED ^ 0x57a2);
  for (let i = 0; i < 350; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.45;
    const r = 90;
    starPos.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const sky = new THREE.Color();

  return function update(elapsed, playerPos) {
    const t = (elapsed % DAY_LENGTH) / DAY_LENGTH; // 0 = dawn, 0.25 = noon, 0.5 = dusk
    const angle = t * Math.PI * 2;
    const dayness = Math.max(0, Math.sin(angle)); // 0 at night, 1 at noon
    const duskness = Math.exp(-Math.pow(Math.sin(angle) / 0.22, 2)); // peaks at dawn/dusk

    sun.position.set(Math.cos(angle) * 35, Math.sin(angle) * 35, 12);
    sun.intensity = 0.15 + dayness * 2.1;
    ambient.intensity = 0.18 + dayness * 0.45;

    sky.copy(NIGHT_SKY).lerp(DAY_SKY, dayness).lerp(DUSK_SKY, duskness * 0.7);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);

    starMat.opacity = Math.max(0, 1 - dayness * 3);
    if (playerPos) stars.position.set(playerPos.x, 0, playerPos.z);

    return t;
  };
}
