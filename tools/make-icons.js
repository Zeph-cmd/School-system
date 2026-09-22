// Generates the PWA home-screen icons (blue gradient + white open book).
// Uses only Node built-ins (zlib, fs) — run: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;

// --- canvas: RGBA buffer, transparent by default ---
const px = new Uint8Array(S * S * 4);

function setPx(x, y, r, g, b, a) {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

const inRect = (x, y, x1, y1, x2, y2, r) => {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false;
  const cx = Math.min(Math.max(x, x1 + r), x2 - r);
  const cy = Math.min(Math.max(y, y1 + r), y2 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
};

// --- draw ---
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const nx = x / S, ny = y / S;

    // full-bleed gradient background: blue (top) -> deep navy (bottom)
    let r = Math.round(37 + (23 - 37) * ny);   // 37 -> 23
    let g = Math.round(99 + (43 - 99) * ny);   // 99 -> 43
    let b = Math.round(235 + (59 - 235) * ny); // 235 -> 59
    setPx(x, y, r, g, b, 255);

    // white open book: two mirrored slanted pages meeting at a center spine
    const pageHalf = 0.30;            // half width of one page
    const spineX = 0.5;
    const tilt = (0.5 - Math.abs(nx - spineX)) * 0.0; // reserved
    const pageTop = 0.30 - Math.abs(nx - spineX) * 0.10; // pages dip toward spine
    const pageBottom = 0.66 + Math.abs(nx - spineX) * 0.06;
    const onLeft = nx < spineX;
    const pInner = onLeft ? spineX - 0.02 : spineX + 0.02;
    const pOuter = onLeft ? spineX - pageHalf : spineX + pageHalf;
    const pLeft = Math.min(pInner, pOuter);
    const pRight = Math.max(pInner, pOuter);
    if (inRect(x, y, pLeft * S, pageTop * S, pRight * S, pageBottom * S, 0.03 * S)) {
      setPx(x, y, 255, 255, 255, 255);
      // thin text lines on each page
      const lny = (ny - pageTop) / (pageBottom - pageTop);
      if ((Math.abs(lny - 0.3) < 0.04 || Math.abs(lny - 0.55) < 0.04) &&
          Math.abs(nx - spineX) > 0.07 && Math.abs(nx - spineX) < 0.24) {
        setPx(x, y, 37, 99, 235, 255);
      }
    }
  }
}

// --- PNG encoder ---
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, getRGBA) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getRGBA(x, y);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// scale S x S down to size x size with box averaging
function sampleRGBA(x, y, size) {
  const scale = S / size;
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  const x0 = Math.floor(x * scale), x1 = Math.min(Math.floor((x + 1) * scale), S);
  const y0 = Math.floor(y * scale), y1 = Math.min(Math.floor((y + 1) * scale), S);
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const i = (sy * S + sx) * 4;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

const outDir = path.join(__dirname, '..', 'frontend', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [512, 192, 180]) {
  const png = encodePNG(size, size, (x, y) => sampleRGBA(x, y, size));
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
