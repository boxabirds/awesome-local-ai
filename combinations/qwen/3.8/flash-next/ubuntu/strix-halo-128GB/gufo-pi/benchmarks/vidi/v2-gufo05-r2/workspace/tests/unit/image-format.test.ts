/**
 * Story 12 unit tests: image format sniffing and asset key validation (TC-01, TC-02).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

const FIXTURES = resolve(__dirname, '../fixtures/images');

function fixtureBytes(name: string, maxBytes?: number): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, maxBytes ?? buf.byteLength);
}

describe('TC-01: sniffImageType', () => {
  it('detects PNG', () => {
    expect(sniffImageType(fixtureBytes('tiny.png', 12))).toBe('image/png');
  });

  it('detects JPEG', () => {
    expect(sniffImageType(fixtureBytes('tiny.jpg', 12))).toBe('image/jpeg');
  });

  it('detects GIF87a', () => {
    expect(sniffImageType(fixtureBytes('tiny.gif', 12))).toBe('image/gif');
  });

  it('detects GIF89a', () => {
    expect(sniffImageType(fixtureBytes('tiny89a.gif', 12))).toBe('image/gif');
  });

  it('detects WebP', () => {
    expect(sniffImageType(fixtureBytes('tiny.webp', 12))).toBe('image/webp');
  });

  it('returns null for SVG text', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg.slice(0, 12))).toBeNull();
  });

  it('returns null for PDF renamed .png', () => {
    expect(sniffImageType(fixtureBytes('fake-pdf.png', 12))).toBeNull();
  });

  it('returns null for 3 random bytes', () => {
    expect(sniffImageType(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('TC-02: ASSET_KEY_PATTERN', () => {
  it('matches valid key (22-char/22-char)', () => {
    const key = 'abcdefghijklmnopqrstuv/ABCDEFGHIJKLMNOPQRSTUV';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  });

  it('rejects key with missing part', () => {
    expect(ASSET_KEY_PATTERN.test('abcdefghijklmnopqrstuv')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
  });

  it('rejects 23-char id', () => {
    const key = 'abcdefghijklmnopqrstuvw/abcdefghijklmnopqrstuv';
    expect(ASSET_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe('assetKeyFor', () => {
  it('joins boardId and assetId with /', () => {
    expect(assetKeyFor('a'.repeat(22), 'b'.repeat(22))).toBe(`${'a'.repeat(22)}/${'b'.repeat(22)}`);
  });
});
