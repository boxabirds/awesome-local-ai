/** TC-08, TC-09 — file validation unit tests */

import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES } from '@client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('TC-08: validateFiles size boundary', () => {
  it('accepts a file exactly at IMAGE_MAX_BYTES', () => {
    const result = validateFiles([makeFile('large.png', IMAGE_MAX_BYTES, 'image/png')]);
    expect(result.accepted.length).toBe(1);
    expect(result.rejections.size).toBe(0);
  });

  it('rejects a file one byte over IMAGE_MAX_BYTES with "size" rejection', () => {
    const result = validateFiles([makeFile('too-large.png', IMAGE_MAX_BYTES + 1, 'image/png')]);
    expect(result.accepted.length).toBe(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

describe('TC-09: count limit and mixed types', () => {
  it('limits to first IMAGE_MAX_FILES_PER_ADD when too many valid files, returns "count" rejection', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 5 }, (_, i) =>
      makeFile(`img_${i}.png`, 1000, 'image/png'),
    );
    const result = validateFiles(files);
    expect(result.accepted.length).toBe(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('keeps PNG when mixed with rejected PDF, reports "type" rejection for non-images', () => {
    const png = makeFile('photo.png', 500, 'image/png');
    const pdf = makeFile('doc.pdf', 500, 'application/pdf');
    const jpg = makeFile('pic.jpg', 500, 'image/jpeg');
    const svg = makeFile('art.svg', 500, 'image/svg+xml');

    const result = validateFiles([pdf, png, svg, jpg]);
    // Should accept png and jpg (2 files), reject pdf and svg (wrong type)
    expect(result.accepted.length).toBe(2);
    expect(result.accepted.find(f => f.name === 'photo.png')).toBeDefined();
    expect(result.accepted.find(f => f.name === 'pic.jpg')).toBeDefined();
    expect(result.rejections.has('type')).toBe(true);
  });

  it('returns exact PRD message strings', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});
