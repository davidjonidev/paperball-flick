import "./style.css";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ------------------------------------------------------------------ *
 * Paper Flick — a Paper Toss-style game in real 3D (Three.js).
 * Swipe up to flick the paper ball across the room and into the trash.
 * Watch the wind! Playable on web, iOS and Android.
 *
 * Coordinates: metres, Y up, the room recedes toward -Z. A ball's
 * "depth" d is its distance into the room; its mesh sits at z = -d.
 * ------------------------------------------------------------------ */

// ---- World / physics constants (tuned & simulation-verified) -------
const WORLD = {
  startX: 0,
  startY: 0.55,
  startD: 0.35,
  canZ: 7.5,
  canRadius: 0.3,
  canRimHeight: 0.58,
  ballRadius: 0.075,
  gravity: 9.8,
  latTol: 0.26,
  zTol: 1.0,
};

const VZ_MAX = 5.11;
const VY_MAX = 6.88;
const VX_MAX = 1.6;
const WIND_ACC = 0.62;

type Phase = "aim" | "flight" | "result";

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

// ---- Scene + image-based lighting (soft studio reflections) --------
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.fog = new THREE.Fog(0xd7e2ee, 11, 24);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
const CAM_BASE = new THREE.Vector3(0, 1.35, 1.2);
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0.2, -7.5);

// ---- Lighting ------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x6b5640, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e2, 1.7);
sun.position.set(4, 8.5, 3.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 26;
sun.shadow.camera.left = -7;
sun.shadow.camera.right = 7;
sun.shadow.camera.top = 7;
sun.shadow.camera.bottom = -7;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 4;
sun.target.position.set(0, 0, -6.5);
scene.add(sun, sun.target);

// ---- Procedural textures -------------------------------------------
function makeCanvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, x: c.getContext("2d")! };
}

function floorTexture() {
  const { c, x } = makeCanvas(512);
  x.fillStyle = "#b98c5e"; // warm wood base
  x.fillRect(0, 0, 512, 512);
  const planks = 6;
  const pw = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.92 + ((i * 37) % 10) / 80;
    x.fillStyle = `rgba(${Math.round(176 * shade)},${Math.round(
      130 * shade,
    )},${Math.round(86 * shade)},1)`;
    x.fillRect(i * pw, 0, pw - 2, 512);
    x.fillStyle = "rgba(70,48,24,0.35)"; // seam
    x.fillRect(i * pw + pw - 2, 0, 2, 512);
  }
  // subtle speckle / grain
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
  // soft focal glow behind the can
  const rg = x.createRadialGradient(256, 300, 30, 256, 300, 320);
  rg.addColorStop(0, "rgba(255,255,255,0.55)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = rg;
  x.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Room ----------------------------------------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 44),
  new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const backWall = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 16),
  new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 1 }),
);
backWall.position.set(0, 8, -13);
backWall.receiveShadow = true;
scene.add(backWall);

// Baseboard for a finished look.
const baseboard = new THREE.Mesh(
  new THREE.BoxGeometry(30, 0.22, 0.05),
  new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.8 }),
);
baseboard.position.set(0, 0.11, -12.97);
scene.add(baseboard);

// Soft round rug under the can to anchor it.
const rug = new THREE.Mesh(
  new THREE.CircleGeometry(0.95, 48),
  new THREE.MeshStandardMaterial({ color: 0x2f7d72, roughness: 0.95 }),
);
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.012, -WORLD.canZ);
rug.receiveShadow = true;
scene.add(rug);
const rugRing = new THREE.Mesh(
  new THREE.RingGeometry(0.8, 0.9, 48),
  new THREE.MeshStandardMaterial({ color: 0x6fd3c2, roughness: 0.9 }),
);
rugRing.rotation.x = -Math.PI / 2;
rugRing.position.set(0, 0.014, -WORLD.canZ);
scene.add(rugRing);

// ---- Trash can -----------------------------------------------------
const canGroup = new THREE.Group();
canGroup.position.set(0, 0, -WORLD.canZ);
scene.add(canGroup);

const metal = new THREE.MeshStandardMaterial({
  color: 0x707a87,
  metalness: 0.75,
  roughness: 0.32,
  side: THREE.DoubleSide,
});
const canBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.3, 0.235, WORLD.canRimHeight, 40, 1, true),
  metal,
);
canBody.position.y = WORLD.canRimHeight / 2;
canBody.castShadow = true;
canBody.receiveShadow = true;
canGroup.add(canBody);

