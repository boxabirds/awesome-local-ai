/**
 * Image bytes for story 12 unit and integration tests, embedded so they also load inside
 * workerd (no file system there). They are the files in tests/fixtures/images/:
 * small-400x300.png, tiny-64x48.jpg, sketch-640x480.webp, script.svg and
 * document-renamed.png, plus an 8 × 8 GIF. `jpegOfSize` and `bytesOfSize` generate the size-limit files.
 */

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 400 × 300 PNG. */
export const PNG_400x300 = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAZAAAAEsAQMAAADXeXeBAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURY4kqv///5f0mtAAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkZCiwce61aFwAAACZJREFUaN7twTEBAAAAwqD1T20JT6AAAAAAAAAAAAAAAAAAAICnATvEAAEnf54JAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA5LTI1VDEwOjQ0OjI4KzAwOjAwW7yX6gAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOS0yNVQxMDo0NDoyOCswMDowMCrhL1YAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDktMjVUMTA6NDQ6MjgrMDA6MDB99A6JAAAAAElFTkSuQmCC');
/** 64 × 48 JPEG. */
export const JPEG_64x48 = fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwAEADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCcApKcgAAAAAAAAAAAAAAAAAAAAAP/2Q==');
/** 8 × 8 GIF89a. */
export const GIF_8x8 = fromBase64('R0lGODlhCAAIAPAAAPuMAAAAACH5BAAAAAAALAAAAAAIAAgAAAIHhI+py+1dAAA7');
/** 640 × 480 WebP. */
export const WEBP_640x480 = fromBase64('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');
/** An SVG carrying a script (must never be accepted). */
export const SVG_WITH_SCRIPT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script><rect width="100" height="100" fill="red"/></svg>\n',
);
/** A PDF saved with a .png name (must never be accepted). */
export const PDF_RENAMED = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
/** The first bytes of a GIF87a file. */
export const GIF87_HEAD = new TextEncoder().encode('GIF87a\x01\x00\x01\x00');

/** A valid JPEG padded after its end marker to exactly `size` bytes (decoders ignore the tail). */
export function jpegOfSize(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  out.set(JPEG_64x48.subarray(0, Math.min(size, JPEG_64x48.length)));
  return out;
}

/** `size` bytes starting like a PNG (the size check comes before any decoding). */
export function bytesOfSize(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  out.set(PNG_400x300.subarray(0, Math.min(size, PNG_400x300.length)));
  return out;
}
