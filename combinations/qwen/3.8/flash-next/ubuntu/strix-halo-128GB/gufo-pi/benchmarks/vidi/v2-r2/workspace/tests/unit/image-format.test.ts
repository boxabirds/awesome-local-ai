import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@shared/image-format';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';
import { validateFiles, REJECTION_MESSAGES } from '@client/images/validateFiles';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES = path.resolve(__dirname, '../fixtures/images');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
}

// TC-01: sniffImageType returns correct types for valid magic bytes, null for invalid
describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(readFixture('test.png'))).toBe('image/png');
  });

  it('detects JPEG', () => {
    expect(sniffImageType(readFixture('test.jpg'))).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00]);
    expect(sniffImageType(gif)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    expect(sniffImageType(gif)).toBe('image/gif');
  });

  it('detects WebP', () => {
    expect(sniffImageType(readFixture('test.webp'))).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    expect(sniffImageType(readFixture('test.svg'))).toBeNull();
  });

  it('returns null for renamed PDF', () => {
    expect(sniffImageType(readFixture('renamed.pdf.png'))).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
  });
});

// TC-02: ASSET_KEY_PATTERN matches valid keys, rejects invalid ones
describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22> key', () => {
    const key = 'abcdefghijklmnopqrstuv/ABCDEFGHIJKLMNOPQRSTUV';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects key missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('rejects path traversal ../', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});

// assetKeyFor
describe('assetKeyFor', () => {
  it('joins boardId and assetId with /', () => {
    expect(assetKeyFor('abc', 'def')).toBe('abc/def');
  });
});

// TC-08: validateFiles size boundary
describe('TC-08: validateFiles size limit', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = new File([new Uint8Array(IMAGE_MAX_BYTES)], 'big.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(rejections.has('size')).toBe(false);
  });

  it('rejects a file at IMAGE_MAX_BYTES + 1 with size rejection', () => {
    const file = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'toobig.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
  });
});

// TC-09: validateFiles count and type
describe('TC-09: validateFiles count and type', () => {
  it('accepts first IMAGE_MAX_FILES_PER_ADD files from 21 valid files, rejects extra with count', () => {
    const files: File[] = [];
    for (let i = 0; i < IMAGE_MAX_FILES_PER_ADD + 1; i++) {
      files.push(new File([new Uint8Array(10)], `img${i}.png`, { type: 'image/png' }));
    }
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts a valid PNG from a mix of PDF and PNG, rejects PDF with type', () => {
    const pdf = new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' });
    const png = new File([new Uint8Array(10)], 'img.png', { type: 'image/png' });
    const { accepted, rejections } = validateFiles([pdf, png]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].name).toBe('img.png');
    expect(rejections.has('type')).toBe(true);
  });
});

// REJECTION_MESSAGES exact wording
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
