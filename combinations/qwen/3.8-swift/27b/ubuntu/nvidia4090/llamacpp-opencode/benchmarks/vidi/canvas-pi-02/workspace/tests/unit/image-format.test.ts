// Story 12 (assets.api) unit tests: TC-01 (magic-byte sniffing) and
// TC-02 (asset key pattern). Pure function tests — no request handling.

import { describe, expect, it } from 'vitest';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';

/** PNG 89 50 4E 47 */
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
/** JPEG FF D8 FF E0 ... JFIF */
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
/** GIF87a */
const GIF87A_HEAD = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0, 0x01, 0, 0, 0]);
/** GIF89a */
const GIF89A_HEAD = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0, 0x01, 0, 0, 0]);
/** WebP: RIFF <size> WEBP */
const WEBP_HEAD = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x4c, 0x07, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('assets.api: sniffImageType', () => {
  it('TC-01: accepts PNG, JPEG, GIF87a, GIF89a and WebP by magic bytes', () => {
    expect(sniffImageType(PNG_HEAD)).toBe('image/png');
    expect(sniffImageType(JPEG_HEAD)).toBe('image/jpeg');
    expect(sniffImageType(GIF87A_HEAD)).toBe('image/gif');
    expect(sniffImageType(GIF89A_HEAD)).toBe('image/gif');
    expect(sniffImageType(WEBP_HEAD)).toBe('image/webp');
  });

  it('TC-01 (negative): SVG text, a PDF renamed .png and random bytes are not images', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(pdf)).toBeNull();
    expect(sniffImageType(Uint8Array.from([0xde, 0xad, 0xbe]))).toBeNull();
  });
});

describe('assets.api: asset keys', () => {
  it('TC-02: the pattern accepts <22>/<22> and rejects everything else', () => {
    const id = 'aB3-_xY'.padEnd(22, '0'); // 22 base64url chars
    expect(ASSET_KEY_PATTERN.test(`${id}/${id}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test(id)).toBe(false); // missing part
    expect(ASSET_KEY_PATTERN.test(`../${id}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${'a'.repeat(23)}/${id}`)).toBe(false); // 23-char id
    expect(ASSET_KEY_PATTERN.test(`${id}/../../etc`)).toBe(false);
  });

  it('assetKeyFor joins board and asset id with a slash', () => {
    expect(assetKeyFor('b', 'a')).toBe('b/a');
    const id = 'k'.repeat(22);
    expect(assetKeyFor(id, id)).toBe(`${id}/${id}`);
  });
});
