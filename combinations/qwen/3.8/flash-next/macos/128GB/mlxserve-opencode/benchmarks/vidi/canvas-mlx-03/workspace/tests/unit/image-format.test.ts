// Story 12, tasks 1 — naming an image by its bytes.
//
// Two people decide whether a file is an uploadable image: the client, which is allowed to
// look at the name and the decoded picture, and the Worker, which is not — by the time it
// sees a request it holds a stream of bytes and a claimed content type, and a `curl` can lie
// about both. This is the Worker's half of that decision, and the one place both halves can
// agree on: the signature the format itself starts with.
//
// TC-01, TC-02.
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN, IMAGE_FORMAT_SIGNATURES, assetKeyFor, sniffImageType } from '../../src/shared/image-format.ts';
import { IMAGE_SNIFF_BYTES } from '../../src/shared/config.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { imageBytes } from '../fixtures/images/files.ts';

const bytes = (...numbers: number[]) => new Uint8Array(numbers);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('sniffImageType: the signature each accepted format starts with', () => {
  // TC-01
  it('names a PNG by its eight-byte signature', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4))).toBe(
      'image/png',
    );
  });

  it('names a JPEG by start-of-image, with or without an APP segment after it', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('image/jpeg');
    // A camera file: SOI, then an Exif APP1. The type is still JPEG's marker, not Exif's.
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00))).toBe(
      'image/jpeg',
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01))).toBe(
      'image/jpeg',
    );
  });

  it('names both GIF versions', () => {
    expect(sniffImageType(ascii('GIF87a'))).toBe('image/gif');
    expect(sniffImageType(ascii('GIF89a'))).toBe('image/gif');
  });

  it('names a WebP only when the RIFF carries the WEBP form name', () => {
    expect(sniffImageType(bytes(...ascii('RIFF'), 0x24, 0x24, 0x00, 0x00, ...ascii('WEBP')))).toBe(
      'image/webp',
    );
    // A RIFF container that is not a WebP: a WAV, an AVI, anything else.
    expect(sniffImageType(bytes(...ascii('RIFF'), 0x24, 0x24, 0x00, 0x00, ...ascii('WAVE')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('RIFF'), 0x24, 0x24, 0x00, 0x00, ...ascii('AVI ')))).toBeNull();
  });

  it('reads only as much as it needs, and says so in the name', () => {
    expect(IMAGE_SNIFF_BYTES).toBe(12);
    // The longest signature is WebP's, which ends at byte 12; anything longer is not being read.
    for (const signature of Object.values(IMAGE_FORMAT_SIGNATURES)) {
      expect(signature.length).toBeLessThanOrEqual(IMAGE_SNIFF_BYTES);
    }
  });

  it('returns null for anything that is not one of the four', () => {
    expect(sniffImageType(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(ascii('%PDF-1.4'))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull(); // empty
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeNull(); // signature cut short
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull(); // JPEG marker alone is not a file
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull(); // "GIF8" without the version
    expect(sniffImageType(bytes(...ascii('RIFF')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('WEBP'), ...ascii('RIFF')))).toBeNull(); // the right letters, wrong end
  });

  it('answers the same for a whole file as for its first IMAGE_SNIFF_BYTES bytes', () => {
    // TC-01's last row: a byte count at or below the sniff length carries no more information.
    for (const name of ['png-24', 'jpeg-24', 'webp-640x480', 'gif-animated', 'pdf', 'svg']) {
      const whole = imageBytes(name);
      expect(sniffImageType(whole.subarray(0, IMAGE_SNIFF_BYTES))).toBe(sniffImageType(whole));
    }
  });

  it('names nothing when a signature is one byte short', () => {
    // The other half of the same row: the byte count that is one less than a signature is
    // not a shorter answer, it is no answer.
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a))).toBeNull(); // PNG, 7 of 8
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull(); // JPEG, 2 of 3
    expect(sniffImageType(bytes(...ascii('GIF87')))).toBeNull(); // GIF, 5 of 6
    expect(sniffImageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEB')))).toBeNull(); // WebP, 11 of 12
  });

  it('is not fooled by a file that only *says* it is an image', () => {
    // The names the client is told to distrust, written out in the bytes they claim.
    expect(sniffImageType(ascii('<?xml version="1.0"?><svg onload="alert(1)"></svg>'))).toBeNull();
    expect(sniffImageType(ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3'))).toBeNull();
    expect(sniffImageType(ascii('GIFC'))) // "GIF" with a fourth letter
      .toBeNull();
  });
});

