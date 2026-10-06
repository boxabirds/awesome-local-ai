/**
 * Generates the binary image fixtures the story 12 suites read from `tests/fixtures/images`.
 *
 * Run with `node scripts/generate-image-fixtures.mjs` when a fixture changes (the output is
 * committed). `sharp` is already a dependency of the toolchain, and its libvips carries PNG,
 * mozjpeg and WebP writers, so every fixture here is a real file that a sniffer and a browser
 * decoder agree about - which is the point: a hand-written header would test the sniffer and then
 * fail `createImageBitmap`. The animated GIF is encoded with ffmpeg (the same build Playwright
 * ships its browsers with), because sharp writes a GIF only when its input is animated.
 *
 * Files over the 10 MB limit are deliberately *not* committed: a test that needs one builds a
 * padded buffer in memory (see `oversizedBytes()` in the integration suite and Playwright's
 * `setInputFiles({ buffer })`), which keeps the repository small without weakening a boundary.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

const OUT = fileURLToPath(new URL('../tests/fixtures/images/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/** A deterministic "photo" pattern: colour bands plus a diagonal, so it is not one flat colour. */
function patternImage(width, height) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      data[i] = (x * 7 + y * 3) & 0xff;
      data[i + 1] = (x * 3 + y * 11) & 0xff;
      data[i + 2] = x > y ? 200 : 40;
    }
  }
  return sharp(data, { raw: { width, height, channels } });
}

/**
 * A smooth gradient of the same size, which mozjpeg packs far tighter than the noisy pattern: the
 * point of the fixture is its *dimensions* (4032x3024 is well past the placement limit), and a
 * committed file should not cost more than it has to.
 */
function gradientImage(width, height) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      data[i] = Math.round((x / (width - 1)) * 255);
      data[i + 1] = Math.round((y / (height - 1)) * 255);
      data[i + 2] = Math.round(((x + y) / (width + height - 2)) * 255);
    }
  }
  return sharp(data, { raw: { width, height, channels } });
}

/** Where ffmpeg lives: the system one, or the build Playwright installed. */
function findFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('ffmpeg-')) continue;
      for (const binary of ['ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg']) {
        const full = join(cache, entry, binary);
        if (existsSync(full)) return full;
      }
    }
  }
  return null;
}

/** Encodes PNG frames into one looping GIF (each frame 0.2 s). */
async function encodeGif(framePaths, outPath) {
  const ffmpeg = findFfmpeg();
  if (ffmpeg === null) throw new Error('no ffmpeg found: set FFMPEG_PATH to encode the animated GIF');
  const listPath = join(OUT, '.gif-concat.txt');
  const list =
    framePaths.map((path) => `file '${path}'\nduration 0.2`).join('\n') +
    `\nfile '${framePaths.at(-1)}'\n`;
  writeFileSync(listPath, list);
  try {
    await run(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, outPath]);
  } finally {
    rmSync(listPath, { force: true });
  }
}

async function flatPng(name, width, height, rgb) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: rgb } })
    .png()
    .toBuffer();
  writeFileSync(join(OUT, name), bytes);
  return bytes.length;
}

async function main() {
  const written = {};

  // A screenshot at its real desktop size: wider than IMAGE_MAX_PLACE_SIZE_WORLD, so placement has
  // to scale it down and keep its proportions.
  const screenshot = await patternImage(1440, 900).png().toBuffer();
  writeFileSync(join(OUT, 'screenshot-1440x900.png'), screenshot);
  written['screenshot-1440x900.png'] = screenshot.length;

  // A photo whose natural size is far past the placement limit in both directions.
  const photo = await gradientImage(4032, 3024).jpeg({ quality: 82 }).toBuffer();
  writeFileSync(join(OUT, 'photo-4032x3024.jpg'), photo);
  written['photo-4032x3024.jpg'] = photo.length;

  // An animated GIF (GIF89a, three frames): `image/gif` is accepted and the PRD wants animation to
  // play, so it has to be a real multi-frame file.
  const gifPath = join(OUT, 'animation.gif');
  const framePaths = await Promise.all(
    [[220, 40, 40], [40, 200, 90], [50, 90, 230]].map(async (rgb, index) => {
      const path = join(OUT, `.frame-${index}.png`);
      writeFileSync(
        path,
        await sharp({ create: { width: 120, height: 90, channels: 3, background: rgb } })
          .png()
          .toBuffer(),
      );
      return path;
    }),
  );
  try {
    await encodeGif(framePaths, gifPath);
  } finally {
    for (const path of framePaths) rmSync(path, { force: true });
  }
  written['animation.gif'] = statSync(gifPath).size;

  // A WebP still.
  const webp = await sharp({ create: { width: 320, height: 240, channels: 3, background: [12, 200, 220] } })
    .webp({ quality: 80 })
    .toBuffer();
  writeFileSync(join(OUT, 'picture.webp'), webp);
  written['picture.webp'] = webp.length;

  // An SVG that carries a script: refused by the sniffer whatever the browser calls its type, and
  // it must never be stored or served in a way the browser could execute.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <script>alert('owned')</script>
  <rect width="64" height="64" fill="#e91e63" />
</svg>
`;
  writeFileSync(join(OUT, 'script.svg'), svg);
  written['script.svg'] = svg.length;

  // A real PDF header, offered under both its honest and its disguised name.
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
      'trailer << /Root 1 0 R /Size 2 >>\n%%EOF\n',
    'latin1',
  );
  writeFileSync(join(OUT, 'report.pdf'), pdf);
  writeFileSync(join(OUT, 'disguised-pdf.png'), pdf);
  written['report.pdf'] = pdf.length;
  written['disguised-pdf.png'] = pdf.length;

  // A PNG whose bytes stop inside the first chunk: the magic still says PNG - so the server accepts
  // it - and it is the *client's* decode step that refuses it (the corrupt-file error path).
  const realPng = await sharp({ create: { width: 64, height: 64, channels: 3, background: [10, 10, 10] } })
    .png()
    .toBuffer();
  writeFileSync(join(OUT, 'corrupt.png'), realPng.subarray(0, 24));
  written['corrupt.png'] = 24;

  // Three screenshots of three different sizes, for "drop three files in a row".
  written['drop-red-300x200.png'] = await flatPng('drop-red-300x200.png', 300, 200, [220, 60, 60]);
  written['drop-green-400x300.png'] = await flatPng('drop-green-400x300.png', 400, 300, [60, 190, 90]);
  written['drop-blue-250x250.png'] = await flatPng('drop-blue-250x250.png', 250, 250, [70, 110, 230]);
  // One small image, for the flows that add exactly one.
  written['small-120x80.png'] = await flatPng('small-120x80.png', 120, 80, [240, 200, 40]);
  // A tall portrait image, for the aspect-ratio resize test.
  written['tall-200x400.png'] = await flatPng('tall-200x400.png', 200, 400, [170, 90, 220]);

  for (const [name, size] of Object.entries(written)) {
    console.log(`${String(size).padStart(9)} bytes  ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
