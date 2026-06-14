import "./style.css";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ------------------------------------------------------------------ *
 * Paper Flick — a Paper Toss-style game in real 3D (Three.js).
 *
 * Swipe up to flick the paper ball across the room and into the trash.
 * The ball is a real rigid body: it can swish, rattle the rim in or out,
 * bounce off the can, the floor and the back wall. Wind pushes it sideways.
 * Levels move the can farther away with stronger wind and a smaller bin.
 *
 * Coordinates: metres, Y up, the room recedes toward -Z. A ball's
 * "depth" d is its distance into the room; its mesh sits at z = -d.
 * Physics tuning below was validated with an offline simulation.
 * ------------------------------------------------------------------ */

// ---- Constants -----------------------------------------------------
const RIM = 0.58; // can mouth height
const BALL_R = 0.075;
const BASE_R = 0.3; // radius the can mesh is modelled at (scaled per level)
const START_Y = 0.55;
const START_D = 0.4;

const G = 9.8;
const DRAG = 0.15; // linear air damping
const WIND_ACC = 0.62; // lateral accel per wind level
const WALLZ = 18; // back wall depth (matches the visible wall)

const E_RIM = 0.26; // restitution: low rim bounce → near-misses rattle IN
const E_WALL = 0.4; // can body / back wall
const E_FLOOR = 0.4;
const FRIC = 0.7; // horizontal speed kept per floor bounce
const SLEEP = 0.55; // speed below which the ball is "at rest"

const LAUNCH_Z = 6.2; // forward velocity at power 1
const LAUNCH_Y = 7.6; // upward velocity at power 1
const VX_MAX = 1.7; // lateral velocity from a full sideways swipe

const MAKES_NEEDED = 3; // makes to advance a level
const PH = 1 / 240; // fixed physics substep

type Phase = "aim" | "flight" | "result";

function levelConfig(level: number) {
  return {
    canZ: Math.min(6.0 + (level - 1) * 0.55, 9.85),
    canR: Math.max(0.4 - (level - 1) * 0.02, 0.26),
    windMax: level <= 1 ? 0 : Math.min(level - 1, 3),
  };
}

// ---- Renderer ------------------------------------------------------
const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ---- Scene + image-based lighting ----------------------------------
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.fog = new THREE.Fog(0xd7e2ee, 14, 32);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
const CAM_BASE = new THREE.Vector3(0, 1.35, 1.2);
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0.2, -7.5);

scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x6b5640, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e2, 1.7);
sun.position.set(4, 8.5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 4;
sun.target.position.set(0, 0, -8);
scene.add(sun, sun.target);

// ---- Procedural textures -------------------------------------------
function makeCanvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, x: c.getContext("2d")! };
}
function floorTexture() {
  const { c, x } = makeCanvas(512);
  x.fillStyle = "#b98c5e";
  x.fillRect(0, 0, 512, 512);
  const planks = 6;
  const pw = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.92 + ((i * 37) % 10) / 80;
    x.fillStyle = `rgb(${Math.round(176 * shade)},${Math.round(130 * shade)},${Math.round(86 * shade)})`;
    x.fillRect(i * pw, 0, pw - 2, 512);
    x.fillStyle = "rgba(70,48,24,0.35)";
    x.fillRect(i * pw + pw - 2, 0, 2, 512);
  }
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(60,40,20,${Math.random() * 0.05})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 9);
  t.anisotropy = maxAniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function wallTexture() {
  const { c, x } = makeCanvas(512);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#eef3f9");
  g.addColorStop(1, "#cad6e6");
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  const rg = x.createRadialGradient(256, 300, 30, 256, 300, 320);
  rg.addColorStop(0, "rgba(255,255,255,0.5)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = rg;
  x.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Room ----------------------------------------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(34, 52),
  new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(34, 18),
  new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 1 }),
);
backWall.position.set(0, 9, -WALLZ);
backWall.receiveShadow = true;
scene.add(backWall);

const baseboard = new THREE.Mesh(
  new THREE.BoxGeometry(34, 0.24, 0.05),
  new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.8 }),
);
baseboard.position.set(0, 0.12, -WALLZ + 0.03);
scene.add(baseboard);

