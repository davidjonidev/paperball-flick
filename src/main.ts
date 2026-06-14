import "./style.css";
import * as THREE from "three";

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
  startY: 0.55, // height the ball is held at
  startD: 0.35, // depth in front of the camera
  canZ: 7.5, // depth of the trash can
  canRadius: 0.3, // visual radius of the can opening
  canRimHeight: 0.58, // height of the can's mouth
  ballRadius: 0.075,
  gravity: 9.8,
  // Scoring: generous in depth (perspective hides it) but tight
  // laterally, so judging the wind is the real skill.
  latTol: 0.26,
  zTol: 1.0,
};

// A "perfect" throw is power = 1; a comfortable ~42%-screen flick maps there.
const VZ_MAX = 5.11; // forward (depth) velocity at full power
const VY_MAX = 6.88; // upward (lob) velocity at full power
const VX_MAX = 1.6; // lateral velocity from a sideways swipe
const WIND_ACC = 0.62; // lateral acceleration per wind level

type Phase = "aim" | "flight" | "result";

// ---- Renderer / scene ---------------------------------------------
const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY = 0xcfd9e6;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 9, 22);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
camera.position.set(0, 1.35, 1.2);
camera.lookAt(0, 0.2, -7.5);

// ---- Lighting ------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const sun = new THREE.DirectionalLight(0xffffff, 0.95);
sun.position.set(3.5, 8, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 25;
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.bias = -0.0005;
sun.target.position.set(0, 0, -6);
scene.add(sun);
scene.add(sun.target);

// ---- Room ----------------------------------------------------------
const floorMat = new THREE.MeshStandardMaterial({
  color: 0xb98c5e,
  roughness: 0.96,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 40), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({
  color: 0xd6e0ec,
  roughness: 1,
});
const backWall = new THREE.Mesh(new THREE.PlaneGeometry(28, 14), wallMat);
backWall.position.set(0, 7, -13);
backWall.receiveShadow = true;
scene.add(backWall);

// ---- Trash can -----------------------------------------------------
const canGroup = new THREE.Group();
canGroup.position.set(0, 0, -WORLD.canZ);
scene.add(canGroup);

const metal = new THREE.MeshStandardMaterial({
  color: 0x5b6470,
  metalness: 0.25,
  roughness: 0.55,
  side: THREE.DoubleSide,
});
const canBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.3, 0.24, WORLD.canRimHeight, 28, 1, true),
  metal,
);
canBody.position.y = WORLD.canRimHeight / 2;
canBody.castShadow = true;
canBody.receiveShadow = true;
canGroup.add(canBody);

const canInside = new THREE.Mesh(
  new THREE.CircleGeometry(0.27, 28),
  new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 1 }),
);
canInside.rotation.x = -Math.PI / 2;
canInside.position.y = 0.04;
canGroup.add(canInside);

const rim = new THREE.Mesh(
  new THREE.TorusGeometry(0.3, 0.022, 10, 28),
  new THREE.MeshStandardMaterial({ color: 0x79828f, metalness: 0.3, roughness: 0.5 }),
);
rim.rotation.x = Math.PI / 2;
rim.position.y = WORLD.canRimHeight;
rim.castShadow = true;
canGroup.add(rim);

// ---- Paper ball (crumpled low-poly) --------------------------------
function makeBallGeometry() {
  const geo = new THREE.IcosahedronGeometry(WORLD.ballRadius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const f = 1 + (Math.random() - 0.5) * 0.22; // crumple
    v.multiplyScalar(f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
const ballMesh = new THREE.Mesh(
  makeBallGeometry(),
  new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.85, flatShading: true }),
);
ballMesh.castShadow = true;
scene.add(ballMesh);

// ---- Fan (wind source) --------------------------------------------
function buildFan() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4654, roughness: 0.6, metalness: 0.2 });
  const light = new THREE.MeshStandardMaterial({ color: 0x9aa7b5, roughness: 0.5, metalness: 0.3 });

  // Pole to the floor.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 12), dark);
  pole.position.y = 0.55;
  pole.castShadow = true;
  group.add(pole);

  // Head faces along its local +Z; we aim that at the room centre.
  const head = new THREE.Group();
  head.position.y = 1.1;
  group.add(head);

  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 24), dark);
  cage.castShadow = true;
  head.add(cage);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 16), dark);
  hub.rotation.x = Math.PI / 2;
  head.add(hub);

  const blades = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.02), light);
    blade.position.y = 0.22;
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

// ---- Game state ----------------------------------------------------
let phase: Phase = "aim";
let score = 0;
let streak = 0;
let best = Number(localStorage.getItem("paperflick-best") || "0");

let windDir = 0; // -1 left, +1 right
let windLevel = 0; // 0..3

const pos = { x: WORLD.startX, y: WORLD.startY, d: WORLD.startD };
const vel = { x: 0, y: 0, d: 0 };
const spin = new THREE.Vector3();

let resultTimer = 0;
let time = 0;

// ---- HUD (DOM overlay) ---------------------------------------------
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
    elWind.className = "calm";
  } else {
    const arrow = windDir < 0 ? "←" : "→";
    elWind.textContent = `Wind ${arrow} ${"•".repeat(windLevel)}`;
    elWind.className = "windy";
  }
}

function showResult(text: string, good: boolean) {
  elResult.textContent = text;
  elResult.className = "";
  void elResult.offsetWidth; // restart the CSS animation
  elResult.classList.add("show", good ? "good" : "bad");
}

// ---- Round flow ----------------------------------------------------
function newWind() {
  windLevel = Math.floor(Math.random() * 4);
  windDir = windLevel === 0 ? 0 : Math.random() < 0.5 ? -1 : 1;
  fan.group.visible = windLevel > 0;
  if (windLevel > 0) {
    // Fan sits upwind and blows toward windDir.
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

// ---- Input (pointer = mouse + touch) ------------------------------
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
  const dt = Math.max(performance.now() - startTime, 1);
  flick(e.clientX - startPos.x, e.clientY - startPos.y, dt);
});

canvas.addEventListener("pointercancel", () => {
  dragging = false;
});

function flick(dx: number, dy: number, dtMs: number) {
  const H = window.innerHeight;
  const up = -dy; // upward swipe distance (px)
  if (up < H * 0.06) return; // ignore taps / downward flicks

  const speed = Math.hypot(dx, dy) / dtMs; // px per ms
  if (speed < 0.25) return; // must be a flick, not a slow drag

  // Distance-driven, forgiving: a ~42%-screen flick is perfect.
  const power = clamp(1.0 + (up / H - 0.42) * 0.54, 0.2, 1.6);

  vel.d = power * VZ_MAX;
  vel.y = power * VY_MAX;
  vel.x = clamp(dx / (window.innerWidth * 0.5), -1, 1) * VX_MAX;

  // Random tumble for visual flair.
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

  if (phase === "aim") {
    pos.y = WORLD.startY + Math.sin(time * 2) * 0.012; // gentle bob
    syncBall();
    return;
  }

  if (phase !== "flight") return;

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

  // Descending through the rim height → check if over the mouth.
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
  resultTimer = 0.95;
  if (didScore) {
    ballMesh.visible = false; // dropped inside
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
