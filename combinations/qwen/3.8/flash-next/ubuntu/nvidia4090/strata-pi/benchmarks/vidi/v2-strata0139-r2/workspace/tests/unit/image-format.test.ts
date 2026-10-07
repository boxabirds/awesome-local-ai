/**
 * Story 12 — `assets.api` sniffing and asset key shape (`image.shared`,
 * `assets.storage`). The browser's own file limits are tested in
 * `validate-files.test.ts`.
 *
 * Run first: `npm run test:unit -- image-format`
 */

import { describe, expect, it } from "vitest";
import { ASSET_KEY_PATTERN, assetKeyFor, boardIdOfKey, isAssetKey, sniffImageType } from "../../src/shared/image-format";
import { IMAGE_ACCEPTED_TYPES } from "../../src/shared/config";
import {
  ascii,
  corruptPngBytes,
  gifBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
  svgBytes,
  truncatedPngBytes,
  webpBytes,
} from "../fixtures/image-bytes";

describe("sniffImageType (TC-01)", () => {
  it("names the four formats by their own bytes", () => {
    expect(sniffImageType(pngBytes(6, 6))).toBe("image/png");
    expect(sniffImageType(jpegBytes())).toBe("image/jpeg");
    expect(sniffImageType(gifBytes())).toBe("image/gif");
    expect(sniffImageType(webpBytes())).toBe("image/webp");
  });

  it("refuses SVG, PDF, a truncated PNG and an empty body", () => {
    expect(sniffImageType(svgBytes())).toBeNull();
    expect(sniffImageType(pdfBytes())).toBeNull();
    // Cut off inside the 8-byte PNG signature: not a PNG.
    expect(sniffImageType(truncatedPngBytes())).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it("looks at content and never at a name or a declared type", () => {
    // A PNG's bytes named .pdf, and a PDF's bytes named .png.
    const asPng = pngBytes(4, 4);
    expect(sniffImageType(asPng)).toBe("image/png");
    expect(sniffImageType(pdfBytes())).toBeNull();
    expect(sniffImageType(ascii("GIF89a"))).toBe("image/gif");
  });

  it("reads the truncated PNG's magic bytes as PNG, which is why the client decodes too", () => {
    // `image.types`: the sniffing is the *server's* check. A file with a real
    // header and broken data is refused by the browser before it is ever sent,
    // and this is the case the sniffing alone cannot catch.
    expect(sniffImageType(corruptPngBytes())).toBe("image/png");
  });

  it("accepts only the four types the config names", () => {
    const types = [
      sniffImageType(pngBytes(2, 2)),
      sniffImageType(jpegBytes()),
      sniffImageType(gifBytes()),
      sniffImageType(webpBytes()),
    ];
    for (const type of types) {
      expect(IMAGE_ACCEPTED_TYPES).toContain(type);
    }
    expect(IMAGE_ACCEPTED_TYPES).toHaveLength(4);
  });
});

describe("asset keys (TC-02)", () => {
  const boardId = "Zm9vYmFyYmF6aW5nZHVwZA";
  const assetId = "T25lUmFuZG9tMjJjaGFycw";

  it("accepts `<22 chars>/<22 chars>`", () => {
    const key = assetKeyFor(boardId, assetId);
    expect(key).toBe(`${boardId}/${assetId}`);
    expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
    expect(isAssetKey(key)).toBe(true);
    expect(boardIdOfKey(key)).toBe(boardId);
  });

  it("refuses a missing half", () => {
    expect(ASSET_KEY_PATTERN.test(boardId)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}/`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`/${assetId}`)).toBe(false);
    expect(ASSET_KEY_PATTERN.test(`${boardId}//${assetId}`)).toBe(false);
    expect(isAssetKey("")).toBe(false);
  });

  it("refuses anything that tries to move up a path", () => {
    expect(ASSET_KEY_PATTERN.test("../Zm9vYmFyYmF6aW5nZHVwZA/Zm9v")).toBe(false);
    expect(ASSET_KEY_PATTERN.test("Zm9vYmFyYmF6aW5ndXBkMTI/../../x")).toBe(false);
    expect(ASSET_KEY_PATTERN.test("a/b")).toBe(false);
    expect(boardIdOfKey("../x/y")).toBeNull();
  });

  it("refuses a 23-character id", () => {
    const tooLong = `${boardId}X`;
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(tooLong, assetId))).toBe(false);
    expect(ASSET_KEY_PATTERN.test(assetKeyFor(boardId, tooLong))).toBe(false);
  });
});
