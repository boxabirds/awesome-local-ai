import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

/**
 * Real oversized JPEGs, built at test time instead of committed (`assets.api`,
 * TC-08/TC-12): the 10 MB boundary is only trustworthy if the file *is* that
 * many bytes.
 *
 * The padding is a run of JPEG **comment segments** (`FF FE <length> …`) spliced
 * in right after the start-of-image marker, so the result is still a JPEG a real
 * decoder opens - it is just a heavy one.
 */

const FIXTURES = fileURLToPath(new URL('./images/', import.meta.url));

/** The committed photo-sized JPEG every oversized fixture is built from. */
export function baseJpeg(): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES}photo-large.jpg`));
}

const MAX_SEGMENT = 65_533;

/** `base` padded with JPEG comment segments to exactly `length` bytes. */
export function jpegOfByteLength(length: number, base = baseJpeg()): Uint8Array {
  if (!Number.isFinite(length) || length < base.length) {
    throw new Error(`cannot build a JPEG of ${length} bytes from ${base.length} bytes`);
  }
  const out: number[] = [base[0]!, base[1]!]; // FF D8
  let padding = length - base.length - 2;
  while (padding >= 4) {
    const payload = Math.min(MAX_SEGMENT, padding - 4);
    if (payload <= 0) {
      break;
    }
    out.push(0xff, 0xfe, (payload >> 8) & 0xff, payload & 0xff);
    for (let i = 0; i < payload; i += 1) {
      out.push(0x20);
    }
    padding -= 4 + payload;
  }
  for (let i = 2; i < base.length; i += 1) {
    out.push(base[i]!);
  }
  while (out.length < length) {
    out.push(0x00);
  }
  return Uint8Array.from(out);
}

/** Exactly `IMAGE_MAX_BYTES` - the accepted side of the boundary. */
export const jpegAtLimit = (): Uint8Array => jpegOfByteLength(IMAGE_MAX_BYTES);

/** `IMAGE_MAX_BYTES` + 1 - the rejected side of the boundary. */
export const jpegOverLimit = (): Uint8Array => jpegOfByteLength(IMAGE_MAX_BYTES + 1);

/** A file of `bytes` named `name`, as a browser would hand it over. */
export function fileOf(name: string, bytes: Uint8Array, type = ''): File {
  // A fresh buffer-backed copy: `File` wants bytes it can own.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type });
}
