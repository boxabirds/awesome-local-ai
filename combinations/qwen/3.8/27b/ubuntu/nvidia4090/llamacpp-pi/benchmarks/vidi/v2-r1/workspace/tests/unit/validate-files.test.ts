// TC-08, TC-09: client-side file validation (image.insert): the size and
// count boundaries and the exact PRD rejection messages.

import { describe, it, expect } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { REJECTION_MESSAGES, validateFiles } from '../../src/client/images/validateFiles';
import {
  exactLimitJpegBytes,
  fileFromBytes,
  overLimitJpegBytes,
  pdfBytes,
  pngBytes,
} from '../fixtures/images';

const png = (name: string, w = 8, h = 8) =>
  fileFromBytes(name, pngBytes(w, h), 'image/png');

describe('image.insert: validateFiles size boundary (TC-08)', () => {
  it('accepts a file of exactly IMAGE_MAX_BYTES', () => {
    const file = fileFromBytes('limit.jpg', exactLimitJpegBytes(), 'image/jpeg');
    expect(file.size).toBe(IMAGE_MAX_BYTES);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(file);
    expect(rejections.size).toBe(0);
  });

  it('rejects a file of IMAGE_MAX_BYTES + 1 with the size message', () => {
    const file = fileFromBytes('over.jpg', overLimitJpegBytes(), 'image/jpeg');
    expect(file.size).toBe(IMAGE_MAX_BYTES + 1);
    const { accepted, rejections } = validateFiles([file]);
    expect(accepted).toHaveLength(0);
    expect(rejections.has('size')).toBe(true);
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
  });
});

describe('image.insert: validateFiles count and type (TC-09)', () => {
  it('accepts the first IMAGE_MAX_FILES_PER_ADD of 21 and reports count', () => {
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) =>
      png(`${i}.png`),
    );
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    // the first 20, in order
    expect(accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
    expect(rejections.has('count')).toBe(true);
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
  });

  it('accepts the PNG and reports type for a PDF + PNG mix', () => {
    const good = png('good.png');
    // The PDF arrives with a non-image MIME type (the server would 415 a
    // disguised .png rename too — that is the decode-failure path, TC-29).
    const pdf = fileFromBytes('doc.pdf', pdfBytes(), 'application/pdf');
    const { accepted, rejections } = validateFiles([pdf, good]);
    expect(accepted).toEqual([good]);
    expect(rejections.has('type')).toBe(true);
    expect(REJECTION_MESSAGES.type).toBe(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
  });

  it('reports size and count together when both occur', () => {
    const over = fileFromBytes('over.jpg', overLimitJpegBytes(), 'image/jpeg');
    const files = [
      over,
      ...Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => png(`${i}.png`)),
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(rejections.has('size')).toBe(true);
    expect(rejections.has('count')).toBe(true);
  });

  it('accepts all four supported MIME types', () => {
    const files = [
      fileFromBytes('a.png', pngBytes(4, 4), 'image/png'),
      fileFromBytes('b.jpg', exactLimitJpegBytes().slice(0, 100), 'image/jpeg'),
      fileFromBytes('c.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38]), 'image/gif'),
      fileFromBytes('d.webp', new Uint8Array([0x52, 0x49, 0x46, 0x46]), 'image/webp'),
    ];
    const { accepted, rejections } = validateFiles(files);
    expect(accepted).toHaveLength(4);
    expect(rejections.size).toBe(0);
  });
});

describe('image.insert: REJECTION_MESSAGES offline wording (PRD image.offline)', () => {
  it('matches the PRD exactly', () => {
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
  });
});
