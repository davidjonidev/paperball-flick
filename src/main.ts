import "./style.css";

/* ------------------------------------------------------------------ *
 * Paper Flick — a Paper Toss-style game.
 * Swipe up to flick the paper ball across the room and into the trash.
 * Watch the wind! Pure HTML5 Canvas + TypeScript, no dependencies.
 * ------------------------------------------------------------------ */

// ---- World / physics constants (tuned for a satisfying arc) --------
const WORLD = {
  eyeHeight: 1.25, // camera height above floor (m)
  focal: 3.6, // perspective focal length (world units)
  startX: 0,
  startY: 0.55, // height the ball is held at
  startZ: 0.35, // distance in front of camera
  canZ: 7.5, // how far away the trash can sits
  canRadius: 0.3, // visual radius of the can opening
  canRimHeight: 0.58, // height of the can's mouth
  ballRadius: 0.075,
  gravity: 9.8,
  // Scoring tolerances: generous in depth (hard to judge, hidden by
  // perspective) but tight laterally, so the wind is the real challenge.
  latTol: 0.26, // |x| must be within this of the can centre
  zTol: 1.0, // depth slack around the can
};

// A "perfect" throw (power = 1) drops straight into the can; the swipe→power
// mapping centres a comfortable ~42%-screen flick on power 1.
const VZ_MAX = 5.11; // forward velocity at full power
const VY_MAX = 6.88; // upward (lob) velocity at full power
const VX_MAX = 1.6; // lateral velocity from a sideways swipe
const WIND_ACC = 0.62; // lateral acceleration per wind level

type Phase = "aim" | "flight" | "result";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let W = 0; // CSS pixels
let H = 0;
let DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---- Perspective projection ---------------------------------------
// Project a world point to screen-space, returning x/y in CSS px and the
// perspective scale factor `p` (1 = right at the camera, →0 far away).
function project(p: Vec3) {
  const persp = WORLD.focal / (WORLD.focal + p.z);
  const S = H * 0.62; // world-units → pixels at p = 1
  const horizonY = H * 0.4;
  const sx = W / 2 + p.x * persp * S;
  const sy = horizonY + (WORLD.eyeHeight - p.y) * persp * S;
  return { sx, sy, persp, S };
}

// ---- Game state ----------------------------------------------------
let phase: Phase = "aim";
let score = 0;
let streak = 0;
let best = Number(localStorage.getItem("paperflick-best") || "0");

// Wind for the current round.
let windDir = 0; // -1 (left) .. +1 (right)
let windLevel = 0; // 0..3

// Active ball.
const ball: Vec3 = { x: WORLD.startX, y: WORLD.startY, z: WORLD.startZ };
const vel: Vec3 = { x: 0, y: 0, z: 0 };
let ballSpin = 0;

// Result overlay.
let resultText = "";
let resultGood = false;
let resultTimer = 0;

// Idle bob.
let time = 0;

function newWind() {
  windLevel = Math.floor(Math.random() * 4); // 0..3
  windDir = windLevel === 0 ? 0 : Math.random() < 0.5 ? -1 : 1;
}

function resetBall() {
  ball.x = WORLD.startX;
  ball.y = WORLD.startY;
  ball.z = WORLD.startZ;
  vel.x = vel.y = vel.z = 0;
  ballSpin = 0;
  phase = "aim";
}

newWind();

// ---- Input (pointer = mouse + touch) ------------------------------
let dragging = false;
let startPos = { x: 0, y: 0 };
let startTime = 0;
let curPos = { x: 0, y: 0 };

canvas.addEventListener("pointerdown", (e) => {
  if (phase === "result") return; // wait for auto-advance
  if (phase !== "aim") return;
  dragging = true;
  startPos = { x: e.clientX, y: e.clientY };
  curPos = { ...startPos };
  startTime = performance.now();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  curPos = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  const dt = Math.max(performance.now() - startTime, 1);
  const dx = e.clientX - startPos.x;
  const dy = e.clientY - startPos.y; // up is negative
  flick(dx, dy, dt);
});

canvas.addEventListener("pointercancel", () => {
  dragging = false;
});

function flick(dx: number, dy: number, dtMs: number) {
  const up = -dy; // upward swipe distance (px)
  if (up < H * 0.06) return; // ignore taps / downward flicks

  const len = Math.hypot(dx, dy);
  const speed = len / dtMs; // px per ms
  if (speed < 0.25) return; // must be a flick, not a slow drag

  // Power is distance-driven and forgiving: a ~42%-screen flick is perfect,
  // and roughly a 30%–54% flick still scores in calm wind.
  const power = clamp(1.0 + (up / H - 0.42) * 0.54, 0.2, 1.6);

  vel.z = power * VZ_MAX;
  vel.y = power * VY_MAX;
  vel.x = clamp(dx / (W * 0.5), -1, 1) * VX_MAX;
  phase = "flight";
}

// ---- Simulation ----------------------------------------------------
let scored = false;

