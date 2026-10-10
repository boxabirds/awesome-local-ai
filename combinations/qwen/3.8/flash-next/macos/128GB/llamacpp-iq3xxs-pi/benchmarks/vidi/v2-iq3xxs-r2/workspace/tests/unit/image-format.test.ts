/**
 * Story 12, task 1: which images the board will take, decided from the bytes.
 *
 * TC-01 (`image.types`, `image.types.security`) and the unit half of TC-14
 * (`image.storage.serving`).
 *
 * The point of these cases is the gap between a file's name and a file's contents. Every
 * rejected case below is one a person could produce by accident — a PDF renamed so it can be
 * dropped, a screenshot tool that wrote an SVG — and every accepted case is a file a browser
 * will decode, so the test cannot pass by checking a suffix.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../src/shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
} from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import {
  gif87aHeader,
  gifHeader,
  jpegHeader,
  pdfBytes,
  pngBytes,
  truncatedPngBytes,
  webpBytes,
} from '../fixtures/image-bytes';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'images');

/** The first `IMAGE_SNIFF_BYTES` of a fixture, which is all a sniffer gets to work with. */
function headOf(fixture: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, fixture)));
  return bytes.subarray(0, IMAGE_SNIFF_BYTES);
}

describe('sniffImageType (TC-01)', () => {
  it('recognises each accepted kind from a real file', () => {
    // The fixtures are the files the generator wrote, not hand-made byte arrays, so a
    // fixture that stopped being a real image would fail here rather than downstream.
    expect(sniffImageType(headOf('screenshot-1440x900.png'))).toBe('image/png');
    expect(sniffImageType(headOf('photo-4032x3024.jpg'))).toBe('image/jpeg');
    expect(sniffImageType(headOf('animated.gif'))).toBe('image/gif');
    expect(sniffImageType(headOf('photo-640x480.webp'))).toBe('image/webp');
  });

  it('recognises every signature the accepted kinds use', () => {
    expect(sniffImageType(pngBytes())).toBe('image/png');
    expect(sniffImageType(jpegHeader())).toBe('image/jpeg');
    // Both GIF magic numbers, because files carry both and a GIF87a is not a different type.
    expect(sniffImageType(gif87aHeader())).toBe('image/gif');
    expect(sniffImageType(gifHeader())).toBe('image/gif');
    expect(sniffImageType(webpBytes())).toBe('image/webp');
  });

  it('refuses the files that are not images, whatever they are named', () => {
    // A PDF with a `.png` name — the fixture's contents say PDF, and that is what decides.
    expect(sniffImageType(headOf('disguised-pdf.png'))).toBeNull();
    expect(sniffImageType(pdfBytes())).toBeNull();
    // An SVG is a document that can carry a script; the suffix is not the question.
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')))
      .toBeNull();
    expect(sniffImageType(headOf('svg-with-script.svg'))).toBeNull();
    // An SVG behind an XML declaration and leading whitespace, which is how exporters write it.
    expect(
      sniffImageType(
        new TextEncoder().encode('\n  <?xml version="1.0"?>\n  <svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBeNull();
    // A file with nothing in it.
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('refuses a file that starts like a PNG and stops being one', () => {
    // TC-01's corrupt PNG: the signature is there, the first chunk header is not. Refusing
    // it here is cheap; storing it would spend a board's R2 on bytes nothing can decode.
    expect(sniffImageType(truncatedPngBytes())).toBeNull();
  });

  it('ignores a file type the request claimed rather than the bytes it contains', () => {
    // The claim `image/png` on a PDF is what an upload form sends for that file, and the
    // sniffer never sees it: this is the whole of `image.types.security`.
    expect(sniffImageType(pdfBytes())).toBeNull();
    // And the accepted kinds are exactly the ones the config lists, in MIME form.
    expect([...IMAGE_ACCEPTED_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  });
});

describe('asset keys (TC-14)', () => {
  it('builds a key of board id, slash, asset id', () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    expect(assetKeyFor(boardId, assetId)).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, assetId))).toBe(true);
  });

  it('will not build a key out of ids that are not ids', () => {
    expect(() => assetKeyFor('../..', 'x')).toThrow();
    expect(() => assetKeyFor(newBoardId(), '../../etc')).toThrow();
    expect(() => assetKeyFor(newBoardId(), 'has space')).toThrow();
    expect(() => assetKeyFor('', '')).toThrow();
  });

  it('rejects every key with more than one segment or a dot in it', () => {
    const id = newBoardId();
    expect(ASSET_KEY_PATTERN.test(`${id}/${id}`)).toBe(true);
    expect(ASSET_KEY_PATTERN.test('../x')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/../x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`../../x`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/${id}/extra`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/.`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${id}/..`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test('')).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${id}/${id}`)).toBe(false);
  });
});
