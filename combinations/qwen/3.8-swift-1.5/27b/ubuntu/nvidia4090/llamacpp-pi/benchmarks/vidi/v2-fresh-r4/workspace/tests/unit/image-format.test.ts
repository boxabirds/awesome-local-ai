/**
 * Unit tests for image format sniffing (TC-01, TC-02) and file validation (TC-08, TC-09).
 */
import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';

// --- TC-01: sniffImageType ---

describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new TextEncoder().encode('GIF87a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new TextEncoder().encode('GIF89a\\x01\\x00');
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP', () => {
    // RIFF....WEBP
    const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x0a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const head = new TextEncoder().encode('<svg xmlns');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    const head = new TextEncoder().encode('%PDF-1.4\\n');
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

// --- TC-02: ASSET_KEY_PATTERN ---

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid <22>/<22> key', () => {
    const key = 'a'.repeat(22) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects missing part', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22))).toBe(false);
  });

  it('rejects ../', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'a'.repeat(23) + '/' + 'b'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });

  it('assetKeyFor builds correct key', () => {
    const boardId = 'x'.repeat(22);
    const assetId = 'y'.repeat(22);
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
  });
});

// --- TC-08: validateFiles size boundary ---

describe('TC-08: validateFiles size', () => {
  it('accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const file = new File(['x'.repeat(1)], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: IMAGE_MAX_BYTES });
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('rejects a file at IMAGE_MAX_BYTES + 1', () => {
    const file = new File(['x'.repeat(1)], 'test.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: IMAGE_MAX_BYTES + 1 });
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });
});

// --- TC-09: validateFiles count and type ---

describe('TC-09: validateFiles count and type', () => {
  it('accepts first 20 of 21 valid files + count rejection', () => {
    const files = Array.from({ length: 21 }, (_, i) =>
      new File([`file${i}`], `img${i}.png`, { type: 'image/png' }),
    );
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts PNG, rejects PDF + type rejection', () => {
    const png = new File(['png data'], 'test.png', { type: 'image/png' });
    const pdf = new File(['pdf data'], 'test.pdf', { type: 'application/pdf' });
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('test.png');
    expect(result.rejections.has('type')).toBe(true);
  });
});

// --- REJECTION_MESSAGES match PRD wording exactly ---

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