function step(dt: number) {
  time += dt;
  if (phase !== "flight") return;

  const prevZ = ball.z;
  const prevY = ball.y;
  const prevX = ball.x;

  // Wind pushes laterally throughout the flight.
  vel.x += windDir * windLevel * WIND_ACC * dt;
  vel.y -= WORLD.gravity * dt;

  ball.x += vel.x * dt;
  ball.y += vel.y * dt;
  ball.z += vel.z * dt;
  ballSpin += dt * 12;

  // As the ball descends through the rim height, check if it's over the can
  // mouth — this is the natural "drops into the cup" test.
  if (vel.y < 0 && prevY > WORLD.canRimHeight && ball.y <= WORLD.canRimHeight) {
    const t = (prevY - WORLD.canRimHeight) / (prevY - ball.y);
    const xc = prevX + (ball.x - prevX) * t;
    const zc = prevZ + (ball.z - prevZ) * t;
    const overMouth =
      Math.abs(xc) <= WORLD.latTol && Math.abs(zc - WORLD.canZ) <= WORLD.zTol;
    if (overMouth) {
      land(true);
      return;
    }
  }

  // Hit the floor → missed.
  if (ball.y <= 0) {
    ball.y = 0;
    land(false);
    return;
  }

  // Flew well past the can without going in → missed.
  if (ball.z > WORLD.canZ + 3) {
    land(false);
  }
}

function land(didScore: boolean) {
  scored = didScore;
  phase = "result";
  resultTimer = didScore ? 1.0 : 0.9;
  resultGood = didScore;
  if (didScore) {
    streak += 1;
    score += 1 + Math.floor(streak / 3); // streak bonus
    resultText = pick(["Swish!", "Nothing but net!", "In!", "Bullseye!"]);
    if (score > best) {
      best = score;
      localStorage.setItem("paperflick-best", String(best));
    }
  } else {
    streak = 0;
    resultText = pick(["Missed!", "So close!", "Air ball!", "Try again"]);
  }
}

function afterResult() {
  newWind();
  resetBall();
}

// ---- Rendering -----------------------------------------------------
function draw() {
  // Sky / back wall.
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, "#dfe7ef");
  wall.addColorStop(1, "#c2cedd");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);

  const horizonY = H * 0.4;

  // Floor.
  const floor = ctx.createLinearGradient(0, horizonY, 0, H);
  floor.addColorStop(0, "#b08c63");
  floor.addColorStop(1, "#8a6a45");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizonY, W, H - horizonY);

  // Floorboard perspective lines.
  ctx.strokeStyle = "rgba(60,40,20,0.18)";
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    const a = project({ x: i * 0.7, y: 0, z: 0.2 });
    const b = project({ x: i * 0.7, y: 0, z: 12 });
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }

  drawFan();
  drawCanBack();
  drawShadow();
  drawBall();
  drawCanFront();
  drawHUD();
  drawAimHint();
  drawResult();
}

