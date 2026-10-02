// tests/unit/validate-files.test.ts
// TC-08: validateFiles size boundary
// TC-09: validateFiles count limit and type rejection

import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(type: string, size: number, name = 'test'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES, 'at-limit.png');
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(file);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with size message', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES + 1, 'over-limit.png');
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 of 21 valid files and reports count rejection', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      makeFile('image/png', 100, `img${i}.png`)
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('accepts PNG and rejects PDF in a mixed batch with type message', () => {
    const png = makeFile('image/png', 100, 'valid.png');
    const pdf = makeFile('application/pdf', 100, 'document.pdf');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(png);
    expect(result.rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });
});