// ---- Crumpled paper ball geometry/material -------------------------
function makeBallGeometry(r: number) {
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + (Math.random() - 0.5) * 0.22);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
const paperMat = new THREE.MeshStandardMaterial({
  color: 0xf4f6f9,
  roughness: 0.82,
  flatShading: true,
});
const ballMesh = new THREE.Mesh(makeBallGeometry(BALL_R), paperMat);
ballMesh.castShadow = true;
scene.add(ballMesh);

// ---- Can + its surroundings ----------------------------------------
// canAnchor: rug + scattered balls (moves with the can, never scaled).
// canGroup: the bin itself (moves AND scales with the level's radius).
const canAnchor = new THREE.Group();
scene.add(canAnchor);
const canGroup = new THREE.Group();
scene.add(canGroup);

const rug = new THREE.Mesh(
  new THREE.CircleGeometry(0.95, 48),
  new THREE.MeshStandardMaterial({ color: 0x2f7d72, roughness: 0.95 }),
);
rug.rotation.x = -Math.PI / 2;
rug.position.y = 0.012;
rug.receiveShadow = true;
canAnchor.add(rug);
const rugRing = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 0.9, 48),
  new THREE.MeshStandardMaterial({ color: 0x6fd3c2, roughness: 0.9 }),
);
rugRing.rotation.x = -Math.PI / 2;
rugRing.position.y = 0.014;
canAnchor.add(rugRing);

for (let i = 0; i < 6; i++) {
  const s = 0.7 + Math.random() * 0.7;
  const m = new THREE.Mesh(makeBallGeometry(BALL_R * s), paperMat);
  const ang = Math.random() * Math.PI * 2;
  const dist = 0.55 + Math.random() * 0.9;
  m.position.set(Math.sin(ang) * dist, BALL_R * s, Math.cos(ang) * dist);
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  m.castShadow = true;
  canAnchor.add(m);
}

const metal = new THREE.MeshStandardMaterial({
  color: 0x707a87,
  metalness: 0.75,
  roughness: 0.32,
  side: THREE.DoubleSide,
});
const canBody = new THREE.Mesh(
  new THREE.CylinderGeometry(BASE_R, BASE_R * 0.78, RIM, 40, 1, true),
  metal,
);
canBody.position.y = RIM / 2;
canBody.castShadow = true;
canBody.receiveShadow = true;
canGroup.add(canBody);
const canInside = new THREE.Mesh(
  new THREE.CylinderGeometry(BASE_R * 0.9, BASE_R * 0.7, RIM - 0.04, 40, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.5, roughness: 0.7, side: THREE.BackSide }),
);
canInside.position.y = (RIM - 0.04) / 2 + 0.02;
canGroup.add(canInside);
const canFloorMesh = new THREE.Mesh(
  new THREE.CircleGeometry(BASE_R * 0.87, 40),
  new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 1 }),
);
canFloorMesh.rotation.x = -Math.PI / 2;
canFloorMesh.position.y = 0.03;
canGroup.add(canFloorMesh);
const rim = new THREE.Mesh(
  new THREE.TorusGeometry(BASE_R, 0.024, 12, 40),
  new THREE.MeshStandardMaterial({ color: 0x99a3b0, metalness: 0.85, roughness: 0.22 }),
);
rim.rotation.x = Math.PI / 2;
rim.position.y = RIM;
rim.castShadow = true;
canGroup.add(rim);

// ---- Potted plants near the wall -----------------------------------
function plant(x: number, z: number) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.2, 0.42, 16),
    new THREE.MeshStandardMaterial({ color: 0xc06a4b, roughness: 0.8 }),
  );
  pot.position.y = 0.21;
  pot.castShadow = true;
  g.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4e, roughness: 0.7, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), leafMat);
    leaf.position.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.35, (Math.random() - 0.5) * 0.3);
    leaf.scale.set(1, 1.5, 1);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  scene.add(g);
}
plant(-6, -WALLZ + 1.2);
plant(6, -WALLZ + 1.2);

