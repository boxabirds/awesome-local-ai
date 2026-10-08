import { readFileSync } from 'node:fs';

/**
 * Story 12 image fixtures, for every level that needs a real file.
 *
 * The bytes are produced by `make-fixtures.mjs` in this directory and committed
 * alongside this loader, so a test never depends on a download or on the machine
 * having an image library. What the app decides about a file — its type, whether it
 * is too big — is decided from these bytes, so they are real encodings and never a
 * buffer of the right length.
 */
export type ImageFixture =
  | 'photo.png'
  | 'screenshot.png'
  | 'photo.jpg'
  | 'photo.webp'
  | 'animated.gif'
  | 'corrupt.png'
  | 'document.pdf'
  | 'fake.png'
  | 'script.svg';

/** What Chromium reports when it decodes each fixture, so a test can quote it. */
export const FIXTURE_DIMENSIONS: Record<ImageFixture, { width: number; height: number } | null> = {
  'photo.png': { width: 120, height: 90 },
  'screenshot.png': { width: 1440, height: 900 },
  'photo.jpg': { width: 4032, height: 3024 },
  'photo.webp': { width: 640, height: 480 },
  'animated.gif': { width: 4, height: 4 },
  // A truncated PNG still reports the header's dimensions but is missing pixels, and
  // neither the PDF nor the PDF-named-as-PNG has any image header to report.
  'corrupt.png': { width: 1440, height: 900 },
  'document.pdf': null,
  'fake.png': null,
  'script.svg': { width: 80, height: 80 },
};

export const FIXTURE_NAMES = Object.keys(FIXTURE_DIMENSIONS) as ImageFixture[];

/**
 * The bytes of a fixture.
 *
 * Three runtimes ask for them, and only two of them have this directory to look at:
 * Node (unit) reads them from disk, a page (component, e2e) fetches them from wherever
 * its test file is served, and the worker pool runs inside workerd, whose filesystem
 * does not contain this project — so when reading fails the bytes come from
 * `./embedded.ts`, which `make-fixtures.mjs` writes from these very files.
 * `tests/unit/fixtures.test.ts` proves the two copies are the same bytes.
 */
export async function fixtureBytes(name: ImageFixture): Promise<Uint8Array<ArrayBuffer>> {
  const url = new URL(`./${name}`, import.meta.url);
  try {
    if (url.protocol === 'file:') return new Uint8Array(readFileSync(url));
    const response = await fetch(url);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
  } catch {
    // workerd refuses the read; fall through to the embedded copy.
  }
  const { embeddedFixture } = await import('./embedded');
  const embedded = embeddedFixture(name);
  if (!embedded) throw new Error(`${name}: no bytes anywhere (run make-fixtures.mjs)`);
  // `fromBase64` in ./embedded.ts allocates fresh bytes per call, so nothing a test
  // does to the result can poison the fixture for the next one.
  return embedded;
}

/**
 * The embedded copies, for the drift test only: these must be the bytes of the file
 * of the same name, or the worker pool is testing something else than the browser
 * pools are.
 */
export async function embeddedFixtureBytes(name: ImageFixture): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const { embeddedFixture } = await import('./embedded');
  return embeddedFixture(name);
}

/** The first bytes a decoder looks at — what `sniffImageType` is handed. */
export async function fixtureHead(name: ImageFixture, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  return (await fixtureBytes(name)).subarray(0, bytes);
}

/**
 * A fixture as a `File`, optionally renamed or given a `type` the browser would
 * not have chosen itself (a PDF named `photo.png` arrives with `image/png`).
 */
export async function fixtureFile(
  name: ImageFixture,
  as?: { name?: string; type?: string },
): Promise<File> {
  return fileFrom(name, as?.name ?? name, as?.type ?? MIME[name.split('.').pop()!], await fixtureBytes(name));
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

function fileFrom(_name: string, fileName: string, type: string, bytes: Uint8Array): File {
  // `File` needs the bytes it will not mutate, so it gets a copy it can own.
  return new File([bytes.slice()], fileName, { type });
}

/**
 * Every fixture, in `FIXTURE_NAMES` order. Handy for "drop everything we know"
 * cases where the point is that only a few of them survive.
 */
export async function allFixtureFiles(): Promise<File[]> {
  const out: File[] = [];
  for (const name of FIXTURE_NAMES) out.push(await fixtureFile(name));
  return out;
}

/**
 * The base JPEG stretched to exactly `totalBytes` by inserting JPEG comment
 * segments (`FF FE`, length, payload) before the end-of-image marker.
 *
 * The result is still a decodable JPEG — a comment is a legal segment — so an
 * "exactly at the limit" case is a real file at the limit rather than a blob that
 * only has the right length.
 */
export function paddedJpeg(base: Uint8Array, totalBytes: number): Uint8Array<ArrayBuffer> {
  const marker = base.subarray(base.length - 2);
  if (marker[0] !== 0xff || marker[1] !== 0xd9) throw new Error('base JPEG has no end-of-image marker');
  const body = base.subarray(0, base.length - 2);
  const tail = 2; // the end-of-image marker goes back on
  let pad = totalBytes - body.length - tail;
  if (pad < 0) throw new Error(`${totalBytes} bytes is smaller than the base JPEG`);
  const segments: Uint8Array[] = [];
  const maxSegment = 0xff + 4; // length field covers its own two bytes
  while (pad > 0) {
    let segment = Math.min(pad, maxSegment);
    // Never leave behind a stub that is too short to be a segment at all (4 bytes:
    // marker, two length bytes, and at least nothing).
    if (pad - segment > 0 && pad - segment < 6) segment = pad - 6;
    if (segment < 4) throw new Error(`${totalBytes} cannot be reached by whole segments`);
    const payload = segment - 4;
    const head = Uint8Array.from([0xff, 0xfe, (payload + 2) >> 8, (payload + 2) & 0xff]);
    segments.push(head, new Uint8Array(payload).fill(0x20));
    pad -= segment;
  }
  const out = new Uint8Array(totalBytes);
  let at = 0;
  out.set(body, at);
  at += body.length;
  for (const segment of segments) {
    out.set(segment, at);
    at += segment.length;
  }
  out.set(marker, totalBytes - tail);
  if (at !== totalBytes - tail) throw new Error('padding arithmetic slipped');
  return out;
}
