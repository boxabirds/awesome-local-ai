/**
 * Regenerates the image fixtures the story 12 tests use.
 *
 * ```text
 * node tests/e2e/fixtures/images/generate.mjs
 * ```
 *
 * The files are committed, so this only has to be run when a fixture needs changing. It is written
 * down rather than done by hand because the properties the tests depend on are exact - the photo has
 * to *be* 4032x3024 for a scaling test to mean anything, the GIF has to actually animate for the
 * "it still animates" test to be a test - and a file pulled off the internet has no guaranteed
 * dimensions, licence or lifetime.
 *
 * PNG is written by hand below (node's zlib does the deflating); JPEG and WebP come out of the
 * browser's own encoder, so they are real files of exactly the size asked for. The GIF is written by
 * hand too, because the only thing that makes an animated GIF is a GIF encoder and no tool here has
 * one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------------------- PNG, by hand */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An 8-bit RGB PNG: one filter byte 0 per row, pixel data deflated by node's own zlib. */
export function encodePng(width, height, colourOf) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourOf(x, y);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------- GIF, by hand, animating */

/**
 * The LZW encoding GIF wants, written the simple way: a code table that grows, a clear code when it
 * fills, and bits packed least-significant-bit first. A 32x32 two-frame GIF is a few hundred pixels,
 * and an encoder that is written down beats a table of magic bytes nobody can repair.
 */
function encodeGifLzw(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let table = new Map();
  let nextCode = endCode + 1;

  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code, size) => {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const next = indices[i];
    const key = `${prefix},${next}`;
    if (table.has(key)) {
      prefix = table.get(key);
      continue;
    }
    emit(prefix, codeSize);
    table.set(key, nextCode);
    nextCode += 1;
    if (nextCode > 1 << codeSize) {
      if (codeSize < 12) {
        codeSize += 1;
      } else {
        emit(clearCode, codeSize);
        table = new Map();
        nextCode = endCode + 1;
      }
    }
    prefix = next;
  }
  emit(prefix, codeSize);
  emit(endCode, codeSize);
  if (bitCount > 0) {
    bytes.push(bitBuffer & 0xff);
  }
  return Buffer.from(bytes);
}

/** The LZW stream cut into the sub-blocks of at most 255 bytes that a GIF is made of. */
function subBlocks(data) {
  const out = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const slice = data.subarray(offset, Math.min(offset + 255, data.length));
    out.push(Buffer.from([slice.length]), slice);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

/**
 * A GIF: the same box, in the palette's colours, one frame per entry of `frames`.
 *
 * Two frames rather than one for the animated fixture, because the thing the test asks - "does the GIF
 * still animate" - is only askable of a file with more than one frame in it. The square of the frame's
 * own colour moves between frames, so a frame difference is visible to anything that looks.
 *
 * `version` is the two digits of the six bytes every GIF starts with, and nothing else. `87` is asked for
 * separately because the sniffing test has to be able to tell the two signatures apart, and a file
 * carrying only one of them cannot show that both are recognized.
 */
function encodeGif(width, height, frames, palette, version = '89') {
  const colourBits = Math.max(2, Math.ceil(Math.log2(palette.length / 3)));
  const tableEntries = 1 << (colourBits + 1);
  const minCodeSize = colourBits + 1;

  const header = Buffer.concat([
    Buffer.from(`GIF${version}a`, 'ascii'),
    uint16(width),
    uint16(height),
    // Global colour table present, and this many bits of it.
    Buffer.from([0x80 | colourBits, 0, 0]),
  ]);

  const colourTable = Buffer.alloc(tableEntries * 3);
  for (let i = 0; i < tableEntries; i += 1) {
    const colour = Math.min(i, palette.length / 3 - 1);
    colourTable[i * 3] = palette[colour * 3];
    colourTable[i * 3 + 1] = palette[colour * 3 + 1];
    colourTable[i * 3 + 2] = palette[colour * 3 + 2];
  }

  const loop = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01]),
    uint16(0), // loop forever
    Buffer.from([0x00]),
  ]);

  const bodies = frames.map((colour, index) => {
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x > 4 + index * 6 && x < 14 + index * 6 && y > 4 && y < 14;
        indices[y * width + x] = inside ? colour : 0;
      }
    }
    return Buffer.concat([
      // A graphic control extension: 40 hundredths of a second per frame, no transparency. It is an
      // 89a thing - GIF87a has no such extension, so a file that claims to be 87a does not carry one.
      ...(version === '89' ? [Buffer.from([0x21, 0xf9, 0x04, 0x04]), uint16(40), Buffer.from([0x00, 0x00])] : []),
      Buffer.from([0x2c]),
      uint16(0),
      uint16(0),
      uint16(width),
      uint16(height),
      Buffer.from([0x00]), // no local colour table
      Buffer.from([minCodeSize]),
      subBlocks(encodeGifLzw(minCodeSize, indices)),
    ]);
  });

  // The looping extension belongs to an animation, and an animation needs more than one frame to be one.
  return Buffer.concat([
    header,
    colourTable,
    ...(frames.length > 1 && version === '89' ? [loop] : []),
    ...bodies,
    Buffer.from([0x3b]),
  ]);
}

/* ------------------------------------------------------------------------- the fixtures */

