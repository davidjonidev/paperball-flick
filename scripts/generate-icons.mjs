// Generates PNG app icons (no external deps) for PWA / iOS home-screen use.
// Run with: npm run gen:icons
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// ---- Tiny PNG encoder (8-bit RGBA) --------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Drawing -------------------------------------------------------
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size * 0.5;
  const ballY = size * 0.52;
  const ballR = size * 0.27;
  const shadowY = size * 0.78;

  const top = [59, 130, 246];
  const bottom = [43, 108, 176];
  const paperLight = [255, 255, 255];
  const paperDark = [205, 210, 216];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r, g, b;
      // Background vertical gradient.
      const tg = y / size;
      [r, g, b] = mix(top, bottom, tg);

      // Soft shadow under the ball.
      const sdx = (x - cx) / (ballR * 1.15);
      const sdy = (y - shadowY) / (ballR * 0.28);
      const sd = sdx * sdx + sdy * sdy;
      if (sd < 1) {
        const k = (1 - sd) * 0.28;
        r = lerp(r, 0, k);
        g = lerp(g, 0, k);
        b = lerp(b, 0, k);
      }

      // Paper ball with radial shading + anti-aliased edge.
      const dx = x - cx;
      const dy = y - ballY;
      const dist = Math.hypot(dx, dy);
      const edge = ballR - dist;
      if (edge > -1.5) {
        const cov = Math.max(0, Math.min(1, edge + 0.5));
        // shading: lighter toward upper-left
        const shade = Math.min(
          1,
          Math.max(0, (dist + (dx + dy) * 0.35) / ballR),
        );
        const [pr, pg, pb] = mix(paperLight, paperDark, shade * 0.9);
        r = lerp(r, pr, cov);
        g = lerp(g, pg, cov);
        b = lerp(b, pb, cov);
      }

      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-512-maskable.png", 512],
  ["apple-touch-icon-180.png", 180],
]) {
  writeFileSync(join(OUT, name), render(size));
  console.log("wrote", name);
}
