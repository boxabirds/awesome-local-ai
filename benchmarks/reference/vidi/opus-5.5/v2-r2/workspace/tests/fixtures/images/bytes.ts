// In-memory image fixtures (story 12) usable everywhere, including the Workers
// test pool (no file system). The files next to this module are the real
// fixtures used by e2e tests (screenshot 1440x900, photo 4032x3024, animated
// GIF, WebP, SVG with a script, PDF renamed .png, truncated PNG).
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** small.png (next to this module): a real 300x200 PNG. */
export const PNG_300x200 = fromBase64('iVBORw0KGgoAAAANSUhEUgAAASwAAADIAQMAAABoEU4WAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURYvDSv///4uyUZQAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkeBA4X3ITQDAAAAB5JREFUWMPtwTEBAAAAwqD1T20Hb6AAAAAAAAAA4DceeAABFyjdmQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0zMFQwNDoxNDoyMyswMDowMIil8ucAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMzBUMDQ6MTQ6MjMrMDA6MDD5+EpbAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTMwVDA0OjE0OjIzKzAwOjAwru1rhAAAAABJRU5ErkJggg==');
/** A real 8x6 JPEG. */
export const JPEG_8x6 = fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAGAAgDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AIsBPf//Z');
/** Headers of the other accepted types (content decides the type). */
export const GIF87A_HEAD = ascii('GIF87a\x01\x00\x01\x00\x80\x00');
export const GIF89A_HEAD = ascii('GIF89a\x01\x00\x01\x00\x80\x00');
export const WEBP_HEAD = ascii('RIFF\x24\x00\x00\x00WEBPVP8 ');
/** A PDF (as when renamed to .png). */
export const PDF_BYTES = ascii('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
/** An SVG carrying a script. */
export const SVG_WITH_SCRIPT = ascii(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
);

/** A valid JPEG of exactly `bytes` bytes (a real JPEG padded after its end marker, which decoders ignore). */
export function jpegOfSize(bytes = IMAGE_MAX_BYTES): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set(JPEG_8x6.subarray(0, Math.min(JPEG_8x6.length, bytes)));
  return out;
}

/** IMAGE_MAX_BYTES + 1 bytes starting with a PNG signature. */
export function overLimitBytes(): Uint8Array {
  const out = new Uint8Array(IMAGE_MAX_BYTES + 1);
  out.set(PNG_300x200.subarray(0, 8));
  return out;
}
