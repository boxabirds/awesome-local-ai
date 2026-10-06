/**
 * Unit tests for client-side file validation (TC-08, TC-09).
 */

import { describe, expect, it } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

/** Create a File-like object (jsdom File, or polyfill for node). */
function makeFile(name: string, type: string, size: number): File {
  const buf = new ArrayBuffer(size);
  return new File([buf], name, { type });
}

describe('validateFiles – size limit (TC-08)', () => {
  it('accepts a file exactly at IMAGE_MAX_BYTES', () => {
    const file = makeFile('big.png', 'image/png', IMAGE_MAX_BYTES);
    const result = validateFiles([file]);
    expect(result.accepted).toContain(file);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('rejects a file one byte over IMAGE_MAX_BYTES with size message', () => {
    const file = makeFile('toobig.png', 'image/png', IMAGE_MAX_BYTES + 1);
    const result = validateFiles([file]);
    expect(result.accepted).not.toContain(file);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('validateFiles – count and type limits (TC-09)', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD valid files and rejects count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      makeFile(`img${i}.png`, 'image/png', 100)
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
    // First 20 are accepted
    for (let i = 0; i < IMAGE_MAX_FILES_PER_ADD; i++) {
      expect(result.accepted).toContain(files[i]);
    }
  });

  it('accepts PNG and rejects PDF in a mixed batch', () => {
    const png = makeFile('photo.png', 'image/png', 200);
    const pdf = makeFile('doc.pdf', 'application/pdf', 200);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toContain(png);
    expect(result.accepted).not.toContain(pdf);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('rejects SVG by MIME type', () => {
    const svg = makeFile('icon.svg', 'image/svg+xml', 100);
    const result = validateFiles([svg]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('type')).toBe(true);
  });
});

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
    expect(REJECTION_MESSAGES.offline).toBe("You\u2019re offline \u2014 images can be added when you reconnect.");
  });
});
