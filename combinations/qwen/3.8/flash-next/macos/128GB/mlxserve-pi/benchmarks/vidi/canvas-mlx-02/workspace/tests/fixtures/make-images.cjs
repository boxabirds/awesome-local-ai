// Generates the real, decodable image fixtures the image tests drop and paste.
// Run: node tests/fixtures/make-images.cjs
// Real PNG/GIF bytes (not fakes) because the client decodes them with
// createImageBitmap and the e2e browser must accept them; a hand-written header
// alone will not decode.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, 'images');
fs.mkdirSync(path.join(DIR, 'count'), { recursive: true });

// --- PNG ---------------------------------------------------------------------
const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[p++] = rgb[0];
      raw[p++] = rgb[1];
      raw[p++] = rgb[2];
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- GIF ---------------------------------------------------------------------
// A 1x1 GIF87a with one colour is a fixed 35-byte file that every decoder accepts.
const GIF = Buffer.from(
  '4749463837610100010080000003030300000000000021f90401000000002c00000000010001000002024401003b',
  'hex',
);

// --- WebP --------------------------------------------------------------------
// A real RIFF/WEBP container carrying a lossy VP8 chunk. The integration tests only
// sniff, store and serve it (they never decode), so valid magic bytes and a coherent
// RIFF length are all that is required.
function webp(payload) {
  const riff = Buffer.from('RIFF', 'ascii');
  const webpTag = Buffer.from('WEBP', 'ascii');
  const chunkHeader = Buffer.concat([
    Buffer.from('VP8 ', 'ascii'),
    uint32le(payload.length),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(webpTag.length + chunkHeader.length + payload.length, 0);
  return Buffer.concat([riff, size, webpTag, chunkHeader, payload]);
}
function uint32le(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

// --- JPEG --------------------------------------------------------------------
// A minimal but real 1x1 baseline JPEG (SOI, APP0/JFIF, a single quant+frame+scan
// set, EOI) that Chromium's decoder reads.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwg' +
    'JC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAA' +
    'AAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

fs.writeFileSync(path.join(DIR, 'photo.png'), png(200, 120, [220, 60, 60]));
fs.writeFileSync(path.join(DIR, 'second.png'), png(120, 200, [60, 120, 220]));
fs.writeFileSync(path.join(DIR, 'third.png'), png(100, 100, [60, 200, 120]));
fs.writeFileSync(path.join(DIR, 'wide.png'), png(300, 100, [240, 200, 40]));
fs.writeFileSync(path.join(DIR, 'tiny.gif'), GIF);
fs.writeFileSync(path.join(DIR, 'tiny.jpg'), JPEG);
// A minimal but structurally valid lossy VP8 frame: the 10-byte VP8 bitstream header
// a decoder reads, enough for sniffing and for R2 round-trip tests.
fs.writeFileSync(path.join(DIR, 'tiny.webp'), webp(Buffer.from('3001009d012a010001000200c40000', 'hex')));
fs.writeFileSync(path.join(DIR, 'notimage.txt'), Buffer.from('just text, not an image'));
fs.writeFileSync(
  path.join(DIR, 'diagram.svg'),
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'),
);

// An 11 MB file whose header looks like a PNG: the client's size check runs before
// any decode, so it never needs to be a real image - only to exceed IMAGE_MAX_BYTES.
const big = Buffer.concat([png(1, 1, [1, 2, 3]), Buffer.alloc(11 * 1024 * 1024)]);
fs.writeFileSync(path.join(DIR, 'huge.png'), big);

// 25 tiny PNGs for the per-add count refusal.
for (let i = 0; i < 25; i++) {
  fs.writeFileSync(path.join(DIR, 'count', `img-${String(i).padStart(2, '0')}.png`), png(4, 4, [i, 10, 20]));
}

console.log('wrote image fixtures to', DIR);
