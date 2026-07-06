// world.js — terrain, regions, water, props, sky/day-night, ambient life.
// Deterministic from WORLD_SEED so every client sees the same world.
//
// Messenger (messenger.abeto.co) is the look: hand-drawn anime cel-shading —
// flat color bands, ink outlines, painted teal sky, pastel palette.
// Regions: village plaza (center), forest (east + southwest), snowy lowland
// and big mountains (north), lake (west of village), ocean all around.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WORLD_SEED = 20260706;
// The island is elongated: south half is green, then the mountain belt
// (z -100..-290), and beyond it the great snowfields stretch far north.
export const WORLD_SIZE = 1200; // terrain plane spans [-600, 600]
export const BOUND = 340; // walkable limit east/west/south
export const Z_MIN = -580; // walkable limit deep north, past the range
export const WATER_Y = -0.55;

// --- Cel shading: every surface uses a 3-step toon material ---
const gradientMap = (() => {
  // shadow / mid / lit bands — shadow stays bright; Messenger shade is pastel, never black
  const data = new Uint8Array([150, 205, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  return tex;
})();

export function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
}

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
function clamp01(t) { return Math.min(1, Math.max(0, t)); }

function valueNoise(x, z) {
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

// --- Regions ---
// mountainAmount: 0 in the south, 1 deep in the north where the peaks live
function mountainAmount(x, z) {
  // a belt, not an endless wall: rises at z=-100, fades out past z≈-235
  const rise = smooth(clamp01((-z - 100) / 90));
  const fade = 1 - smooth(clamp01((-z - 235) / 70));
  return rise * fade;
}
// snowAmount: snowy lowland north + anything high enough
export function snowAmount(x, z, h = heightAt(x, z)) {
  const northern = smooth(clamp01((-z - 135) / 40));
  const alpine = smooth(clamp01((h - 12) / 6));
  return Math.max(northern, alpine);
}

export function heightAt(x, z) {
  let h = (fbm(x, z) - 0.44) * 6; // rolling hills, some valleys dip below water
  // big ridged mountains in the north — sharpen the noise so peaks get tall
  const m = mountainAmount(x, z);
  if (m > 0) {
    const n = fbm(x + 500, z + 500);
    const ridged = Math.pow(clamp01((n - 0.32) / 0.5), 2);
    h += m * (7 + ridged * 85);
  }
  const r = Math.hypot(x, z);
  // flatten toward spawn so the village plaza is walkable
  const flat = Math.max(0, 1 - r / 22);
  h = h * (1 - smooth(flat)) + 0.55 * smooth(flat);
  // elongated island: northern distance counts for less, so the landmass
  // stretches far past the range before it meets the sea
  const re = Math.hypot(x, z < 0 ? z * 0.55 : z);
  const edge = smooth(clamp01((re - 315) / 35));
  h = h * (1 - edge) + -3 * edge;
  return h;
}

// forest bands (kept off the mountains and village)
const FORESTS = [
  { x: 100, z: 60, r: 65 },
  { x: -95, z: 85, r: 50 },
  { x: 34, z: 20, r: 24 }, // the near woods, just past the village fence
  { x: 60, z: -95, r: 45 }, // pine belt at the mountain foot
  { x: -160, z: -20, r: 55 },
  { x: 40, z: 190, r: 70 }, // the deep southern forest
  { x: -70, z: -380, r: 85 }, // snowfield groves, past the range
  { x: 90, z: -460, r: 65 },
];
function forestAmount(x, z) {
  let f = 0;
  for (const fo of FORESTS) {
    f = Math.max(f, clamp01(1 - Math.hypot(x - fo.x, z - fo.z) / fo.r));
  }
  return f;
}

// --- Build the static world into a scene ---
export function buildWorld(scene) {
  const rand = mulberry32(WORLD_SEED ^ 0x5eed);
  const rng = (min, max) => min + rand() * (max - min);

  // Terrain mesh with vertex colors by height + region
  const segs = 560; // big island, keep vertex density reasonable
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe6d7ae);
  const grass = new THREE.Color(0x9ec27a);
  const darkGrass = new THREE.Color(0x7ba865);
  const rock = new THREE.Color(0xb5b2a6);
  const snow = new THREE.Color(0xf4f6f2);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    if (h < WATER_Y + 0.35) c.copy(sand);
    else if (h > 8 && h < 15) c.lerpColors(darkGrass, rock, clamp01((h - 8) / 7));
    else c.lerpColors(grass, darkGrass, clamp01(h / 8));
    const s = snowAmount(x, z, h);
    if (s > 0) c.lerp(snow, s); // snow buries even the shores up north
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, toon(0xffffff, { vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Ocean
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    toon(0x6cc4c9, { transparent: true, opacity: 0.9 })
  );
  water.material.userData.outlineParameters = { visible: false };
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
  scene.userData.waterBob = (elapsed) => {
    water.position.y = WATER_Y + Math.sin(elapsed * 0.8) * 0.04;
  };

  // --- Props, merged into few meshes so the outline pass stays cheap ---
  const buckets = new Map(); // material -> geometry list
  const put = (mat, g, x, y, z, ry = 0, s = 1) => {
    g.scale(s, s, s);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  };

  const trunkMat = toon(0x9a7350);
  const crownMat = toon(0x76a86b);
  const snowCrownMat = toon(0xdfe8dc);
  const rockMat = toon(0xb8b5a8);
  const tuftMat = toon(0x8ab06a);

  const placeTree = (x, z, snowy) => {
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.4 || h > 13) return false;
    if (Math.hypot(x, z) < 9) return false; // keep the plaza clear
    const th = rng(1.4, 3.6);
    put(trunkMat, new THREE.CylinderGeometry(0.15, 0.2, th * 0.5, 5), x, h + th * 0.25, z);
    put(snowy ? snowCrownMat : crownMat, new THREE.ConeGeometry(rng(0.6, 1.3), th, 6), x, h + th * 0.95, z);
    return true;
  };

  // scattered trees island-wide + dense forests
  for (let i = 0; i < 500; i++) {
    const x = rng(-BOUND, BOUND), z = rng(Z_MIN, BOUND);
    placeTree(x, z, snowAmount(x, z) > 0.4);
  }
  let planted = 0;
  for (let i = 0; i < 6000 && planted < 1500; i++) {
    const fo = FORESTS[i % FORESTS.length];
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * fo.r;
    const x = fo.x + Math.cos(a) * rr, z = fo.z + Math.sin(a) * rr;
    if (forestAmount(x, z) < 0.15) continue;
    if (placeTree(x, z, snowAmount(x, z) > 0.4)) planted++;
  }

  // rocks — more of them near the mountains
  for (let i = 0; i < 320; i++) {
    const x = rng(-BOUND, BOUND), z = rng(Z_MIN, BOUND);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.2) continue;
    const s = rng(0.25, 0.9) * (1 + mountainAmount(x, z) * 1.6);
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.rotateX(rand() * 3); g.rotateZ(rand() * 3);
    put(rockMat, g, x, h + s * 0.3, z);
  }

  // grass tufts on green land only
  for (let i = 0; i < 550; i++) {
    const x = rng(-BOUND, BOUND), z = rng(-BOUND, BOUND);
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3 || snowAmount(x, z, h) > 0.3) continue;
    put(tuftMat, new THREE.ConeGeometry(0.12, rng(0.25, 0.5), 4), x, h + 0.1, z);
  }

  for (const [mat, geos] of buckets) {
    const merged = new THREE.Mesh(mergeGeometries(geos), mat);
    merged.castShadow = true;
    scene.add(merged);
  }

  buildVillage(scene);
  buildClouds(scene, rand);
  buildBirds(scene, rand);
  buildSnowfall(scene);
  buildCritters(scene, rand);
}