describe('sniffImageType: the real fixtures (TC-02)', () => {
  it('names every real file the tests carry', () => {
    for (const name of ['png-1440x900', 'png-24']) {
      expect(sniffImageType(imageBytes(name))).toBe('image/png');
    }
    for (const name of ['jpeg-4032x3024', 'jpeg-24']) {
      expect(sniffImageType(imageBytes(name))).toBe('image/jpeg');
    }
    expect(sniffImageType(imageBytes('webp-640x480'))).toBe('image/webp');
    expect(sniffImageType(imageBytes('gif-animated'))).toBe('image/gif');
  });

  it('refuses the files that are not images, whatever the test calls them', () => {
    expect(sniffImageType(imageBytes('pdf'))).toBeNull();
    expect(sniffImageType(imageBytes('svg'))).toBeNull();
    // A PNG cut off 24 bytes in still *signatures* as a PNG — the signature is a statement of
    // intent, and it is the only thing the Worker can be asked about. Story 12's client half
    // additionally decodes the file, which is where a truncated one is caught.
    expect(sniffImageType(imageBytes('png-truncated'))).toBe('image/png');
  });

  it('reads a 12-byte read of each fixture exactly as the whole file', () => {
    for (const name of [
      'png-1440x900',
      'jpeg-4032x3024',
      'webp-640x480',
      'gif-animated',
      'pdf',
      'svg',
      'png-truncated',
    ]) {
      const whole = imageBytes(name);
      expect(sniffImageType(whole.subarray(0, IMAGE_SNIFF_BYTES))).toBe(sniffImageType(whole));
    }
  });
});

describe('asset keys', () => {
  it('accepts a board id and an asset id, and nothing else', () => {
    // A board id on its own is not an asset key: it names no file, and reading a board's whole
    // prefix of the bucket is the one thing this pattern has to make impossible.
    expect(ASSET_KEY_PATTERN.test('vKd9nR2pQ8sT4uW1xY7zA3')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('vKd9nR2pQ8sT4uW1xY7zA3/aB3dE5fG7hI9jK1lM3nO5p')).toBe(true);
    // What an attacker actually tries: another board's file, a path out of the bucket, a
    // prefix of a real key.
    expect(ASSET_KEY_PATTERN.test('a/b/c')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('../vKd9nR2pQ8sT4uW1xY7zA3')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('vKd9nR2pQ8sT4uW1xY7zA3/..%2f')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('vKd9nR2pQ8sT4uW1xY7zA3/aB3dE5fG7hI9jK1lM3nO5')).toBe(false); // a 21-character asset part
    expect(ASSET_KEY_PATTERN.test('vKd9nR2pQ8sT4uW1xY7zA3/')).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
  });

  it('puts the board first, so one board is one prefix of the bucket', () => {
    expect(assetKeyFor('vKd9nR2pQ8sT4uW1xY7zA3', 'aB3dE5fG7hI9jK1lM3nO5p')).toBe(
      'vKd9nR2pQ8sT4uW1xY7zA3/aB3dE5fG7hI9jK1lM3nO5p',
    );
  });

  it('produces a key its own pattern accepts, for ids as they are really made', () => {
    // The two halves of this codebase's asset address have to agree by construction, not by
    // both happening to be right about the same 22 characters.
    for (let i = 0; i < 50; i++) {
      expect(ASSET_KEY_PATTERN.test(assetKeyFor(newBoardId(), newBoardId()))).toBe(true);
    }
  });
});
