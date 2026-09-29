import { describe, it, expect } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@shared/image-format';
import { validateFiles, REJECTION_MESSAGES } from '@client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '@shared/config';

describe('sniffImageType (TC-01)', () => {
  it('detects PNG', () => {
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    const head = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/png');
  });

  it('detects JPEG', () => {
    // JPEG magic: FF D8 FF
    const head = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    const head = new Uint8Array([...new TextEncoder().encode('GIF87a'), 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    const head = new Uint8Array([...new TextEncoder().encode('GIF89a'), 0, 0, 0, 0, 0, 0]);
    expect(sniffImageType(head)).toBe('image/gif');
  });

  it('detects WebP (RIFF....WEBP)', () => {
    const head = new Uint8Array([
      ...new TextEncoder().encode('RIFF'),
      0x00, 0x00, 0x00, 0x00, // file size placeholder
      ...new TextEncoder().encode('WEBP'),
    ]);
    expect(sniffImageType(head)).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const head = new Uint8Array([...new TextEncoder().encode('<svg xmlns="')]);
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    // PDF magic: %PDF (25 50 44 46)
    const head = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), 0, 0]);
    expect(sniffImageType(head)).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    const head = new Uint8Array([0x01, 0x02, 0x03]);
    expect(sniffImageType(head)).toBeNull();
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches valid key: 22 chars / 22 chars', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv/abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('rejects missing part (no slash)', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuvabcdefghijklmnopqrstuv')).toBe(false);
  });

  it("rejects '../'", () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuvw/abcdefghijklmnopqrstuv')).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins with /', () => {
    expect(assetKeyFor('abc', 'def')).toBe('abc/def');
  });
});

describe('validateFiles (TC-08, TC-09)', () => {
  function makeFile(name: string, size: number, type: string): File {
    const buf = new ArrayBuffer(size);
    return new File([buf], name, { type });
  }

  it('TC-08: accepts a file at exactly IMAGE_MAX_BYTES', () => {
    const f = makeFile('test.png', IMAGE_MAX_BYTES, 'image/png');
    const result = validateFiles([f]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(false);
  });

  it('TC-08: rejects a file at IMAGE_MAX_BYTES + 1', () => {
    const f = makeFile('test.png', IMAGE_MAX_BYTES + 1, 'image/png');
    const result = validateFiles([f]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('TC-09: accepts only first IMAGE_MAX_FILES_PER_ADD from 21 files', () => {
    const files = Array.from({ length: 21 }, (_, i) => makeFile(`img${i}.png`, 100, 'image/png'));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('TC-09: PDF + PNG mix: PNG accepted, type rejection recorded', () => {
    const pdf = makeFile('doc.pdf', 100, 'application/pdf');
    const png = makeFile('pic.png', 100, 'image/png');
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('pic.png');
    expect(result.rejections.has('type')).toBe(true);
  });

  it('REJECTION_MESSAGES match exact PRD wording', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
    expect(REJECTION_MESSAGES.rate).toBe("You're adding images too quickly. Wait a minute and try again.");
  });
});