// ---- Fan -----------------------------------------------------------
function buildFan() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.5, metalness: 0.4 });
  const light = new THREE.MeshStandardMaterial({ color: 0xaab6c4, roughness: 0.4, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.1, 14), dark);
  pole.position.y = 0.55;
  pole.castShadow = true;
  group.add(pole);
  const head = new THREE.Group();
  head.position.y = 1.1;
  group.add(head);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 10, 28), dark);
  cage.castShadow = true;
  head.add(cage);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 18), dark);
  hub.rotation.x = Math.PI / 2;
  head.add(hub);
  const blades = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.02), light);
    blade.position.y = 0.23;
    blade.castShadow = true;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i / 4) * Math.PI * 2;
    pivot.add(blade);
    blades.add(pivot);
  }
  head.add(blades);
  group.visible = false;
  scene.add(group);
  return { group, head, blades };
}
const fan = buildFan();

// ---- Confetti ------------------------------------------------------
const CONF_N = 110;
const confColors = [0xff5d73, 0xffd166, 0x4ad7d1, 0x6c8cff, 0x9b7bff, 0x5af08a];
const confPos = new Float32Array(CONF_N * 3);
const confCol = new Float32Array(CONF_N * 3);
const confVel: THREE.Vector3[] = [];
const confGeo = new THREE.BufferGeometry();
confGeo.setAttribute("position", new THREE.BufferAttribute(confPos, 3));
confGeo.setAttribute("color", new THREE.BufferAttribute(confCol, 3));
const confMat = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, depthWrite: false });
const confetti = new THREE.Points(confGeo, confMat);
confetti.visible = false;
scene.add(confetti);
for (let i = 0; i < CONF_N; i++) confVel.push(new THREE.Vector3());
let confLife = 0;
let confActive = false;
const _c = new THREE.Color();
function spawnConfetti(x: number, y: number, z: number) {
  for (let i = 0; i < CONF_N; i++) {
    confPos[i * 3] = x + (Math.random() - 0.5) * 0.2;
    confPos[i * 3 + 1] = y + Math.random() * 0.15;
    confPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
    confVel[i].set((Math.random() - 0.5) * 2.2, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 2.2);
    _c.setHex(confColors[(Math.random() * confColors.length) | 0]);
    confCol[i * 3] = _c.r;
    confCol[i * 3 + 1] = _c.g;
    confCol[i * 3 + 2] = _c.b;
  }
  confGeo.attributes.position.needsUpdate = true;
  confGeo.attributes.color.needsUpdate = true;
  confLife = 0;
  confActive = true;
  confMat.opacity = 1;
  confetti.visible = true;
}
function updateConfetti(dt: number) {
  if (!confActive) return;
  confLife += dt;
  for (let i = 0; i < CONF_N; i++) {
    confVel[i].y -= 9.8 * dt;
    confPos[i * 3] += confVel[i].x * dt;
    confPos[i * 3 + 1] += confVel[i].y * dt;
    confPos[i * 3 + 2] += confVel[i].z * dt;
  }
  confGeo.attributes.position.needsUpdate = true;
  confMat.opacity = Math.max(0, 1 - confLife / 1.4);
  if (confLife > 1.4) {
    confActive = false;
    confetti.visible = false;
  }
}

// ---- Game state ----------------------------------------------------
let phase: Phase = "aim";
let level = 1;
let makes = 0;
let score = 0;
let streak = 0;
let best = Number(localStorage.getItem("paperflick-best") || "0");

let canZ = 6;
let canR = 0.4;
let windMax = 0;
let windDir = 0;
let windLevel = 0;

const pos = { x: 0, y: START_Y, d: START_D };
const vel = { x: 0, y: 0, d: 0 };
const spin = new THREE.Vector3();
let resolved = false;
let flightT = 0;
let resultTimer = 0;
let acc = 0;
let time = 0;

