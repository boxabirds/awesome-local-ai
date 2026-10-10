/**
 * Image bytes built in code, for the tests that run where the file system does not exist
 * (the integration tests run in workerd, which has no readable disk).
 *
 * These are *signature*-level fixtures: enough of each format that a format sniffer has to
 * be fooled rather than merely handed a name, and nothing more. A test that needs an image a
 * browser will actually decode reads one of the real files in `tests/fixtures/images/`
 * through `./image-files.js` instead.
 */

/** The smallest thing that reports itself as a PNG: the signature and a short IHDR chunk. */
export function pngBytes(): Uint8Array {
  // 8-byte signature, then a real IHDR chunk (length, type, 13 bytes of a 1x1 truecolour
  // image, CRC) so the file looks like a PNG all the way to the end of its first chunk.
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
    0x77, 0x53, 0xde,
  ]);
}

/** A JPEG that starts the way JPEGs do (SOI, then an APP0 marker). */
export function jpegHeader(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

/**
 * A JPEG of exactly `bytes` long: the header, filler, and the end-of-image marker at the
 * very end, which is what a file that grew to exactly the limit looks like to a sniffer.
 */
export function jpegSized(bytes: number): Uint8Array {
  const header = jpegHeader();
  const tail = new Uint8Array([0xff, 0xd9]);
  if (bytes < header.length + tail.length) throw new Error(`${bytes} is too small for a JPEG`);
  const out = new Uint8Array(bytes);
  out.set(header, 0);
  out.fill(0x37, header.length, bytes - tail.length); // arbitrary entropy, to a sniffer
  out.set(tail, bytes - tail.length);
  return out;
}

/** A GIF89a header, and nothing after it. */
export function gifHeader(): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
}

/**
 * A WebP: `RIFF`, the container size, `WEBP`, then a `VP8L` chunk header. The payload is not
 * decodable — no test asks it to be, since these bytes only travel through the server — but
 * the container says WebP and only a sniffer that looked further than the container would
 * think otherwise.
 */
export function webpBytes(): Uint8Array {
  const out = new Uint8Array(20);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  out[4] = 16; // container size, little-endian, of everything after this field
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  return out;
}

/** A PDF, which is the file that gets a `.png` name in these tests. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    ['%PDF-1.4', '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj', 'trailer << /Size 2 /Root 1 0 R >>', '%%EOF'].join(
      '\n',
    ),
  );
}

/** The document type an upload would have to claim to be a GIF87a, for the sniffing table. */
export function gif87aHeader(): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
}

/** A file that starts like a PNG and stops being one immediately. */
export function truncatedPngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}
