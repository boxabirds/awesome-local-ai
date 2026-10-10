import { describe, expect, test } from 'vitest';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

function png(name = 'a.png', size = 1024): File {
  return file(name, 'image/png', size);
}

// TC-08: the size boundary is inclusive at IMAGE_MAX_BYTES.
describe('validateFiles size limit (TC-08)', () => {
  test('exactly IMAGE_MAX_BYTES is accepted', () => {
    const big = png('big.png', IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([big]);
    expect(accepted).toEqual([big]);
    expect(rejections.size).toBe(0);
  });

  test('IMAGE_MAX_BYTES + 1 is rejected with the size message', () => {
    const over = png('over.png', IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([over]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

// TC-09: the count limit cuts to the first 20; wrong MIME types are refused
// while supported files from the same batch survive.
describe('validateFiles count and type limits (TC-09)', () => {
  test('21 valid files → first 20 accepted plus the count message', () => {
    const files = Array.from({ length: 21 }, (_, i) => png(`p${i}.png`));
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(20);
    expect(accepted).toEqual(files.slice(0, 20));
    expect(rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  test('a renamed PDF is refused with the type message, the PNG is kept', () => {
    const ok = png('photo.png');
    const pdf = file('report.png', 'application/pdf', 2048);
    const { accepted, rejections } = validateFiles([pdf, ok]);
    expect(accepted).toEqual([ok]);
    expect(rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect."
    );
  });

  test('all four accepted MIME types pass, svg does not', () => {
    const files = [
      png('a.png'),
      file('b.jpg', 'image/jpeg', 10),
      file('c.gif', 'image/gif', 10),
      file('d.webp', 'image/webp', 10),
      file('e.svg', 'image/svg+xml', 10)
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toEqual(files.slice(0, 4));
    expect(rejections).toEqual(new Set(['type']));
  });

  test('empty input → nothing accepted, nothing rejected', () => {
    const { accepted, rejections } = validateFiles([]);
    expect(accepted).toHaveLength(0);
    expect(rejections.size).toBe(0);
  });
});
