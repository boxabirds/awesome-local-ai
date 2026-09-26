import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '@/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@/shared/config';

/**
 * Story 12 — image.insert unit tests (TC-08, TC-09): the pure client-side
 * validation rules and the exact PRD messages.
 */

function file(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('validateFiles — size limit (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES (boundary)', () => {
    const { accepted, rejections } = validateFiles([file('a.png', 'image/png', IMAGE_MAX_BYTES)]);
    expect(accepted).toHaveLength(1);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with the size message (boundary)', () => {
    const { accepted, rejections } = validateFiles([file('a.png', 'image/png', IMAGE_MAX_BYTES + 1)]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

describe('validateFiles — count and type (TC-09)', () => {
  it('accepts only the first IMAGE_MAX_FILES_PER_ADD of 21 valid files + count rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      file(`${i}.png`, 'image/png', 10),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
    expect(rejections.has('type')).toBe(false);
    // The accepted set is the FIRST 20 (order preserved).
    expect(accepted.map((f) => f.name)).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD).map((f) => f.name));
  });

  it('accepts the PNG and rejects the PDF, recording a type rejection', () => {
    const pdf = file('doc.pdf', 'application/pdf', 10);
    const png = file('pic.png', 'image/png', 10);
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].name).toBe('pic.png');
    expect(rejections.has('type')).toBe(true);
  });

  it('no rejections for a clean batch', () => {
    const { accepted, rejections } = validateFiles([
      file('a.png', 'image/png', 10),
      file('b.jpg', 'image/jpeg', 10),
    ]);
    expect(accepted).toHaveLength(2);
    expect(rejections.size).toBe(0);
  });
});

describe('REJECTION_MESSAGES match the PRD exactly', () => {
  it('type / size / count / offline / rate', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });
});
