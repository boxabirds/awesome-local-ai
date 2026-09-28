/**
 * Story 12: File validation unit tests.
 * TC-08, TC-09
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function makeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

// ─── TC-08: Size validation boundary ────────────────────────────────────────

describe('TC-08: validateFiles size boundary', () => {
  it('accepts file at exactly IMAGE_MAX_BYTES', () => {
    const file = makeFile('test.png', 'image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects file at IMAGE_MAX_BYTES + 1 with "size" rejection', () => {
    const file = makeFile('test.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('REJECTION_MESSAGES.size matches PRD wording', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

// ─── TC-09: Count limit and type mix ────────────────────────────────────────

describe('TC-09: validateFiles count and type', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD of 21 valid files with "count" rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 100),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('REJECTION_MESSAGES.count matches PRD wording', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('accepts PNG and rejects PDF with "type" rejection', () => {
    const png = makeFile('photo.png', 'image/png', 100);
    const pdf = makeFile('doc.pdf', 'application/pdf', 100);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('photo.png');
    expect(result.rejections.has('type')).toBe(true);
  });

  it('REJECTION_MESSAGES.type matches PRD wording', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('REJECTION_MESSAGES.offline matches PRD wording', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });

  it('REJECTION_MESSAGES.rate matches PRD wording', () => {
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });

  it('rejects SVG with "type"', () => {
    const svg = makeFile('diagram.svg', 'image/svg+xml', 100);
    const result = validateFiles([svg]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('accepts all four types', () => {
    const files = [
      makeFile('a.png', 'image/png', 50),
      makeFile('b.jpeg', 'image/jpeg', 50),
      makeFile('c.gif', 'image/gif', 50),
      makeFile('d.webp', 'image/webp', 50),
    ];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(4);
    expect(result.rejections.size).toBe(0);
  });
});