// --- Village: bigger now — 8 houses around a plaza, paths, lanterns, well ---
function makeHouse(wallColor) {
  const house = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.6), toon(wallColor));
  walls.position.y = 1.1;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 4), toon(0xb06a52));
  roof.position.y = 3;
  roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.1), toon(0x6f4c34));
  door.position.set(0, 0.65, 1.33);
  walls.castShadow = roof.castShadow = true;
  house.add(walls, roof, door);
  return house;
}

export const CAMPFIRE_POS = new THREE.Vector3(0, 0, 0);

function buildVillage(scene) {
  const houses = [
    { x: -7, z: -5, ry: 0.6, color: 0xe3d3b4 },
    { x: 7, z: -6, ry: -0.7, color: 0xd8bcb2 },
    { x: 0, z: -9, ry: 0, color: 0xc9d2b4 },
    { x: -6, z: 6, ry: 2.4, color: 0xe3d3b4 },
    { x: 12, z: 2, ry: -1.4, color: 0xd2c6de },
    { x: -12, z: -9, ry: 1.1, color: 0xc9d2b4 },
    { x: 6, z: 11, ry: 2.9, color: 0xd8bcb2 },
    { x: -3, z: 13, ry: 3.4, color: 0xd2c6de },
  ];
  for (const h of houses) {
    const house = makeHouse(h.color);
    house.position.set(h.x, heightAt(h.x, h.z), h.z);
    house.rotation.y = h.ry;
    scene.add(house);
  }

  // campfire at the plaza centre
  CAMPFIRE_POS.set(0, heightAt(0, 0), 0);
  const fire = new THREE.Group();
  const logMat = toon(0x7c5a3e);
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
  const stoneMat = toon(0xb0ada0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat);
    stone.position.set(Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75);
    fire.add(stone);
  }
  fire.position.copy(CAMPFIRE_POS);
  scene.add(fire);

  const fireLight = new THREE.PointLight(0xff8a2a, 12, 18, 1.8);
  fireLight.position.set(CAMPFIRE_POS.x, CAMPFIRE_POS.y + 1, CAMPFIRE_POS.z);
  scene.add(fireLight);

  // stone well on the plaza
  const well = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 0.6, 8), toon(0xb0ada0));
  ring.position.y = 0.3;
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1, 0.6, 4), toon(0xb06a52));
  wellRoof.position.y = 1.7;
  wellRoof.rotation.y = Math.PI / 4;
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.3, 0.09), toon(0x9a7a56));
  postL.position.set(-0.55, 0.85, 0);
  const postR = postL.clone();
  postR.position.x = 0.55;
  ring.castShadow = wellRoof.castShadow = true;
  well.add(ring, wellRoof, postL, postR);
  well.position.set(3.5, heightAt(3.5, 3), 3);
  scene.add(well);

  // dirt paths: plaza to each house, the lake dock, and the forest edge
  const pathMat = toon(0xd8bd90);
  pathMat.userData.outlineParameters = { visible: false };
  const pathTo = (tx, tz) => {
    const steps = Math.ceil(Math.hypot(tx, tz) / 1.1);
    for (let i = 1; i <= steps; i++) {
      const x = (tx * i) / steps + Math.sin(i * 3.7) * 0.25;
      const z = (tz * i) / steps + Math.cos(i * 2.9) * 0.25;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.55 + Math.sin(i) * 0.1, 7), pathMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, heightAt(x, z) + 0.02, z);
      scene.add(patch);
    }
  };
  for (const h of houses) pathTo(h.x * 0.82, h.z * 0.82);
  pathTo(-16, 2); // lake dock
  pathTo(20, 12); // forest edge

  // fences: broken ring around the bigger village
  const woodMat = toon(0x9a7a56);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if (Math.sin(i * 2.3) > 0.5) continue;
    const r = 17;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3) continue;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), woodMat);
    post.position.set(x, h + 0.35, z);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.5), woodMat);
    rail.position.set(x, h + 0.55, z);
    rail.rotation.y = -a;
    post.castShadow = true;
    scene.add(post, rail);
  }

  // lanterns along the paths
  const lanternSpots = [
    [-3, -2], [3, -2.5], [0, -5], [-2.5, 2.5], [-8, 1], [-12, 2],
    [8, 4], [-8, -7], [4, 8], [10, -2],
  ];
  scene.userData.lanterns = [];
  for (const [x, z] of lanternSpots) {
    const h = heightAt(x, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.3, 5), woodMat);
    post.position.set(x, h + 0.65, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a })
    );
    bulb.position.set(x, h + 1.35, z);
    post.castShadow = true;
    scene.add(post, bulb);
    if (scene.userData.lanterns.length < 4) {
      const glow = new THREE.PointLight(0xffc267, 0, 7, 2);
      glow.position.copy(bulb.position);
      scene.add(glow);
      scene.userData.lanterns.push(glow);
    }
  }

  // flowers inside the village ring
  const flowerColors = [0xf2a0bd, 0xf2d27c, 0xffffff, 0xc4a0d4];
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.3) continue;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4), toon(0x8ab06a));
    stem.position.set(x, h + 0.12, z);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), toon(flowerColors[i % flowerColors.length]));
    bloom.position.set(x, h + 0.27, z);
    scene.add(stem, bloom);
  }

  // log seats around the campfire
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9;
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 7), woodMat);
    seat.rotation.z = Math.PI / 2;
    seat.rotation.y = -a;
    seat.position.set(x, heightAt(x, z) + 0.22, z);
    seat.castShadow = true;
    scene.add(seat);
  }

  // little dock reaching into the lake (Ember's fishing spot)
  const dock = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 3.4), woodMat);
  deck.position.y = WATER_Y + 0.35;
  dock.add(deck);
  for (const [px, pz] of [[-0.45, 1.5], [0.45, 1.5], [-0.45, -1.5], [0.45, -1.5]]) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 5), woodMat);
    pile.position.set(px, WATER_Y - 0.2, pz);
    dock.add(pile);
  }
  dock.position.set(-16, 0, 2);
  dock.rotation.y = 0.8;
  scene.add(dock);

  // flicker for the campfire
  scene.userData.flicker = (elapsed) => {
    fireLight.intensity = 10 + Math.sin(elapsed * 11) * 1.6 + Math.sin(elapsed * 23) * 1.1;
    flame.scale.setScalar(1 + Math.sin(elapsed * 13) * 0.12);
  };
}

