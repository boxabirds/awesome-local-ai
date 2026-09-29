/**
 * Unit tests for client-side file validation (story 12, image.insert).
 * TC-08, TC-09.
 */
import { describe, it, expect } from 'vitest';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { jpegBytes, pdfBytes, pngBytes } from '../fixtures/imageBytes';

function fileNamed(name: string, type: string, bytes: Uint8Array<ArrayBuffer> | number): File {
  const data = typeof bytes === 'number' ? new Uint8Array(bytes) : bytes;
  return new File([data], name, { type });
}

function png(name = 'shot.png', size = 0): File {
  return fileNamed(name, 'image/png', size === 0 ? pngBytes(4, 4) : new Uint8Array(size));
}

describe('validateFiles size limit (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const result = validateFiles([fileNamed('at-limit.jpg', 'image/jpeg', jpegBytes(IMAGE_MAX_BYTES))]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects IMAGE_MAX_BYTES + 1 with the size reason', () => {
    const result = validateFiles([
      fileNamed('over.jpg', 'image/jpeg', new Uint8Array(IMAGE_MAX_BYTES + 1)),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('keeps valid files alongside one that is too large', () => {
    const result = validateFiles([png(), fileNamed('big.png', 'image/png', IMAGE_MAX_BYTES + 1)]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('validateFiles type and count limits (TC-09)', () => {
  it(`accepts the first ${IMAGE_MAX_FILES_PER_ADD} of ${IMAGE_MAX_FILES_PER_ADD + 1} files and reports count`, () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, i) =>
      png(`shot-${i}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.accepted.map((f) => f.name)).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD).map((f) => f.name));
    expect(result.rejections.has('count')).toBe(true);
    expect(result.rejections.has('type')).toBe(false);
  });

  it('reports no count rejection at exactly the limit', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, i) =>
      png(`shot-${i}.png`),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.size).toBe(0);
  });

  it('accepts the PNG and reports the type reason for a PDF', () => {
    const result = validateFiles([
      fileNamed('doc.png', 'application/pdf', pdfBytes()),
      png(),
    ]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('shot.png');
    expect(result.rejections.has('type')).toBe(true);
  });

  it('rejects SVG and files with no MIME type', () => {
    const result = validateFiles([
      fileNamed('evil.svg', 'image/svg+xml', new Uint8Array(16)),
      fileNamed('no-extension', '', new Uint8Array(16)),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections).toEqual(new Set(['type']));
  });

  it('accepts each supported raster type', () => {
    const result = validateFiles([
      png('a.png'),
      fileNamed('b.jpg', 'image/jpeg', jpegBytes(64)),
      fileNamed('c.gif', 'image/gif', new Uint8Array(64)),
      fileNamed('d.webp', 'image/webp', new Uint8Array(64)),
    ]);
    expect(result.accepted).toHaveLength(4);
    expect(result.rejections.size).toBe(0);
  });

  it('handles an empty selection', () => {
    const result = validateFiles([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.size).toBe(0);
  });
});

describe('REJECTION_MESSAGES (PRD wording)', () => {
  it('matches the PRD text exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      'You’re offline — images can be added when you reconnect.',
    );
    expect(REJECTION_MESSAGES.rate).toBe(
      'You’re adding images too quickly. Wait a minute and try again.',
    );
  });
});
