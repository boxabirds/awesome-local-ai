// Story 12, task 3/4 — the limits are names, and the names are the deployment's.
//
// Every number in this file is a number the PRD states in words ("10 MB", "20 images", "five
// minutes", "60 per minute"), and two of them are written down twice: once here as a setting
// and once in wrangler.jsonc as a rate-limiting binding that the platform enforces and this
// repository cannot read at runtime. A test is the only thing that keeps those two copies
// telling the same story, which is why the parity assertion below exists rather than a comment
// asking somebody to be careful.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSET_CACHE_MAX_AGE_S,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_LIMIT_MESSAGE,
  IMAGE_UPLOAD_PERIOD_SECONDS,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config.ts';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format.ts';

/** Strip line and block comments from a .jsonc source so it can be JSON.parse'd. */
function stripJsonc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
}

interface Binding {
  type?: string;
  name: string;
  simple?: { limit: number; period: number };
}

function ratelimitBinding(config: {
  ratelimits?: Binding[];
  unsafe?: { bindings?: Binding[] };
  [key: string]: unknown;
}, name: string): { limit: number; period: number } {
  const top = config.ratelimits?.find((b) => b.name === name);
  if (top?.simple) return top.simple;
  const unsafe = config.unsafe?.bindings?.find((b) => b.name === name && b.type === 'ratelimit');
  if (!unsafe?.simple) throw new Error(`no ${name} ratelimit binding in wrangler.jsonc`);
  return unsafe.simple;
}

describe('the named settings (PRD settings)', () => {
  it('are the numbers the PRD states', () => {
    expect(IMAGE_ACCEPTED_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(IMAGE_SNIFF_BYTES).toBe(12);
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(IMAGE_MAX_FILES_PER_ADD).toBe(20);
    expect(IMAGE_MAX_PLACE_SIZE_WORLD).toBe(800);
    expect(IMAGE_MIN_SIZE_WORLD).toBe(16);
    expect(IMAGE_LAYOUT_GAP_WORLD).toBe(24);
    expect(IMAGE_UPLOAD_STALE_MS).toBe(5 * 60 * 1000);
    expect(IMAGE_UPLOAD_LIMIT).toBe(60);
    expect(IMAGE_UPLOAD_PERIOD_SECONDS).toBe(60);
    // A year, and the reason it can be a year: an asset's bytes never change.
    expect(ASSET_CACHE_MAX_AGE_S).toBe(31536000);
  });

  it('says the messages the PRD says, in the PRD’s words', () => {
    expect(IMAGE_UPLOAD_LIMIT_MESSAGE).toBe(
      "You're adding images too quickly. Wait a minute and try again.",
    );
  });

});

describe('the deployment mirrors the settings', () => {
  const config = JSON.parse(
    stripJsonc(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')),
  ) as {
    ratelimits?: Binding[];
    unsafe?: { bindings?: Binding[] };
    r2_buckets?: { binding: string; bucket_name: string }[];
    [key: string]: unknown;
  };

  it('gives image uploads the allowance the setting names', () => {
    expect(ratelimitBinding(config, 'ASSET_UPLOAD_LIMITER')).toEqual({
      limit: IMAGE_UPLOAD_LIMIT,
      period: IMAGE_UPLOAD_PERIOD_SECONDS,
    });
  });

  it('keeps the board creation limit its own, separate allowance', () => {
    // Two limits, two namespaces: a visitor who has dropped 60 pictures can still open a board.
    const create = ratelimitBinding(config, 'BOARD_CREATE_LIMITER');
    expect(create).not.toEqual({ limit: IMAGE_UPLOAD_LIMIT, period: IMAGE_UPLOAD_PERIOD_SECONDS });
    const binding = (name: string) =>
      (config.unsafe?.bindings ?? []).find((b) => b.name === name);
    expect(binding('ASSET_UPLOAD_LIMITER')?.type).toBe('ratelimit');
  });

  it('binds a bucket, and only one, for the pictures', () => {
    expect(config.r2_buckets).toEqual([{ binding: 'ASSETS_BUCKET', bucket_name: 'vidi6-assets' }]);
  });

  it('stores a picture under a key a bucket binding can actually hold', () => {
    // Nothing in the deployment names a path, a prefix or a TTL: the key shape is the whole
    // of the storage contract, and it is the same shape the route matches.
    expect(ASSET_KEY_PATTERN.source).toContain('{22}');
  });
});
