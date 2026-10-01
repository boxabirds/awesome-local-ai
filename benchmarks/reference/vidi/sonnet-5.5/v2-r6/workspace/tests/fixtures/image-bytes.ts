import { IMAGE_MAX_BYTES } from '../../src/shared/config';

/** A real 1x1 PNG, small enough to embed (integration tests run in workerd, with no file system). */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const pngBytes = (): Uint8Array => Uint8Array.from(atob(PNG_1X1_BASE64), (c) => c.charCodeAt(0));

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A JPEG-signed blob of exactly `size` bytes (the signature is all the server looks at). */
export function jpegOfSize(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set([0xff, 0xd8, 0xff, 0xe0].slice(0, Math.min(4, size)));
  return out;
}

export const maxSizeJpeg = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES);
export const oversizeJpeg = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES + 1);

export const pdfBytes = (): Uint8Array => Uint8Array.from(ascii('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n'));
export const svgBytes = (): Uint8Array =>
  Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
export const gif89 = (): Uint8Array => Uint8Array.from([...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0]);
export const gif87 = (): Uint8Array => Uint8Array.from([...ascii('GIF87a'), 1, 0, 1, 0, 0, 0, 0]);
export const webpBytes = (): Uint8Array =>
  Uint8Array.from([...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')]);
