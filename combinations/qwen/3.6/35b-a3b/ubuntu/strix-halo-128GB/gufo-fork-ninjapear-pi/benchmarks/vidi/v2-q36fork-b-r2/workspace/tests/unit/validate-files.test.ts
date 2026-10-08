import { describe, it, expect } from 'vitest';
import { validateFiles, REJECTION_MESSAGES, FileRejection } from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

// Helper to create a mock File-like object
function makeFile(name: string, size: number, type: string): File {
  return new File([], name, { type });
}
// Override the size getter on the mock file
Object.defineProperty(File.prototype, 'size', {
  get(this: File) {
    // Return the custom size if set as an own property
    return (this as any)._testSize ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'size')?.get?.call(this) ?? 0;
  },
  configurable: true,
});

function makeMockFile(name: string, size: number, type: string): File {
  const f = new File([], name, { type });
  Object.defineProperty(f, 'size', { value: size, writable: false, configurable: true });
  return f;
}

describe('REJECTION_MESSAGES (TC-08, TC-09)', () => {
  it('has exact PRD wording for type rejection', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  it('has exact PRD wording for size rejection', () => {
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });

  it('has exact PRD wording for count rejection', () => {
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('has offline message', () => {
    expect(REJECTION_MESSAGES.offline).toBe("You're offline — images can be added when you reconnect.");
  });
});

describe('validateFiles - size boundary (TC-08)', () => {
  it('accepts file at exactly IMAGE_MAX_BYTES', () => {
    const f = makeMockFile('test.jpg', IMAGE_MAX_BYTES, 'image/jpeg');
    const result = validateFiles([f]);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(false);
    expect(result.rejections.has('type')).toBe(false);
  });

  it('rejects file of IMAGE_MAX_BYTES + 1', () => {
    const f = makeMockFile('test.jpg', IMAGE_MAX_BYTES + 1, 'image/jpeg');
    const result = validateFiles([f]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('rejects empty image type', () => {
    const f = makeMockFile('test.txt', 100, '');
    const result = validateFiles([f]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('type')).toBe(true);
  });
});

describe('validateFiles - count limit (TC-09)', () => {
  it('limits to IMAGE_MAX_FILES_PER_ADD accepted files', () => {
    const files: File[] = [];
    for (let i = 0; i < 21; i++) {
      files.push(makeMockFile(`test${i}.png`, 100, 'image/png'));
    }
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(20);
    expect(result.rejections.has('count')).toBe(true);
  });

  it('accepts exactly IMAGE_MAX_FILES_PER_ADD without count rejection', () => {
    const files: File[] = [];
    for (let i = 0; i < 20; i++) {
      files.push(makeMockFile(`test${i}.png`, 100, 'image/png'));
    }
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(20);
    expect(result.rejections.has('count')).toBe(false);
  });

  it('mix of PDF and PNG: PNG accepted, type rejection shown', () => {
    const files: File[] = [];
    // Add one PDF (rejected by type) and then valid PNGs
    files.push(makeMockFile('bad.pdf', 100, ''));
    for (let i = 0; i < 5; i++) {
      files.push(makeMockFile(`good${i}.png`, 100, 'image/png'));
    }
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(5);
    expect(result.rejections.has('type')).toBe(true);
  });

  it('mix of oversized and valid files', () => {
    const files: File[] = [];
    files.push(makeMockFile('big.jpg', IMAGE_MAX_BYTES + 1, 'image/jpeg'));
    files.push(makeMockFile('ok.png', 100, 'image/png'));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejections.has('size')).toBe(true);
  });

  it('empty input returns empty accepted and no rejections', () => {
    const result = validateFiles([]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.size).toBe(0);
  });
});
