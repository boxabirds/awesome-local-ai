import { IMAGE_MAX_BYTES } from '../../src/shared/config';

/** Magic-byte headers (only the first bytes matter to the server's sniffing). */
export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
export const GIF87 = ascii('GIF87a');
export const GIF89 = ascii('GIF89a');
export const WEBP_HEAD = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')];

export function bytesOf(head: readonly number[], total = head.length): Uint8Array {
  const out = new Uint8Array(Math.max(total, head.length));
  out.set(head);
  return out;
}

/** A JPEG-looking body of exactly `size` bytes. */
export const jpegOfSize = (size: number): Uint8Array => bytesOf(JPEG_HEAD, size);
export const jpegAtLimit = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES);
export const jpegOverLimit = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES + 1);

/** A real PNG (1x1) for tests that need a decodable file. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const tinyPng = (): Uint8Array => Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));

export const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
export const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