// --- Sky things ---
function buildClouds(scene, rand) {
  const mat = toon(0xf4f9f0, { transparent: true, opacity: 0.92 });
  const clouds = [];
  for (let i = 0; i < 40; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = 2.2 + rand() * 4;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      puff.position.set(p * 3 - puffs * 1.4, rand() * 1, rand() * 2.6 - 1.3);
      cloud.add(puff);
    }
    cloud.position.set(rand() * 720 - 360, 55 + rand() * 20, rand() * 920 - 580);
    scene.add(cloud);
    clouds.push(cloud);
  }
  scene.userData.driftClouds = (dt) => {
    for (const c of clouds) {
      c.position.x += dt * 0.8;
      if (c.position.x > 380) c.position.x = -380;
    }
  };
}

// bird flocks circling over the island
function buildBirds(scene, rand) {
  const birdMat = toon(0x4a4640);
  const flocks = [];
  for (let f = 0; f < 7; f++) {
    const flock = {
      cx: rand() * 400 - 200,
      cz: rand() * 620 - 440,
      r: 18 + rand() * 30,
      h: 20 + rand() * 25,
      speed: 0.12 + rand() * 0.1,
      angle: rand() * Math.PI * 2,
      birds: [],
    };
    for (let b = 0; b < 5; b++) {
      const bird = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5, 4), birdMat);
      body.rotation.x = Math.PI / 2;
      const wingGeo = new THREE.BoxGeometry(0.55, 0.03, 0.16);
      const wl = new THREE.Mesh(wingGeo, birdMat);
      wl.position.x = -0.3;
      const wr = new THREE.Mesh(wingGeo.clone(), birdMat);
      wr.position.x = 0.3;
      bird.add(body, wl, wr);
      bird.userData = { wl, wr, off: b };
      scene.add(bird);
      flock.birds.push(bird);
    }
    flocks.push(flock);
  }
  scene.userData.updateBirds = (dt, elapsed) => {
    for (const f of flocks) {
      f.angle += dt * f.speed;
      for (const bird of f.birds) {
        const o = bird.userData.off;
        const a = f.angle - o * 0.16;
        bird.position.set(
          f.cx + Math.cos(a) * f.r,
          f.h + Math.sin(elapsed * 1.3 + o) * 0.6,
          f.cz + Math.sin(a) * f.r
        );
        bird.rotation.y = -a; // face along the circle
        const flap = Math.sin(elapsed * 7 + o * 1.4) * 0.55;
        bird.userData.wl.rotation.z = flap;
        bird.userData.wr.rotation.z = -flap;
      }
    }
  };
}