// ---- HUD ------------------------------------------------------------
const elScore = document.getElementById("score")!;
const elSub = document.getElementById("substat")!;
const elWind = document.getElementById("wind")!;
const elHint = document.getElementById("hint")!;
const elResult = document.getElementById("result")!;
function updateHud() {
  elScore.textContent = `Score ${score}`;
  elSub.textContent = `Level ${level} · ${makes}/${MAKES_NEEDED} to next · Best ${best}`;
  if (windLevel === 0) {
    elWind.textContent = "Wind: calm";
    elWind.className = "pill calm";
  } else {
    elWind.textContent = `Wind ${windDir < 0 ? "←" : "→"} ${"•".repeat(windLevel)}`;
    elWind.className = "pill windy";
  }
}
function showResult(text: string, good: boolean) {
  elResult.textContent = text;
  elResult.className = "";
  void elResult.offsetWidth;
  elResult.classList.add("show", good ? "good" : "bad");
}

// ---- Level / round flow --------------------------------------------
function applyLevel() {
  const cfg = levelConfig(level);
  canZ = cfg.canZ;
  canR = cfg.canR;
  windMax = cfg.windMax;
  canGroup.position.z = -canZ;
  canGroup.scale.set(canR / BASE_R, 1, canR / BASE_R);
  canAnchor.position.z = -canZ;
}
function newWind() {
  windLevel = windMax === 0 ? 0 : Math.floor(Math.random() * (windMax + 1));
  windDir = windLevel === 0 ? 0 : Math.random() < 0.5 ? -1 : 1;
  fan.group.visible = windLevel > 0;
  if (windLevel > 0) {
    fan.group.position.set(-windDir * 4.4, 0, -Math.min(canZ - 1.5, 5));
    fan.head.rotation.y = windDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
}
function resetBall() {
  pos.x = 0;
  pos.y = START_Y;
  pos.d = START_D;
  vel.x = vel.y = vel.d = 0;
  resolved = false;
  flightT = 0;
  acc = 0;
  ballMesh.visible = true;
  ballMesh.rotation.set(0, 0, 0);
  phase = "aim";
  elHint.style.display = "";
}
function newRound() {
  applyLevel();
  newWind();
  resetBall();
  syncBall();
  updateHud();
}
function syncBall() {
  ballMesh.position.set(pos.x, pos.y, -pos.d);
}

applyLevel();
newWind();
resetBall();
syncBall();
updateHud();

// ---- Input ---------------------------------------------------------
let dragging = false;
let startPos = { x: 0, y: 0 };
let startTime = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (phase !== "aim") return;
  dragging = true;
  startPos = { x: e.clientX, y: e.clientY };
  startTime = performance.now();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  flick(e.clientX - startPos.x, e.clientY - startPos.y, Math.max(performance.now() - startTime, 1));
});
canvas.addEventListener("pointercancel", () => {
  dragging = false;
});
function flick(dx: number, dy: number, dtMs: number) {
  const H = window.innerHeight;
  const up = -dy;
  if (up < H * 0.06) return;
  if (Math.hypot(dx, dy) / dtMs < 0.25) return; // must be a flick

  const power = clamp(0.56 + 0.78 * (up / H), 0.35, 1.45);
  vel.d = power * LAUNCH_Z;
  vel.y = power * LAUNCH_Y;
  vel.x = clamp(dx / (window.innerWidth * 0.5), -1, 1) * VX_MAX;
  spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 18);
  phase = "flight";
  elHint.style.display = "none";
}

// ---- Physics -------------------------------------------------------
function resolve(good: boolean) {
  if (resolved) return;
  resolved = true;
  phase = "result";
  resultTimer = 1.3;
  if (good) {
    spawnConfetti(0, RIM + 0.15, -canZ);
    streak += 1;
    score += 1 + Math.floor(streak / 3);
    if (score > best) {
      best = score;
      localStorage.setItem("paperflick-best", String(best));
    }
    makes += 1;
    let leveled = false;
    if (makes >= MAKES_NEEDED) {
      level += 1;
      makes = 0;
      leveled = true;
    }
    showResult(leveled ? `Level ${level}!` : pick(["Swish!", "In!", "Nothing but net!", "Bullseye!"]), true);
  } else {
    streak = 0;
    showResult(pick(["Missed!", "So close!", "Air ball!", "Argh!"]), false);
  }
  updateHud();
}

