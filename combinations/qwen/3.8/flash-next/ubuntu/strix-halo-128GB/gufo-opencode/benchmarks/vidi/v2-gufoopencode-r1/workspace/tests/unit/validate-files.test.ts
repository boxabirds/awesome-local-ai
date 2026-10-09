import { describe, expect, test } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

function pngFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' });
}

describe('TC-08 validateFiles size boundary', () => {
  test('exactly IMAGE_MAX_BYTES is accepted', () => {
    const file = new File([new ArrayBuffer(IMAGE_MAX_BYTES)], 'edge.jpg', { type: 'image/jpeg' });
    const result = validateFiles([file]);
    expect(result.accepted).toEqual([file]);
    expect(result.rejections.size).toBe(0);
  });

  test('IMAGE_MAX_BYTES + 1 is rejected with the size message', () => {
    const file = new File([new ArrayBuffer(IMAGE_MAX_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
    const result = validateFiles([file]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('TC-09 validateFiles count limit and type mix', () => {
  test('21 valid files keep the first 20 and report count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      pngFile(`p${i}.png`, 16)
    );
    const result = validateFiles(files);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(result.rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  test('a PDF mixed with a PNG rejects the PDF only', () => {
    const pdf = new File([asciiBytes('%PDF-1.4')], 'doc.pdf', { type: 'application/pdf' });
    const png = pngFile('shot.png', 16);
    const result = validateFiles([pdf, png]);
    expect(result.accepted).toEqual([png]);
    expect(result.rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
  });

  test('offline message matches the PRD exactly', () => {
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect."
    );
  });
});

function asciiBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}