// snowfall around the player while in the snowy north
function buildSnowfall(scene) {
  const COUNT = 700;
  const BOX = { w: 46, h: 22 };
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    p[i * 3] = Math.random() * BOX.w - BOX.w / 2;
    p[i * 3 + 1] = Math.random() * BOX.h;
    p[i * 3 + 2] = Math.random() * BOX.w - BOX.w / 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0 });
  const flakes = new THREE.Points(geo, mat);
  scene.add(flakes);

  scene.userData.updateSnow = (dt, elapsed, playerPos) => {
    if (!playerPos) return;
    const inSnow = snowAmount(playerPos.x, playerPos.z);
    mat.opacity += (inSnow * 0.9 - mat.opacity) * Math.min(1, dt * 2);
    if (mat.opacity < 0.02) return;
    flakes.position.set(playerPos.x, playerPos.y, playerPos.z);
    const arr = geo.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] -= dt * (2.2 + (i % 5) * 0.3);
      arr[i * 3] += Math.sin(elapsed * 0.9 + i) * dt * 0.5;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = BOX.h;
    }
    geo.attributes.position.needsUpdate = true;
  };
}

// forest critters: bunnies hop, deer amble. Client-side ambience, not synced.
function buildCritters(scene, rand) {
  const critters = [];

  const makeBunny = () => {
    const g = new THREE.Group();
    const white = toon(0xece8e0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.38), white);
    body.position.y = 0.16;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.18), white);
    head.position.set(0, 0.3, 0.22);
    const earGeo = new THREE.BoxGeometry(0.05, 0.22, 0.04);
    const earL = new THREE.Mesh(earGeo, white);
    earL.position.set(-0.05, 0.48, 0.2);
    const earR = new THREE.Mesh(earGeo.clone(), white);
    earR.position.set(0.05, 0.48, 0.2);
    body.castShadow = true;
    g.add(body, head, earL, earR);
    return g;
  };

  const makeDeer = () => {
    const g = new THREE.Group();
    const tan = toon(0xb08a5e);
    const dark = toon(0x8a6844);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.9), tan);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.34), tan);
    head.position.set(0, 1.05, 0.5);
    for (const [lx, lz] of [[-0.15, 0.3], [0.15, 0.3], [-0.15, -0.3], [0.15, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.45, 0.09), dark);
      leg.position.set(lx, 0.22, lz);
      g.add(leg);
    }
    body.castShadow = true;
    g.add(body, head);
    return g;
  };

  for (let i = 0; i < 40; i++) {
    const fo = FORESTS[i % FORESTS.length];
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * fo.r * 0.8;
    const home = { x: fo.x + Math.cos(a) * rr, z: fo.z + Math.sin(a) * rr };
    if (heightAt(home.x, home.z) < WATER_Y + 0.4) continue;
    const kind = i % 3 === 0 ? 'deer' : 'bunny';
    const mesh = kind === 'deer' ? makeDeer() : makeBunny();
    mesh.position.set(home.x, heightAt(home.x, home.z), home.z);
    scene.add(mesh);
    critters.push({ mesh, home, kind, target: { ...home }, idle: rand() * 3, hop: 0 });
  }

  scene.userData.updateCritters = (dt, elapsed) => {
    for (const cr of critters) {
      if (cr.idle > 0) {
        cr.idle -= dt;
        continue;
      }
      const dx = cr.target.x - cr.mesh.position.x;
      const dz = cr.target.z - cr.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) {
        // pick a new spot near home, rest a moment
        cr.idle = 1.5 + Math.random() * 4;
        cr.target = {
          x: cr.home.x + (Math.random() - 0.5) * 8,
          z: cr.home.z + (Math.random() - 0.5) * 8,
        };
        continue;
      }
      const speed = cr.kind === 'deer' ? 0.9 : 1.6;
      cr.mesh.position.x += (dx / dist) * speed * dt;
      cr.mesh.position.z += (dz / dist) * speed * dt;
      cr.mesh.rotation.y = Math.atan2(dx, dz);
      const ground = heightAt(cr.mesh.position.x, cr.mesh.position.z);
      cr.hop += dt * (cr.kind === 'bunny' ? 9 : 0);
      cr.mesh.position.y = ground + (cr.kind === 'bunny' ? Math.abs(Math.sin(cr.hop)) * 0.18 : 0);
    }
  };
}