const canInside = new THREE.Mesh(
  new THREE.CylinderGeometry(0.27, 0.21, WORLD.canRimHeight - 0.04, 40, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.5, roughness: 0.7, side: THREE.BackSide }),
);
canInside.position.y = (WORLD.canRimHeight - 0.04) / 2 + 0.02;
canGroup.add(canInside);

const canFloor = new THREE.Mesh(
  new THREE.CircleGeometry(0.26, 40),
  new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 1 }),
);
canFloor.rotation.x = -Math.PI / 2;
canFloor.position.y = 0.03;
canGroup.add(canFloor);

const rim = new THREE.Mesh(
  new THREE.TorusGeometry(0.3, 0.024, 12, 40),
  new THREE.MeshStandardMaterial({ color: 0x99a3b0, metalness: 0.85, roughness: 0.22 }),
);
rim.rotation.x = Math.PI / 2;
rim.position.y = WORLD.canRimHeight;
rim.castShadow = true;
canGroup.add(rim);

// ---- Crumpled paper ball -------------------------------------------
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
  metalness: 0,
  flatShading: true,
});
const ballMesh = new THREE.Mesh(makeBallGeometry(WORLD.ballRadius), paperMat);
ballMesh.castShadow = true;
scene.add(ballMesh);

// A few missed balls scattered near the can for context.
for (let i = 0; i < 6; i++) {
  const s = 0.7 + Math.random() * 0.7;
  const m = new THREE.Mesh(makeBallGeometry(WORLD.ballRadius * s), paperMat);
  const ang = Math.random() * Math.PI * 2;
  const dist = 0.55 + Math.random() * 1.0;
  m.position.set(Math.sin(ang) * dist, WORLD.ballRadius * s, -WORLD.canZ + Math.cos(ang) * dist);
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  m.castShadow = true;
  scene.add(m);
}

// ---- Potted plants in the back corners -----------------------------
function plant(x: number, z: number) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.2, 0.42, 16),
    new THREE.MeshStandardMaterial({ color: 0xc06a4b, roughness: 0.8 }),
  );
  pot.position.y = 0.21;
  pot.castShadow = true;
  pot.receiveShadow = true;
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
plant(-5.5, -11.5);
plant(5.5, -11.5);

// ---- Fan (wind source) --------------------------------------------
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

// ---- Confetti burst (on score) -------------------------------------
const CONFETTI_N = 110;
const confColors = [0xff5d73, 0xffd166, 0x4ad7d1, 0x6c8cff, 0x9b7bff, 0x5af08a];
const confPos = new Float32Array(CONFETTI_N * 3);
const confCol = new Float32Array(CONFETTI_N * 3);
const confVel: THREE.Vector3[] = [];
const confGeo = new THREE.BufferGeometry();
confGeo.setAttribute("position", new THREE.BufferAttribute(confPos, 3));
confGeo.setAttribute("color", new THREE.BufferAttribute(confCol, 3));
const confMat = new THREE.PointsMaterial({
  size: 0.1,
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  sizeAttenuation: true,
});
const confetti = new THREE.Points(confGeo, confMat);
confetti.visible = false;
scene.add(confetti);
for (let i = 0; i < CONFETTI_N; i++) confVel.push(new THREE.Vector3());
let confLife = 0;
let confActive = false;
const _c = new THREE.Color();

