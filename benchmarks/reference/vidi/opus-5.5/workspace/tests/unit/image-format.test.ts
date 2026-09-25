/** assets.api pure parts (story 12): TC-01 type sniffing, TC-02 asset key pattern. */
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_SNIFF_BYTES, IMAGE_UPLOAD_LIMIT, IMAGE_UPLOAD_PERIOD_SECONDS } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, assetUrl, sniffImageType } from '../../src/shared/image-format';
import { fixtureBytes } from '../fixtures/images';
import { readWranglerConfig } from './helpers/jsonc';

const head = (bytes: Uint8Array) => bytes.slice(0, IMAGE_SNIFF_BYTES);
const ascii = (s: string) => new TextEncoder().encode(s);

describe('TC-01 sniffImageType', () => {
  it('recognises PNG, JPEG, GIF87a, GIF89a and WebP by content', () => {
    expect(sniffImageType(head(fixtureBytes('screenshot')))).toBe('image/png');
    expect(sniffImageType(head(fixtureBytes('photo')))).toBe('image/jpeg');
    expect(sniffImageType(ascii('GIF87a\x01\x00\x01\x00'))).toBe('image/gif');
    expect(sniffImageType(head(fixtureBytes('animated')))).toBe('image/gif');
    expect(sniffImageType(head(fixtureBytes('webp')))).toBe('image/webp');
  });

  it('refuses SVG text, a PDF renamed .png and 3 random bytes', () => {
    expect(sniffImageType(head(fixtureBytes('svg')))).toBeNull();
    expect(sniffImageType(head(fixtureBytes('renamedPdf')))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x13, 0x37, 0x42]))).toBeNull();
  });

  it('needs the whole signature: a RIFF file that is not WebP, and truncated signatures, are refused', () => {
    expect(sniffImageType(ascii('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageType(ascii('GIF8'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('TC-02 ASSET_KEY_PATTERN', () => {
  const board = newBoardId();
  const asset = newBoardId();

  it('accepts <board id>/<asset id> made by assetKeyFor', () => {
    const key = assetKeyFor(board, asset);
    expect(key).toBe(`${board}/${asset}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(assetUrl(key)).toBe(`/api/assets/${board}/${asset}`);
  });

  it('refuses a missing part, ../ and a 23-character id', () => {
    expect(ASSET_KEY_PATTERN.test(board)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/../${asset}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${board}/${asset}x`)).toBe(false);
  });
});

describe('upload rate-limit settings parity', () => {
  it('wrangler.jsonc ASSET_UPLOAD_LIMITER matches IMAGE_UPLOAD_LIMIT / IMAGE_UPLOAD_PERIOD_SECONDS; R2 bound', () => {
    const config = readWranglerConfig<{
      ratelimits?: { name: string; simple: { limit: number; period: number } }[];
      r2_buckets?: { binding: string; bucket_name: string }[];
    }>();
    const binding = config.ratelimits?.find((r) => r.name === 'ASSET_UPLOAD_LIMITER');
    expect(binding?.simple).toEqual({ limit: IMAGE_UPLOAD_LIMIT, period: IMAGE_UPLOAD_PERIOD_SECONDS });
    expect(config.r2_buckets).toContainEqual({ binding: 'ASSETS_BUCKET', bucket_name: 'vidi6-assets' });
  });
});