function physStep(h: number) {
  flightT += h;
  vel.y -= G * h;
  const damp = Math.exp(-DRAG * h);
  vel.x *= damp;
  vel.y *= damp;
  vel.d *= damp;
  vel.x += windDir * windLevel * WIND_ACC * h;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.d += vel.d * h;
  ballMesh.rotation.x += spin.x * h;
  ballMesh.rotation.y += spin.y * h;
  ballMesh.rotation.z += spin.z * h;

  let ax = pos.x;
  let az = pos.d - canZ;
  let hr = Math.hypot(ax, az);

  // Rim lip (a ring at height RIM, radius canR): rattle in or out.
  if (hr > 1e-6) {
    const dirx = ax / hr;
    const dirz = az / hr;
    const dx = pos.x - canR * dirx;
    const dy = pos.y - RIM;
    const dz = pos.d - (canZ + canR * dirz);
    const dist = Math.hypot(dx, dy, dz);
    if (dist < BALL_R && dist > 1e-6) {
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;
      const vn = vel.x * nx + vel.y * ny + vel.d * nz;
      if (vn < 0) {
        vel.x -= (1 + E_RIM) * vn * nx;
        vel.y -= (1 + E_RIM) * vn * ny;
        vel.d -= (1 + E_RIM) * vn * nz;
      }
      const pen = BALL_R - dist;
      pos.x += nx * pen;
      pos.y += ny * pen;
      pos.d += nz * pen;
      ax = pos.x;
      az = pos.d - canZ;
      hr = Math.hypot(ax, az);
    }
  }

  // Committed inside the mouth → it's going in.
  if (!resolved && pos.y < RIM - BALL_R * 0.5 && hr < canR - BALL_R * 0.6) {
    resolve(true);
  }

  // Can body wall (below the rim).
  if (pos.y < RIM && Math.abs(hr - canR) < BALL_R && hr > 1e-6) {
    const outside = hr >= canR;
    const target = outside ? canR + BALL_R : canR - BALL_R;
    const nxh = ax / hr;
    const nzh = az / hr;
    pos.x = nxh * target;
    pos.d = canZ + nzh * target;
    const vn = vel.x * nxh + vel.d * nzh;
    if ((outside && vn < 0) || (!outside && vn > 0)) {
      vel.x -= (1 + E_WALL) * vn * nxh;
      vel.d -= (1 + E_WALL) * vn * nzh;
    }
  }

  // Back wall.
  if (pos.d + BALL_R > WALLZ) {
    pos.d = WALLZ - BALL_R;
    if (vel.d > 0) vel.d = -vel.d * E_WALL;
  }

  // Floor.
  if (pos.y <= BALL_R) {
    pos.y = BALL_R;
    if (vel.y < 0) vel.y = -vel.y * E_FLOOR;
    vel.x *= FRIC;
    vel.d *= FRIC;
    if (Math.hypot(vel.x, vel.y, vel.d) < SLEEP && !resolved) resolve(false);
  }

  if (!resolved && flightT > 5) resolve(false);
}

// ---- Step / loop ---------------------------------------------------
function step(dt: number) {
  time += dt;
  if (windLevel > 0) fan.blades.rotation.z += dt * (5 + windLevel * 2.5);
  updateConfetti(dt);

  if (phase === "aim") {
    pos.y = START_Y + Math.sin(time * 2) * 0.012;
    syncBall();
    return;
  }

  // flight or result: advance the rigid-body sim in fixed substeps.
  acc += dt;
  let n = 0;
  while (acc >= PH && n < 24) {
    physStep(PH);
    acc -= PH;
    n++;
  }
  syncBall();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;

  step(dt);
  if (phase === "result") {
    resultTimer -= dt;
    if (resultTimer <= 0) newRound();
  }

  camera.position.x = CAM_BASE.x + Math.sin(time * 0.35) * 0.06;
  camera.position.y = CAM_BASE.y + Math.sin(time * 0.5) * 0.02;
  camera.lookAt(0, 0.2, -7.5);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- Service worker (PWA) -----------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is best-effort */
    });
  });
}
