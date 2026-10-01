/**
 * Unit tests for validateFiles (TC-08, TC-09).
 */

import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(name: string, type: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('test.png', 'image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a file at IMAGE_MAX_BYTES + 1 with size rejection', () => {
    const file = makeFile('test.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 files and adds count rejection when 21 valid', () => {
    const files = Array.from({ length: 21 }, (_, i) => makeFile(`img${i}.png`, 'image/png', 1024));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts PNG and adds type rejection when mixed with PDF', () => {
    const pdf = makeFile('doc.pdf', 'application/pdf', 1024);
    const png = makeFile('pic.png', 'image/png', 1024);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.name).toBe('pic.png');
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES', () => {
  it('has the exact type message from the PRD', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('has the exact size message from the PRD', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('has the exact count message from the PRD', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('has the exact offline message from the PRD', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
