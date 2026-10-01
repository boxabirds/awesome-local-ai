import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

// Helper to create a File with given type and size
function makeFile(type: string, size: number, name = 'test'): File {
  // Use a Blob and wrap in a File
  const blob = new Blob([new Uint8Array(size)]);
  return new File([blob], name, { type });
}

// TC-08: validateFiles size boundary
describe('TC-08: validateFiles size limit', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with size message', () => {
    const file = makeFile('image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

// TC-09: validateFiles count limit and type mix
describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 of 21 valid files + count message', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      makeFile('image/png', 100, `img${i}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts PNG and rejects PDF in a mix + type message', () => {
    const png = makeFile('image/png', 100, 'valid.png');
    const pdf = makeFile('application/pdf', 100, 'fake.png');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('valid.png');
    expect(result.rejections.has('type')).toBe(true);
  });
});

// REJECTION_MESSAGES match PRD wording exactly
describe('REJECTION_MESSAGES', () => {
  it('type message matches PRD', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('size message matches PRD', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('count message matches PRD', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('offline message matches PRD', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
