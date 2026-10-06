/**
 * The bytes the asset tests upload.
 *
 * These are assembled in code rather than read from `tests/fixtures/images`, because an integration
 * test runs inside workerd, whose filesystem holds only the module graph - the fixture files are not
 * part of it. That costs nothing in coverage here: the asset API looks at the first
 * `IMAGE_SNIFF_BYTES` and the byte count and nothing else, so a body that begins with the real magic
 * is exactly what the server sees. The real files - a 4032x3024 photo, an animated GIF - are used
 * where a real decoder is involved, in the browser tests.
 *
 * `tests/fixtures/images` holds the same shapes as actual files, for the component and end-to-end
 * tests; `scripts/generate-image-fixtures.mjs` writes both.
 */

/** PNG: the eight-byte signature, then an IHDR chunk nobody will read. */
export function pngBytes(width = 4, height = 4, padding = 64): Uint8Array {
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
  ];
  return withPadding(header, padding);
}

/** JPEG: SOI marker and the JFIF identifier, then padding, closed by EOI. */
export function jpegBytes(padding = 64): Uint8Array {
  const header = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const body = withPadding(header, padding);
  body[body.length - 2] = 0xff;
  body[body.length - 1] = 0xd9;
  return body;
}

/** GIF: "GIF89a" plus a logical screen descriptor. */
export function gifBytes(padding = 64): Uint8Array {
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x04, 0x00, 0x04, 0x00, // 4x4 logical screen
    0x00, 0x00, 0x00,
  ];
  const body = withPadding(header, padding);
  body[body.length - 1] = 0x3b; // trailer
  return body;
}

/** WebP: "RIFF", size, "WEBP", then a VP8 chunk. */
export function webpBytes(padding = 64): Uint8Array {
  const header = [
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, // RIFF + length
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ];
  return withPadding(header, padding);
}

/** A JPEG body of exactly `bytes` bytes, closed by its EOI marker. */
export function jpegOfLength(bytes: number): Uint8Array {
  const header = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const body = new Uint8Array(Math.max(bytes, header.length));
  body.set(header.slice(0, body.length));
  if (body.length >= 2) {
    body[body.length - 2] = 0xff;
    body[body.length - 1] = 0xd9;
  }
  return body;
}

/** An SVG that starts with markup - and one carrying a script, which is the case that matters. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">' +
      '<script>alert(1)</script><rect width="4" height="4"/></svg>',
  );
}

/** A PDF: the format every "renamed it to .png" case actually is. */
export function pdfBytes(padding = 48): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n1 0 obj\n<<>>\nendobj\n${' '.repeat(padding)}%%EOF\n`);
}

/**
 * Bytes that begin with the PNG signature and stop being a PNG immediately after.
 *
 * The server accepts these, and that is deliberate: sniffing twelve bytes cannot tell a broken PNG
 * from a real one, and it is not trying to. The browser is what finds out, and a browser that cannot
 * decode an image is what the `failed` placeholder exists for.
 */
export function corruptPngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

/** Text that is not an image at all. */
export function textBytes(): Uint8Array {
  return new TextEncoder().encode('just a note about a picture, not a picture');
}

/** `bytes` long, with `header` at the front: a body of a chosen size that is still a real type. */
function withPadding(header: number[], padding: number): Uint8Array {
  const body = new Uint8Array(header.length + padding);
  body.set(header);
  return body;
}

/** A body of exactly `bytes` bytes whose first bytes are a PNG signature. */
export function pngOfLength(bytes: number): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const body = new Uint8Array(Math.max(bytes, signature.length));
  body.set(signature.slice(0, body.length));
  return body;
}
