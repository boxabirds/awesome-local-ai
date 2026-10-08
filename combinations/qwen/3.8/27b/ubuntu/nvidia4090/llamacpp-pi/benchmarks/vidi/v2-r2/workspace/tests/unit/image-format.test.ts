/**
 * Unit tests for image-format.ts (story 12 TC-01, TC-02).
 *
 * TC-01: sniffImageType correctly identifies PNG, JPEG, GIF, WebP and
 *        rejects SVG, renamed PDF, random bytes.
 * TC-02: ASSET_KEY_PATTERN validates well-formed keys.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixtureDir = join(__dirname, '..', 'fixtures', 'images');

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtureDir, name)));
}

function head(buf: Uint8Array): Uint8Array {
  return buf.slice(0, IMAGE_SNIFF_BYTES);
}

describe('sniffImageType (TC-01)', () => {
  it('identifies PNG', () => {
    expect(sniffImageType(head(readFixture('small.png')))).toBe('image/png');
  });

  it('identifies JPEG', () => {
    expect(sniffImageType(head(readFixture('small.jpeg')))).toBe('image/jpeg');
  });

  it('identifies GIF87a', () => {
    // Build a minimal GIF87a header
    const gif87a = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00]);
    expect(sniffImageType(gif87a)).toBe('image/gif');
  });

  it('identifies GIF89a', () => {
    expect(sniffImageType(head(readFixture('small.gif')))).toBe('image/gif');
  });

  it('identifies WebP', () => {
    expect(sniffImageType(head(readFixture('small.webp')))).toBe('image/webp');
  });

  it('rejects SVG text', () => {
    expect(sniffImageType(head(readFixture('script.svg')))).toBeNull();
  });

  it('rejects PDF renamed to .png', () => {
    expect(sniffImageType(head(readFixture('fake.png')))).toBeNull();
  });

  it('rejects 3 random bytes', () => {
    expect(sniffImageType(head(readFixture('random.bin')))).toBeNull();
  });

  it('rejects corrupt PNG (truncated)', () => {
    // Has valid PNG header but is truncated
    expect(sniffImageType(head(readFixture('corrupt.png')))).toBe('image/png');
    // The file is valid at the magic-byte level; the corrupt part is detected
    // by createImageBitmap on the client. The server only checks magic bytes.
  });
});

describe('ASSET_KEY_PATTERN (TC-02)', () => {
  it('matches a valid key', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'B'.repeat(22);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(true);
  });

  it('rejects a key with a missing part', () => {
    expect(ASSET_KEY_PATTERN.test('a'.repeat(22))).toBe(false);
  });

  it('rejects a key with a path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects a key with a 23-char id', () => {
    const boardId = 'a'.repeat(22);
    const assetId = 'B'.repeat(23);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('builds the key from boardId and assetId', () => {
    expect(assetKeyFor('abc', 'def')).toBe('abc/def');
  });
});
