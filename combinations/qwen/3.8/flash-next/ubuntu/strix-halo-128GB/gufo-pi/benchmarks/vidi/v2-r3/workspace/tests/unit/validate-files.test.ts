/**
 * Unit tests for client-side file validation.
 * TC-08, TC-09
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(name: string, type: string, size: number): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('big.png', 'image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with size rejection', () => {
    const file = makeFile('toobig.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('validateFiles count limit and type rejection (TC-09)', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD files and adds count rejection for 21 valid files', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 1024),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts PNG and rejects PDF with type rejection', () => {
    const pdf = makeFile('doc.pdf', 'application/pdf', 1024);
    const png = makeFile('img.png', 'image/png', 1024);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('img.png');
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('REJECTION_MESSAGES', () => {
  it('has exact PRD wording for type', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('has exact PRD wording for size', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('has exact PRD wording for count', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('has exact PRD wording for offline', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
