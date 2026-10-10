// TC-08, TC-09: client-side file validation (type by browser MIME type,
// size at IMAGE_MAX_BYTES ± 1, count at IMAGE_MAX_FILES_PER_ADD + 1) with
// the exact PRD rejection messages.

import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(Math.min(size, 1024))], name, {
    type,
    // size must be exact for boundary checks
  });
}

function sizedFile(name: string, type: string, size: number): File {
  const tiny = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(tiny, 'size', { value: size });
  return tiny;
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts exactly IMAGE_MAX_BYTES and rejects one byte more with the PRD message', () => {
    const ok = sizedFile('at-limit.png', 'image/png', IMAGE_MAX_BYTES);
    const tooBig = sizedFile('over.png', 'image/png', IMAGE_MAX_BYTES + 1);

    const acceptedResult = validateFiles([ok]);
    expect(acceptedResult.accepted).toEqual([ok]);
    expect(acceptedResult.rejections.size).toBe(0);

    const rejected = validateFiles([tooBig]);
    expect(rejected.accepted).toEqual([]);
    expect(rejected.rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('validateFiles count limit and types (TC-09)', () => {
  it('keeps the first IMAGE_MAX_FILES_PER_ADD valid files and reports the count message', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, i) =>
      file(`img-${i}.png`, 'image/png', 100),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('keeps supported files and reports the type message for unsupported ones', () => {
    const png = file('photo.png', 'image/png', 100);
    const jpeg = file('photo.jpg', 'image/jpeg', 100);
    const gif = file('anim.gif', 'image/gif', 100);
    const webp = file('pic.webp', 'image/webp', 100);
    const pdf = file('report.png', 'application/pdf', 100);
    const svg = file('icon.svg', 'image/svg+xml', 100);

    const { accepted, rejections } = validateFiles([pdf, png, jpeg, svg, gif, webp]);
    expect(accepted).toEqual([png, jpeg, gif, webp]);
    expect(rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });
});
