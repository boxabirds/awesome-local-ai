// Story 12, task 1: unit tests for client-side file validation (TC-08, TC-09).
// validateFiles is pure (reads only File.type and File.size), so the tests use
// structurally-typed stand-ins instead of real 10 MB buffers.

import { describe, expect, it } from 'vitest';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from '../../src/client/images/validateFiles';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';

function fakeFile(type: string, size: number): File {
  return { type, size } as unknown as File;
}

const png = (size = 1000): File => fakeFile('image/png', size);

describe('validateFiles (image.insert)', () => {
  it('TC-08: a file of exactly IMAGE_MAX_BYTES is accepted; +1 is rejected with size', () => {
    const atLimit = validateFiles([png(IMAGE_MAX_BYTES)]);
    expect(atLimit.accepted).toHaveLength(1);
    expect(atLimit.rejections.size).toBe(0);

    const over = validateFiles([png(IMAGE_MAX_BYTES + 1)]);
    expect(over.accepted).toHaveLength(0);
    expect(over.rejections.has('size')).toBe(true);
  });

  it('TC-09: 21 valid files → first IMAGE_MAX_FILES_PER_ADD accepted plus count', () => {
    const files = Array.from({ length: 21 }, () => png());
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(result.rejections.has('count')).toBe(true);
    expect(result.accepted).toEqual(files.slice(0, IMAGE_MAX_FILES_PER_ADD));
  });

  it('TC-09: a PDF + PNG mix → the PNG is accepted and type is reported', () => {
    const result = validateFiles([fakeFile('application/pdf', 100), png()]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.type).toBe('image/png');
    expect(result.rejections.has('type')).toBe(true);
  });

  it('a fully valid batch is accepted with no rejections', () => {
    const result = validateFiles([png(), fakeFile('image/jpeg', 50), fakeFile('image/gif', 50)]);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejections.size).toBe(0);
  });

  it('REJECTION_MESSAGES match the PRD wording exactly', () => {
    expect(REJECTION_MESSAGES.type).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(REJECTION_MESSAGES.size).toBe('Images must be 10 MB or smaller.');
    expect(REJECTION_MESSAGES.count).toBe('Only 20 images can be added at once.');
    expect(REJECTION_MESSAGES.offline).toBe(
      "You're offline — images can be added when you reconnect.",
    );
    expect(REJECTION_MESSAGES.rate).toBe(
      "You're adding images too quickly. Wait a minute and try again.",
    );
  });
});