function drawCanBack() {
  // Trash can drawn as a tapered cylinder. Back half (rim ellipse + body).
  const rim = project({ x: 0, y: WORLD.canRimHeight, z: WORLD.canZ });
  const base = project({ x: 0, y: 0, z: WORLD.canZ });
  const rTop = WORLD.canRadius * rim.persp * rim.S;
  const rBot = WORLD.canRadius * 0.82 * base.persp * base.S;
  const ellH = rTop * 0.42;

  // Body.
  ctx.fillStyle = "#5b6470";
  ctx.beginPath();
  ctx.moveTo(rim.sx - rTop, rim.sy);
  ctx.lineTo(base.sx - rBot, base.sy);
  ctx.lineTo(base.sx + rBot, base.sy);
  ctx.lineTo(rim.sx + rTop, rim.sy);
  ctx.closePath();
  ctx.fill();

  // Vertical sheen.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(rim.sx - rTop * 0.5, rim.sy);
  ctx.lineTo(base.sx - rBot * 0.5, base.sy);
  ctx.lineTo(base.sx - rBot * 0.15, base.sy);
  ctx.lineTo(rim.sx - rTop * 0.15, rim.sy);
  ctx.closePath();
  ctx.fill();

  // Inside of the can (dark) — the opening.
  ctx.fillStyle = "#23272e";
  ctx.beginPath();
  ctx.ellipse(rim.sx, rim.sy, rTop, ellH, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCanFront() {
  // Front rim lip drawn over the ball so a scored ball disappears inside.
  const rim = project({ x: 0, y: WORLD.canRimHeight, z: WORLD.canZ });
  const rTop = WORLD.canRadius * rim.persp * rim.S;
  const ellH = rTop * 0.42;

  ctx.lineWidth = Math.max(2, rTop * 0.18);
  ctx.strokeStyle = "#6b7480";
  ctx.beginPath();
  ctx.ellipse(rim.sx, rim.sy, rTop, ellH, 0, 0, Math.PI, false);
  ctx.stroke();
}

function drawShadow() {
  if (phase === "aim") {
    const s = project({ x: ball.x, y: 0, z: ball.z });
    const r = WORLD.ballRadius * s.persp * s.S;
    shadowEllipse(s.sx, s.sy, r * 1.2, r * 0.4, 0.25);
    return;
  }
  const s = project({ x: ball.x, y: 0, z: ball.z });
  const r = WORLD.ballRadius * s.persp * s.S;
  const fade = clamp(1 - ball.y / 2.5, 0.05, 0.35);
  shadowEllipse(s.sx, s.sy, r * (1 + ball.y * 0.2), r * 0.42, fade);
}

function shadowEllipse(
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number,
) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall() {
  // Skip drawing once a scored ball has dropped below the rim (it's "inside").
  const b = phase === "aim" ? bobbedBall() : ball;
  const s = project(b);
  const r = Math.max(2, WORLD.ballRadius * s.persp * s.S);

  if (scored && phase === "result") {
    return; // dropped inside the can
  }

  // Crumpled paper ball: white circle with shading + facets.
  const grad = ctx.createRadialGradient(
    s.sx - r * 0.35,
    s.sy - r * 0.35,
    r * 0.1,
    s.sx,
    s.sy,
    r,
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#cdd2d8");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
  ctx.fill();

  // Crumple facets (rotate with spin for a tumbling feel).
  ctx.save();
  ctx.translate(s.sx, s.sy);
  ctx.rotate(ballSpin);
  ctx.strokeStyle = "rgba(120,130,140,0.5)";
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15);
    ctx.lineTo(Math.cos(a + 1.1) * r * 0.85, Math.sin(a + 1.1) * r * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

function bobbedBall(): Vec3 {
  return {
    x: WORLD.startX,
    y: WORLD.startY + Math.sin(time * 2) * 0.015,
    z: WORLD.startZ,
  };
}

function drawFan() {
  // Wind source on the side of the room, like the classic office fan.
  if (windLevel === 0) return;
  const side = windDir; // blows in this direction; fan sits upwind
  const fanX = side > 0 ? W * 0.1 : W * 0.9;
  const fanY = H * 0.55;
  const R = Math.min(W, H) * 0.06;

  ctx.save();
  ctx.translate(fanX, fanY);
  // Housing.
  ctx.fillStyle = "#3a4654";
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  // Blades.
  ctx.rotate(time * (4 + windLevel * 2));
  ctx.fillStyle = "#9aa7b5";
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.ellipse(R * 0.45, 0, R * 0.5, R * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#2b333d";
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHUD() {
  const pad = Math.max(14, H * 0.02);
  const top = pad + safeTop();

  ctx.textBaseline = "top";
  ctx.fillStyle = "#1b2430";

  // Score.
  ctx.textAlign = "left";
  ctx.font = `700 ${Math.round(H * 0.04)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(`Score ${score}`, pad, top);

  ctx.font = `600 ${Math.round(H * 0.022)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = "#41506b";
  ctx.fillText(`Streak ${streak}   ·   Best ${best}`, pad, top + H * 0.045);

  // Wind indicator (top-right).
  ctx.textAlign = "right";
  ctx.font = `700 ${Math.round(H * 0.024)}px -apple-system, system-ui, sans-serif`;
  ctx.fillStyle = windLevel === 0 ? "#3a7d44" : "#b4453a";
  const label =
    windLevel === 0
      ? "Wind: calm"
      : `Wind ${arrow(windDir)} ${"•".repeat(windLevel)}`;
  ctx.fillText(label, W - pad, top);
}

function arrow(dir: number) {
  return dir < 0 ? "←" : "→";
}

function drawAimHint() {
  if (phase !== "aim") return;

  if (dragging) {
    // Draw the live swipe vector.
    ctx.strokeStyle = "rgba(43,108,176,0.6)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startPos.x, startPos.y);
    ctx.lineTo(curPos.x, curPos.y);
    ctx.stroke();
    return;
  }

  // Gentle "swipe up" prompt.
  const a = 0.5 + 0.5 * Math.sin(time * 3);
  ctx.fillStyle = `rgba(27,36,48,${0.35 + a * 0.4})`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(H * 0.03)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText("↑ swipe up to flick", W / 2, H * 0.86);
}

function drawResult() {
  if (phase !== "result") return;
  const a = clamp(resultTimer / 0.5, 0, 1);
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = resultGood ? "#2f8f4e" : "#c0463b";
  ctx.font = `800 ${Math.round(H * 0.07)}px -apple-system, system-ui, sans-serif`;
  ctx.fillText(resultText, W / 2, H * 0.32);
  ctx.globalAlpha = 1;
}

function safeTop(): number {
  // Approximate the iOS status-bar inset for PWAs.
  const v = getComputedStyle(document.documentElement).getPropertyValue(
    "--sat",
  );
  return v ? parseFloat(v) : 0;
}

// ---- Helpers -------------------------------------------------------
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Main loop -----------------------------------------------------
let last = performance.now();
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;

  step(dt);
  if (phase === "result") {
    resultTimer -= dt;
    if (resultTimer <= 0) afterResult();
  }

  draw();
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
