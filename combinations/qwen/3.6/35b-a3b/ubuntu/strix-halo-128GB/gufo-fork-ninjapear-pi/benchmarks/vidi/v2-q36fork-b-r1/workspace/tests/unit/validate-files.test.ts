/**
 * Story 12 — Unit tests for file validation (TC-08, TC-09).
 */
import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '@/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@/shared/config';

describe('REJECTION_MESSAGES (exact PRD wording)', () => {
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

// Helper to create a mock File
function makeFile(name: string, size: number, type: string): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

describe('validateFiles — size boundary (TC-08)', () => {
  it('exactly IMAGE_MAX_BYTES is accepted', () => {
    const file = makeFile('test.jpg', IMAGE_MAX_BYTES, 'image/jpeg');
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('IMAGE_MAX_BYTES + 1 is rejected with "size"', () => {
    const file = makeFile('test.jpg', IMAGE_MAX_BYTES + 1, 'image/jpeg');
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('smaller than limit is accepted', () => {
    const file = makeFile('test.png', 1024, 'image/png');
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
  });
});

describe('validateFiles — count and type limits (TC-09)', () => {
  it('more than IMAGE_MAX_FILES_PER_ADD adds "count" rejection and keeps first 20', () => {
    const files: File[] = [];
    for (let i = 0; i < 21; i++) {
      files.push(makeFile(`img${i}.png`, 100, 'image/png'));
    }
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
    // Verify only the first 20 are accepted
    expect(result.accepted[0]).toBe(files[0]);
    expect(result.accepted[19]).toBe(files[19]);
  });

  it('PDF mixed with PNG → PNG accepted, type rejection set', () => {
    const pdfFile = makeFile('doc.pdf', 100, 'application/pdf');
    const pngFile = makeFile('photo.png', 100, 'image/png');
    const result = validateFiles([pdfFile, pngFile]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(pngFile);
    expect(result.rejections.has('type')).toBe(true);
    expect(result.rejections.has('count')).toBe(false);
  });

  it('mixed valid PNG and over-limit JPEG → PNG accepted, both rejections', () => {
    const png = makeFile('good.png', 100, 'image/png');
    const bigJpg = makeFile('big.jpg', IMAGE_MAX_BYTES + 1, 'image/jpeg');
    const result = validateFiles([png, bigJpg]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toBe(png);
    expect(result.rejections.has('size')).toBe(true);
    expect(result.rejections.has('type')).toBe(false);
  });

  it('empty array returns empty accepted, no rejections', () => {
    const result = validateFiles([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.size).toBe(0);
  });

  it('all files wrong type → all rejected, type rejection', () => {
    const svg = makeFile('icon.svg', 100, 'image/svg+xml');
    const mp4 = makeFile('video.mp4', 100, 'video/mp4');
    const result = validateFiles([svg, mp4]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('type')).toBe(true);
  });
});
