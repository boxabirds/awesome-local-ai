/**
 * Image fixtures that are *bytes*, not files (story 12).
 *
 * Asset sniffing has to be tested where there is no filesystem — inside workerd
 * (the integration suite) and inside jsdom (the component suite) — so the image
 * material these suites need is generated here instead of read from
 * `tests/fixtures/images/`. Everything is real encoder output (Chromium's
 * `canvas.toDataURL` for the PNG/JPEG/WebP bodies, a hand-checked GIF89a
 * stream), so a fixture that sniffs also decodes.
 *
 * The binary files under `tests/fixtures/images/` stay for the browser suite,
 * which hands them to the file input and to a `DataTransfer`.
 */

/** Decode a base64 string into bytes (available in Node, workerd and jsdom). */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** A real 1x1 PNG (Chromium encoder output). */
const PNG_1X1 = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWKybvr2HwAAAP//ChwmZwAAAAZJREFUAwAFbAK1SUyMmQAAAABJRU5ErkJggg==',
);

/** A real 8x8 baseline JPEG (Chromium encoder output). */
const JPEG_8X8 = fromBase64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJANjn//2Q==',
);

/** A real 8x8 WebP (Chromium encoder output). */
const WEBP_8X8 = fromBase64(
  'UklGRhYCAABXRUJQVlA4WAoAAAAgAAAABwAABwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggKAAAAJABAJ0BKggACAADgFoloAJ0ugADmAD+lxf/EOdu/gVsU/jebzWrEAA=',
);

/**
 * A complete 4x4 two-frame animated GIF89a: header, two-colour global palette,
 * the NETSCAPE2.0 loop extension, and one image per frame. Each frame's LZW
 * stream repeats a Clear code before every literal, which holds the code width
 * at its minimum and keeps the stream unambiguous.
 */
function gif89a(magic: string, frameCount: number): Uint8Array {
  const bytes: number[] = [];
  const push = (...values: number[]): void => {
    bytes.push(...values);
  };
  const le16 = (value: number): void => {
    push(value & 0xff, (value >> 8) & 0xff);
  };
  const size = 4;
  push(...Array.from(magic).map((char) => char.charCodeAt(0)));
  le16(size);
  le16(size);
  push(0x80, 0x00, 0x00); // global colour table present, two entries
  push(0x15, 0x60, 0x8c, 0xf4, 0x7d, 0x3a); // deep blue, orange

  if (magic === 'GIF89a') {
    push(0x21, 0xff, 0x0b); // application extension, 11 bytes of id
    push(...Array.from('NETSCAPE2.0').map((char) => char.charCodeAt(0)));
    push(0x03, 0x01, 0x00, 0x00, 0x00); // loop forever
  }

  const pixels = size * size;
  const literalCodes: number[] = [];
  {
    const clear = 1 << 2;
    const endOfInformation = clear + 1;
    const codeWidth = 3;
    let accumulator = 0;
    let heldBits = 0;
    const emit = (code: number): void => {
      accumulator |= code << heldBits;
      heldBits += codeWidth;
      while (heldBits >= 8) {
        literalCodes.push(accumulator & 0xff);
        accumulator >>= 8;
        heldBits -= 8;
      }
    };
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        emit(clear);
        emit(frame % 2);
      }
    }
    emit(endOfInformation);
    if (heldBits > 0) literalCodes.push(accumulator & 0xff);
  }

  // The same stream repeated per frame; each frame decodes independently.
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (magic === 'GIF89a') {
      push(0x21, 0xf9, 0x04, 0x08, 10, 0x00, frame % 2, 0x00); // 100ms delay
    }
    push(0x2c);
    le16(0);
    le16(0);
    le16(size);
    le16(size);
    push(0x00);
    push(0x02); // LZW minimum code size
    const stream = literalCodes.slice(
      (frame * literalCodes.length) / frameCount,
      ((frame + 1) * literalCodes.length) / frameCount,
    );
    for (let offset = 0; offset < stream.length; offset += 255) {
      const chunk = stream.slice(offset, offset + 255);
      push(chunk.length, ...chunk);
    }
    push(0x00);
  }
  push(0x3b); // trailer
  return Uint8Array.from(bytes);
}

const SVG_WITH_SCRIPT = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <script>alert('svg script payload')</script>
  <rect width="16" height="16" fill="#e11d48"/>
</svg>
`;

const PDF_BODY = '%PDF-1.7\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 R >>\n%%EOF\n';

/** A real 1x1 PNG. */
export function pngBytes(): Uint8Array {
  return Uint8Array.from(PNG_1X1);
}

/** A real 8x8 JPEG, optionally padded to exactly `size` bytes. */
export function jpegBytes(size?: number): Uint8Array {
  if (size === undefined) return Uint8Array.from(JPEG_8X8);
  if (size < JPEG_8X8.length) {
    throw new Error(`jpegBytes: cannot pad to ${size}; the fixture is ${JPEG_8X8.length} bytes`);
  }
  // Padding goes after the EOI marker, where a decoder stops reading, so the
  // result is a valid JPEG that simply carries trailing bytes.
  const out = new Uint8Array(size);
  out.set(JPEG_8X8, 0);
  out.fill(0x20, JPEG_8X8.length);
  return out;
}

/** A real 8x8 WebP. */
export function webpBytes(): Uint8Array {
  return Uint8Array.from(WEBP_8X8);
}

/** A valid animated GIF89a. */
export function gif89aBytes(): Uint8Array {
  return gif89a('GIF89a', 2);
}

/** A GIF87a header with the same image data (87a predates animation). */
export function gif87aBytes(): Uint8Array {
  return gif89a('GIF87a', 1);
}

/** An SVG carrying a script tag — never an acceptable upload. */
export function svgScriptBytes(): Uint8Array {
  return new TextEncoder().encode(SVG_WITH_SCRIPT);
}

/** A real PDF, which the tests hand over under a `.png` name. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode(PDF_BODY);
}

/** A PNG whose body stops mid-file: right signature, undecodable. */
export function truncatedPngBytes(): Uint8Array {
  return Uint8Array.from(PNG_1X1).subarray(0, 30);
}

/** Deterministic non-image bytes (seeded), so "random junk" is reproducible. */
export function junkBytes(length = 64, seed = 7): Uint8Array {
  let state = seed >>> 0;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x29a9db1f) >>> 0;
    bytes[index] = (state ^ (state >>> 13)) & 0xff;
  }
  // Keep the first byte clear of every accepted signature.
  if (bytes[0] === 0x89 || bytes[0] === 0xff || bytes[0] === 0x47 || bytes[0] === 0x52) {
    bytes[0] = 0x00;
  }
  return bytes;
}
