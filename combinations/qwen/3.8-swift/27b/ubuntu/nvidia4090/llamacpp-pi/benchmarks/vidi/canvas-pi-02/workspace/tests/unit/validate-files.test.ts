// Story 12 (image.insert) unit tests: TC-08 (size limit boundary) and
// TC-09 (count limit + type mix) for validateFiles, plus the exact PRD
// wording of REJECTION_MESSAGES.

import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

function pngFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

describe('image.insert: validateFiles', () => {
  it('TC-08: exactly IMAGE_MAX_BYTES is accepted; one byte more is refused with "size"', () => {
    const atLimit = validateFiles([pngFile('at-limit.png', IMAGE_MAX_BYTES)]);
    expect(atLimit.accepted).toHaveLength(1);
    expect(atLimit.rejections).toEqual(new Set());

    const over = validateFiles([pngFile('over.png', IMAGE_MAX_BYTES + 1)]);
    expect(over.accepted).toHaveLength(0);
    expect(over.rejections).toEqual(new Set(['size']));
  });

  it('TC-09: 21 valid files → first IMAGE_MAX_FILES_PER_ADD accepted + "count"', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => pngFile(`${i}.png`, 10));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections).toEqual(new Set(['count']));
  });

  it('TC-09: a PDF among PNGs → the PNG is accepted + "type"', () => {
    const pdf = new File(['%PDF-1.4 fake'], 'doc.png', { type: 'application/pdf' });
    const png = pngFile('ok.png', 10);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toEqual([png]);
    expect(rejections).toEqual(new Set(['type']));
  });

  it('REJECTION_MESSAGES use the exact PRD wording', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });
});
