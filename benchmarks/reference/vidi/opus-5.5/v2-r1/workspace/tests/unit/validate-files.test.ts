// image.insert client validation (TC-08, TC-09): type, size and count rules and their messages.
import { describe, expect, it } from 'vitest';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/** A file of `size` bytes (sparse: only the declared size matters to validation). */
function fileOf(name: string, type: string, size = 1000): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('image.insert validateFiles', () => {
  it('TC-08 exactly IMAGE_MAX_BYTES is accepted; one byte more is refused with size', () => {
    const atLimit = fileOf('big.jpg', 'image/jpeg', IMAGE_MAX_BYTES);
    const over = fileOf('huge.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1);
    expect(validateFiles([atLimit])).toEqual({ accepted: [atLimit], rejections: new Set() });
    const r = validateFiles([over]);
    expect(r.accepted).toEqual([]);
    expect([...r.rejections]).toEqual(['size']);
  });

  it('TC-09 21 files: the first 20 accepted plus count; PDF + PNG: PNG accepted plus type', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => fileOf(`s${i}.png`, 'image/png'));
    const r = validateFiles(files);
    expect(r.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect([...r.rejections]).toEqual(['count']);

    const pdf = fileOf('doc.pdf', 'application/pdf');
    const png = fileOf('shot.png', 'image/png');
    const svg = fileOf('logo.svg', 'image/svg+xml');
    const mixed = validateFiles([pdf, png, svg]);
    expect(mixed.accepted).toEqual([png]);
    expect([...mixed.rejections]).toEqual(['type']);
  });

  it('unsupported files do not count towards the limit; several reasons are all reported', () => {
    const pngs = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => fileOf(`s${i}.png`, 'image/png'));
    const r = validateFiles([fileOf('a.pdf', 'application/pdf'), ...pngs, fileOf('b.gif', 'image/gif', IMAGE_MAX_BYTES + 1)]);
    expect(r.accepted).toEqual(pngs);
    expect(r.rejections).toEqual(new Set(['type', 'size']));
  });

  it('messages match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES).toEqual({
      type: 'Only PNG, JPEG, GIF and WebP images can be added.',
      size: 'Images must be 10 MB or smaller.',
      count: 'Only 20 images can be added at once.',
      offline: "You're offline — images can be added when you reconnect.",
    });
  });
});
