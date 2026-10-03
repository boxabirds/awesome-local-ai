/**
 * Image byte fixtures for the asset API tests (story 12).
 *
 * Generates real (decodable) PNG bytes and the magic-byte prefixes for the
 * other accepted/rejected types. Used by the integration tests (server
 * sniffing) and the e2e tests (real files the browser can decode).
 */
import { deflateSync } from 'node:zlib';

let crcTable: Int32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(new Uint8Array(Buffer.concat([typeBuf, data]))));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** A real, decodable RGB PNG of the given size (defaults to 4x4). */
export function pngBytes(width = 4, height = 4): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[y * stride + 1 + x * 3] = 210; // R
      raw[y * stride + 2 + x * 3] = 140; // G
      raw[y * stride + 3 + x * 3] = 90; // B
    }
  }
  const idat = Buffer.from(deflateSync(raw));
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** JPEG magic bytes + padding to the given size. */
export function jpegBytes(size: number): Buffer {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  return buf;
}

/** A valid GIF89a. */
export function gifBytes(): Buffer {
  return Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
}

/** WebP magic bytes (RIFF....WEBP). */
export function webpBytes(): Buffer {
  const buf = Buffer.alloc(20);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

/** An SVG (with a script) — must be rejected. */
export function svgBytes(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
}

/** A PDF — must be rejected even when renamed .png. */
export function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF');
}

/** A truncated PNG (signature + partial IHDR, no IDAT/IEND). */
export function corruptPngBytes(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, Buffer.alloc(13)]);
}

/** Deterministic non-image bytes. */
export function randomBytes(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + 3) & 0xff;
  return buf;
}
