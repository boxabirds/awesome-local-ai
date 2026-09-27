import { describe, expect, it } from 'vitest';
import { generateSecret, hashesEqual, hashSecret, isWellFormedSecret } from '../../src/lib/crypto';

function decodeBase64url(value: string): Uint8Array {
  const b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

describe('workspace secrets', () => {
  it('TC-01 generateSecret is 43 base64url chars that decode to 32 bytes', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret).not.toContain('=');
    expect(decodeBase64url(secret).byteLength).toBe(32);
  });

  it('TC-02 1000 generated secrets are all distinct', () => {
    const secrets = new Set(Array.from({ length: 1000 }, generateSecret));
    expect(secrets.size).toBe(1000);
  });

  it('TC-03 hashSecret is deterministic, 64 lowercase hex', async () => {
    const secret = generateSecret();
    const a = await hashSecret(secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSecret(secret)).toBe(a);
    expect(await hashSecret(generateSecret())).not.toBe(a);
    // Known SHA-256 vector.
    expect(await hashSecret('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('TC-04 hashesEqual is true for identical hashes', async () => {
    const hash = await hashSecret(generateSecret());
    expect(hashesEqual(hash, `${hash}`)).toBe(true);
  });

  it('TC-05 hashesEqual is false for a 1-char difference and a length difference, never throws', async () => {
    const hash = await hashSecret(generateSecret());
    const flipped = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
    expect(hashesEqual(hash, flipped)).toBe(false);
    expect(hashesEqual(flipped, hash)).toBe(false);
    expect(hashesEqual(hash, hash.slice(0, -1))).toBe(false);
    expect(hashesEqual(hash.slice(0, -1), hash)).toBe(false);
    expect(hashesEqual(hash, '')).toBe(false);
    expect(hashesEqual('', hash)).toBe(false);
    expect(() => hashesEqual('', '')).not.toThrow();
  });

  it('TC-06 isWellFormedSecret accepts only exactly 43 base64url chars', () => {
    const secret = generateSecret();
    expect(isWellFormedSecret(secret)).toBe(true);
    expect(isWellFormedSecret('A'.repeat(43))).toBe(true);
    expect(isWellFormedSecret('-_'.repeat(21) + 'x')).toBe(true);
    expect(isWellFormedSecret(secret.slice(0, 42))).toBe(false);
    expect(isWellFormedSecret(`${secret}A`)).toBe(false);
    expect(isWellFormedSecret(`${secret.slice(0, 42)}+`)).toBe(false);
    expect(isWellFormedSecret(`${secret.slice(0, 42)}/`)).toBe(false);
    expect(isWellFormedSecret(`${secret.slice(0, 42)}=`)).toBe(false);
    expect(isWellFormedSecret(`${secret.slice(0, 42)} `)).toBe(false);
    expect(isWellFormedSecret('')).toBe(false);
    expect(isWellFormedSecret(undefined)).toBe(false);
    expect(isWellFormedSecret(42)).toBe(false);
  });
});