// --- Day/night cycle ---
export const DAY_LENGTH = 180; // seconds per full day, tuned for demos

// painted-teal sky, Messenger-style
const DAY_SKY = new THREE.Color(0x8fd4c9);
const DUSK_SKY = new THREE.Color(0xe8a87a);
const NIGHT_SKY = new THREE.Color(0x16283e);

export function makeDayNight(scene, sun, ambient) {
  // gradient sky dome: horizon lightens toward the ground like real atmosphere
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x8fd4c9) },
    horizonColor: { value: new THREE.Color(0xf4f1e0) },
  };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vPos;
        void main() {
          float h = clamp(normalize(vPos).y, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.55)), 1.0);
        }`,
    })
  );
  skyDome.renderOrder = -1;
  skyDome.material.userData.outlineParameters = { visible: false };
  scene.add(skyDome);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  const rand = mulberry32(WORLD_SEED ^ 0x57a2);
  for (let i = 0; i < 350; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.45;
    const r = 600;
    starPos.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 5, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // moon rides opposite the sun
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(11, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false, transparent: true, opacity: 0 })
  );
  scene.add(moon);

  // fireflies around the village at night
  const flyGeo = new THREE.BufferGeometry();
  const flyBase = [];
  for (let i = 0; i < 40; i++) {
    flyBase.push(rand() * 28 - 14, 0.5 + rand() * 1.6, rand() * 28 - 14);
  }
  flyGeo.setAttribute('position', new THREE.Float32BufferAttribute([...flyBase], 3));
  const flyMat = new THREE.PointsMaterial({ color: 0xd4f26a, size: 0.14, transparent: true, opacity: 0 });
  const fireflies = new THREE.Points(flyGeo, flyMat);
  scene.add(fireflies);

  const sky = new THREE.Color();

  return function update(elapsed, playerPos) {
    const t = (elapsed % DAY_LENGTH) / DAY_LENGTH; // 0 = dawn, 0.25 = noon, 0.5 = dusk
    const angle = t * Math.PI * 2;
    const dayness = Math.max(0, Math.sin(angle));
    const duskness = Math.exp(-Math.pow(Math.sin(angle) / 0.22, 2));

    // sun orbits around the player so shadows stay crisp everywhere
    const px = playerPos?.x ?? 0, pz = playerPos?.z ?? 0;
    sun.position.set(px + Math.cos(angle) * 60, Math.sin(angle) * 60, pz + 18);
    sun.intensity = 0.15 + dayness * 2.1;
    ambient.intensity = 0.18 + dayness * 0.45;

    sky.copy(NIGHT_SKY).lerp(DAY_SKY, dayness).lerp(DUSK_SKY, duskness * 0.7);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    skyUniforms.topColor.value.copy(sky);
    skyUniforms.horizonColor.value.copy(sky).lerp(new THREE.Color(0xf4f1e0), 0.4 + duskness * 0.3);
    if (playerPos) skyDome.position.set(px, 0, pz);

    const nightness = Math.max(0, 1 - dayness * 3);
    starMat.opacity = nightness;
    if (playerPos) stars.position.set(px, 0, pz);

    moon.position.set(px - Math.cos(angle) * 450, -Math.sin(angle) * 450, pz - 160);
    moon.material.opacity = nightness;

    for (const glow of scene.userData.lanterns ?? []) glow.intensity = nightness * 4 + duskness * 2;

    flyMat.opacity = nightness * 0.9;
    if (nightness > 0) {
      const p = flyGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setX(i, flyBase[i * 3] + Math.sin(elapsed * 0.7 + i * 1.7) * 0.8);
        p.setY(i, 0.6 + flyBase[i * 3 + 1] + Math.sin(elapsed * 1.1 + i * 2.3) * 0.3);
        p.setZ(i, flyBase[i * 3 + 2] + Math.cos(elapsed * 0.5 + i) * 0.8);
      }
      p.needsUpdate = true;
    }

    return t;
  };
}