function spawnConfetti(x: number, y: number, z: number) {
  for (let i = 0; i < CONFETTI_N; i++) {
    confPos[i * 3] = x + (Math.random() - 0.5) * 0.2;
    confPos[i * 3 + 1] = y + Math.random() * 0.15;
    confPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
    confVel[i].set(
      (Math.random() - 0.5) * 2.2,
      2.5 + Math.random() * 3.0,
      (Math.random() - 0.5) * 2.2,
    );
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
  for (let i = 0; i < CONFETTI_N; i++) {
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
let score = 0;
let streak = 0;
let best = Number(localStorage.getItem("paperflick-best") || "0");
let windDir = 0;
let windLevel = 0;

const pos = { x: WORLD.startX, y: WORLD.startY, d: WORLD.startD };
const vel = { x: 0, y: 0, d: 0 };
const spin = new THREE.Vector3();
let dropping = false;
let resultTimer = 0;
let time = 0;

// ---- HUD ------------------------------------------------------------
const elScore = document.getElementById("score")!;
const elSub = document.getElementById("substat")!;
const elWind = document.getElementById("wind")!;
const elHint = document.getElementById("hint")!;
const elResult = document.getElementById("result")!;

function updateHud() {
  elScore.textContent = `Score ${score}`;
  elSub.textContent = `Streak ${streak} · Best ${best}`;
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

// ---- Round flow ----------------------------------------------------
function newWind() {
  windLevel = Math.floor(Math.random() * 4);
  windDir = windLevel === 0 ? 0 : Math.random() < 0.5 ? -1 : 1;
  fan.group.visible = windLevel > 0;
  if (windLevel > 0) {
    fan.group.position.set(-windDir * 4.2, 0, -4);
    fan.head.rotation.y = windDir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  updateHud();
}

function resetBall() {
  pos.x = WORLD.startX;
  pos.y = WORLD.startY;
  pos.d = WORLD.startD;
  vel.x = vel.y = vel.d = 0;
  dropping = false;
  ballMesh.visible = true;
  ballMesh.rotation.set(0, 0, 0);
  phase = "aim";
  elHint.style.display = "";
}

function syncBall() {
  ballMesh.position.set(pos.x, pos.y, -pos.d);
}

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
  const speed = Math.hypot(dx, dy) / dtMs;
  if (speed < 0.25) return;

  const power = clamp(1.0 + (up / H - 0.42) * 0.54, 0.2, 1.6);
  vel.d = power * VZ_MAX;
  vel.y = power * VY_MAX;
  vel.x = clamp(dx / (window.innerWidth * 0.5), -1, 1) * VX_MAX;
  spin.set(
    (Math.random() - 0.5) * 18,
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 18,
  );
  phase = "flight";
  elHint.style.display = "none";
}

// ---- Simulation ----------------------------------------------------
function step(dt: number) {
  time += dt;
  if (windLevel > 0) fan.blades.rotation.z += dt * (5 + windLevel * 2.5);
  updateConfetti(dt);

  if (phase === "aim") {
    pos.y = WORLD.startY + Math.sin(time * 2) * 0.012;
    syncBall();
    return;
  }

  if (phase === "result") {
    if (dropping) {
      pos.x += (0 - pos.x) * Math.min(1, dt * 9);
      pos.d += (WORLD.canZ - pos.d) * Math.min(1, dt * 9);
      vel.y -= WORLD.gravity * dt;
      pos.y += vel.y * dt;
      ballMesh.rotation.x += spin.x * dt;
      ballMesh.rotation.z += spin.z * dt;
      syncBall();
      if (pos.y < 0.1) {
        ballMesh.visible = false;
        dropping = false;
      }
    }
    return;
  }

  // flight
  const prevY = pos.y;
  const prevX = pos.x;
  const prevD = pos.d;

  vel.x += windDir * windLevel * WIND_ACC * dt;
  vel.y -= WORLD.gravity * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.d += vel.d * dt;

  ballMesh.rotation.x += spin.x * dt;
  ballMesh.rotation.y += spin.y * dt;
  ballMesh.rotation.z += spin.z * dt;
  syncBall();

  if (vel.y < 0 && prevY > WORLD.canRimHeight && pos.y <= WORLD.canRimHeight) {
    const t = (prevY - WORLD.canRimHeight) / (prevY - pos.y);
    const xc = prevX + (pos.x - prevX) * t;
    const dc = prevD + (pos.d - prevD) * t;
    if (Math.abs(xc) <= WORLD.latTol && Math.abs(dc - WORLD.canZ) <= WORLD.zTol) {
      land(true);
      return;
    }
  }
  if (pos.y <= 0) {
    pos.y = WORLD.ballRadius;
    syncBall();
    land(false);
    return;
  }
  if (pos.d > WORLD.canZ + 3) land(false);
}

function land(didScore: boolean) {
  phase = "result";
  resultTimer = 1.05;
  if (didScore) {
    dropping = true;
    spawnConfetti(0, WORLD.canRimHeight + 0.15, -WORLD.canZ);
    streak += 1;
    score += 1 + Math.floor(streak / 3);
    if (score > best) {
      best = score;
      localStorage.setItem("paperflick-best", String(best));
    }
    showResult(pick(["Swish!", "In!", "Nothing but net!", "Bullseye!"]), true);
  } else {
    streak = 0;
    showResult(pick(["Missed!", "So close!", "Air ball!", "Argh!"]), false);
  }
  updateHud();
}

// ---- Helpers -------------------------------------------------------
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Resize --------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---- Main loop -----------------------------------------------------
let last = performance.now();
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;

  step(dt);
  if (phase === "result") {
    resultTimer -= dt;
    if (resultTimer <= 0) {
      newWind();
      resetBall();
      syncBall();
    }
  }

  // Gentle idle camera sway for life.
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
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        /* offline support is best-effort */
      });
  });
}
