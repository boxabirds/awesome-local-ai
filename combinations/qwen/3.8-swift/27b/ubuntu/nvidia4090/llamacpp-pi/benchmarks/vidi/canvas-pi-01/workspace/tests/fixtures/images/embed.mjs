// Regenerates index.ts (base64-embedded fixtures) from the PNG/JPEG files on
// disk. Run: node tests/fixtures/images/embed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const entries = [
  ['SCREENSHOT_PNG', 'screenshot.png', 'image/png', '1440x900 solid PNG screenshot (natural-size landscape case).'],
  ['PHOTO_PNG', 'photo.png', 'image/png', '400x300 solid PNG (the e2e workhorse: easy to place, drag and resize).'],
  ['WIDE_PNG', 'wide.png', 'image/png', '600x400 solid PNG (second drop target in TC-25).'],
  ['PORTRAIT_PNG', 'portrait.png', 'image/png', '200x800 portrait PNG (portrait placement case).'],
  ['ANIMATED_GIF', 'animated.gif', 'image/gif', '1x1 GIF (type coverage).'],
  ['SAMPLE_WEBP', 'sample.webp', 'image/webp', '1x1 WebP (type coverage).'],
  ['TINY_JPEG', 'tiny.jpg', 'image/jpeg', '1x1 JPEG (type coverage).'],
  ['SCRIPT_SVG', 'script.svg', 'image/svg+xml', 'SVG carrying a script tag: must be refused by content sniffing.'],
  ['RENAMED_PDF', 'renamed.pdf.png', 'application/pdf', 'A real PDF body renamed .png: content sniff must not trust the name.'],
  ['CORRUPT_PNG', 'corrupt.png', 'image/png', 'PNG header then truncated: createImageBitmap must reject it.'],
];

const out = [];
out.push('// Image fixtures (spec story 12, Fixtures).');
out.push('//');
out.push('// Bytes are embedded (base64) so every vitest pool — including the');
out.push('// Cloudflare workers pool, which has no filesystem access — can use');
out.push('// them. Regenerate the source files with generate.mjs, then embed');
out.push('// them with embed.mjs. The 10 MB / 10 MB + 1 byte bodies are');
out.push('// generated in memory by the tests (making 20 MB of binary commit');
out.push('// noise is not worth it).');
out.push('');
out.push('export interface ImageFixture {');
out.push('  name: string;');
out.push('  type: string;');
out.push('  bytes: Uint8Array;');
out.push('}');
out.push('');
out.push('function fromBase64(b64: string): Uint8Array {');
out.push('  const binary = atob(b64);');
out.push('  const bytes = new Uint8Array(binary.length);');
out.push('  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);');
out.push('  return bytes;');
out.push('}');
out.push('');
for (const [name, file, type, comment] of entries) {
  const b64 = readFileSync(join(dir, file)).toString('base64');
  out.push(`/** ${comment} */`);
  out.push(`export const ${name}: ImageFixture = { name: '${file}', type: '${type}', bytes: fromBase64(`);
  out.push(`'${b64}')`);
  out.push('};');
  out.push('');
}
out.push('/** `n` bytes prefixed with a real JPEG magic header. */');
out.push('export function jpegBytes(n: number): Uint8Array<ArrayBuffer> {');
out.push('  const bytes = new Uint8Array(n);');
out.push('  bytes[0] = 0xff;');
out.push('  bytes[1] = 0xd8;');
out.push('  bytes[2] = 0xff;');
out.push('  bytes[3] = 0xe0;');
out.push('  for (let i = 4; i < n; i++) bytes[i] = (i * 31) & 0xff;');
out.push('  return bytes;');
out.push('}');
out.push('');
out.push('/** `n` bytes with a PDF header (disguised-file fixtures). */');
out.push("export function pdfBytes(n: number): Uint8Array<ArrayBuffer> {");
out.push("  const bytes = new Uint8Array(n);");
out.push("  const header = new TextEncoder().encode('%PDF-1.4\\n' + 'x'.repeat(Math.max(0, n - 10)));");
out.push('  bytes.set(header.subarray(0, n));');
out.push('  return bytes;');
out.push('}');
writeFileSync(join(dir, 'index.ts'), out.join('\n') + '\n');
console.log('embedded', entries.length, 'fixtures');