/** A picture with something in it, so it is not a flat colour and does not compress to nothing. */
function screenshotColour(x, y) {
  const band = Math.floor(y / 60) % 2 === 0;
  const dx = x - 700;
  const dy = y - 420;
  if (dx * dx + dy * dy < 180 * 180) {
    return [(x * 7) % 256, (y * 3) % 256, 200];
  }
  if (y > 820) {
    return x % 40 < 20 ? [40, 44, 52] : [238, 241, 245];
  }
  return band ? [226, 232, 240] : [203, 213, 225];
}

const PDF = Buffer.from(
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  'ascii',
);

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#f3a"/><text x="20" y="200" font-size="48">not an image</text><script>alert(1)</script></svg>\n`;

/**
 * A deterministic stand-in for "a photograph": blocks of colour, because a big file needs content.
 *
 * This function is serialized into the page by Playwright, so it may not close over anything - hence
 * `count` and `size` arriving as the third argument rather than as a closure around them.
 */
function noise(ctx, width, height, { count = 20000, size = 30, seed = 1 } = {}) {
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  ctx.fillStyle = '#7fb2e5';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = `rgb(${Math.floor(random() * 256)},${Math.floor(random() * 256)},${Math.floor(random() * 256)})`;
    ctx.fillRect(random() * width, random() * height, size, size);
  }
}

async function main() {
  mkdirSync(here, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });

  /** Paint a canvas in the browser and hand back what the browser's encoder made of it. */
  const encode = (width, height, mime, quality, options) =>
    page.evaluate(
      async ({ w, h, type, q, source, params }) => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        // The paint function is a node-side function; Playwright will not serialize a function nested
        // in an argument, so its source travels over and is rebuilt here. Nothing else about this file
        // is dynamic.
        const paint = new Function(`return ${source}`)();
        paint(canvas.getContext('2d'), w, h, params);
        return canvas.toDataURL(type, q).split(',')[1];
      },
      { w: width, h: height, type: mime, q: quality, source: noise.toString(), params: options },
    );

  const write = (name, data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
    writeFileSync(join(here, name), buffer);
    return `${name}  ${buffer.length} bytes`;
  };

  const files = [
    write('screenshot.png', encodePng(1440, 900, screenshotColour)),
    write('screenshot-2.png', encodePng(800, 600, (x, y) => [(x * 5) % 256, 90 + (y % 100), 180])),
    write('screenshot-3.png', encodePng(400, 300, (x, y) => [240, (x * 3) % 256, (y * 9) % 256])),
    write('photo.jpg', await encode(4032, 3024, 'image/jpeg', 0.92, { count: 60000, size: 30 })),
    write('picture.webp', await encode(1024, 768, 'image/webp', 0.9, { count: 6000, size: 14 })),
    write(
      'animation.gif',
      encodeGif(32, 32, [1, 2], [0xff, 0xff, 0xff, 0x22, 0x66, 0xcc, 0xdd, 0x33, 0x44, 0x22, 0x66, 0xcc]),
    ),
    // The other signature: a single frame, and a header that says 87a, which is a real thing GIFs from
    // before 1990 do.
    write(
      'static.gif',
      encodeGif(32, 32, [1], [0xff, 0xff, 0xff, 0x22, 0x66, 0xcc, 0xdd, 0x33, 0x44, 0x22, 0x66, 0xcc], '87'),
    ),
    write('script.svg', Buffer.from(SVG, 'utf8')),
    write('document.pdf', PDF),
    // The same PDF with a .png name: the case where the extension is a lie, and only the file's own
    // bytes can catch it.
    write('renamed-pdf.png', PDF),
    // A PNG that stops in the middle of its pixel data: the signature is right, the picture is not there.
    write('broken.png', encodePng(1440, 900, screenshotColour).subarray(0, 400)),
  ];

  // Two more, of a different kind: a JPEG and a WebP so small that their bytes can be written into a
  // module. The integration tests run inside workerd, which has no way to read a file from this
  // directory, so the fixtures those tests need have to travel as text. Both are ordinary files, and
  // both are used as they are - the JPEG is padded with comment segments where a size is needed, which
  // is what a JPEG encoder does with anything it is not showing you.
  const tinyJpeg = Buffer.from(await encode(16, 12, 'image/jpeg', 0.7, { count: 6, size: 4 }), 'base64');
  const tinyWebp = Buffer.from(await encode(16, 12, 'image/webp', 0.8, { count: 6, size: 4 }), 'base64');
  writeFileSync(join(here, 'tiny.jpg'), tinyJpeg);
  writeFileSync(join(here, 'tiny.webp'), tinyWebp);
  const embedded = join(here, '../embeddedImages.ts');
  writeFileSync(
    embedded,
    `/**
 * Two image fixtures as text, generated by \`images/generate.mjs\`. Do not edit by hand.
 *
 * The integration tests run inside the Workers runtime, where there is no file system to read a fixture
 * from, so these two travel as base64 instead: a 16x12 JPEG and a 16x12 WebP, both real files, both
 * decodeable by a real decoder. A test that needs a JPEG of an exact size pads this one with JPEG
 * comment segments (see \`jpegBytesOfLength\`), which is legal in the format rather than a trick - a
 * decoder skips what it does not show you.
 */
export const TINY_JPEG_BASE64 = '${tinyJpeg.toString('base64')}';

export const TINY_WEBP_BASE64 = '${tinyWebp.toString('base64')}';
`,
  );
  files.push('static.gif', 'tiny.jpg', 'tiny.webp', '../embeddedImages.ts');

  await browser.close();
  console.log(files.join('\n'));
  console.log('fixtures written to', here);
}

await main();
