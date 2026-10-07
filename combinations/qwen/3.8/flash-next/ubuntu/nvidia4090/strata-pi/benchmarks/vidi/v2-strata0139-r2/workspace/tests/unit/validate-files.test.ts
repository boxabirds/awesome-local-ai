/**
 * Story 12 — the browser's own file check (`image.types`, `image.size_limit`,
 * `image.count_limit`), the half of `image.insert` that runs before a byte is sent.
 *
 * Run first: `npm run test:unit -- validate-files`
 *
 * `validateFiles` filters on what the browser *says* the file is, because that is
 * what a drop or a picker actually reports; the decision about content is
 * `sniffImageType`'s (see `image-format.test.ts`) and, on the client, the decode
 * in `useImageInsert` (TC-29).
 */

import { describe, expect, it } from "vitest";
import { IMAGE_MAX_BYTES } from "../../src/shared/config";
import { REJECTION_MESSAGES, rejectionMessages, validateFiles } from "../../src/client/images/validateFiles";
import { ascii, gifBytes, jpegBytes, pdfBytes, pngBytes, webpBytes } from "../fixtures/image-bytes";

/** A `File` the way a browser hands one over. */
function fileOf(name: string, type: string, bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], name, { type });
}

describe("validateFiles: size (TC-08)", () => {
  const png = () => pngBytes(4, 4);

  it("refuses a file one byte over the limit, and accepts one at exactly it", () => {
    const over = fileOf("big.png", "image/png", new Uint8Array(IMAGE_MAX_BYTES + 1));
    const exact = fileOf("exact.png", "image/png", new Uint8Array(IMAGE_MAX_BYTES));

    const overOnly = validateFiles([over]);
    expect(overOnly.accepted).toHaveLength(0);
    expect(overOnly.rejections.has("size")).toBe(true);
    expect(rejectionMessages(overOnly)).toEqual([REJECTION_MESSAGES.size]);

    const exactOnly = validateFiles([exact]);
    expect(exactOnly.accepted).toHaveLength(1);
    expect(exactOnly.rejections.size).toBe(0);
  });

  it("refuses the oversized file and keeps the ones that fit", () => {
    const over = fileOf("huge.png", "image/png", new Uint8Array(IMAGE_MAX_BYTES + 1));
    const fits = fileOf("photo.png", "image/png", png());

    const result = validateFiles([over, fits]);
    expect(result.accepted).toEqual([fits]);
    expect(result.rejections.has("size")).toBe(true);
    expect(result.rejections.size).toBe(1);
  });
});

describe("validateFiles: count and type (TC-09)", () => {
  const png = () => pngBytes(4, 4);

  it("keeps the first 20 supported files and reports the limit once", () => {
    const files = Array.from({ length: 21 }, (unused, index) => fileOf(`image-${index}.png`, "image/png", png()));
    const result = validateFiles(files);

    expect(result.accepted).toHaveLength(20);
    expect(result.accepted[0]).toBe(files[0]);
    expect(result.accepted[19]).toBe(files[19]);
    expect(result.rejections.has("count")).toBe(true);
    expect(result.rejections.size).toBe(1);
    expect(rejectionMessages(result)).toEqual(["Only 20 images can be added at once."]);
  });

  it("counts only the supported files, so junk in the batch does not eat the limit", () => {
    const junk = Array.from({ length: 5 }, (unused, index) => fileOf(`report-${index}.png`, "application/pdf", pdfBytes()));
    const images = Array.from({ length: 21 }, (unused, index) => fileOf(`image-${index}.png`, "image/png", png()));

    const result = validateFiles([...junk, ...images]);
    expect(result.accepted).toHaveLength(20);
    // Too many supported files *and* files of the wrong kind: two separate things
    // to say, and the junk did not use up any of the 20.
    expect(rejectionMessages(result)).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.count]);
  });

  it("refuses a PDF named .png and still accepts the PNG of the same drop", () => {
    const sneaky = fileOf("report.png", "application/pdf", pdfBytes());
    const video = fileOf("clip.png", "video/mp4", ascii("ftypisom"));
    const good = fileOf("photo.png", "image/png", png());

    const result = validateFiles([sneaky, video, good]);
    expect(result.accepted).toEqual([good]);
    expect(result.rejections.has("type")).toBe(true);
    expect(result.rejections.size).toBe(1);
    expect(rejectionMessages(result)).toEqual(["Only PNG, JPEG, GIF and WebP images can be added."]);
  });

  it("accepts each of the four types", () => {
    const result = validateFiles([
      fileOf("a.png", "image/png", png()),
      fileOf("b.jpg", "image/jpeg", jpegBytes()),
      fileOf("c.gif", "image/gif", gifBytes()),
      fileOf("d.webp", "image/webp", webpBytes()),
    ]);
    expect(result.accepted).toHaveLength(4);
    expect(result.rejections.size).toBe(0);
  });

  it("reports one message per rule, in a stable order", () => {
    const result = validateFiles([
      fileOf("photo.pdf", "application/pdf", pdfBytes()),
      fileOf("huge.png", "image/png", new Uint8Array(IMAGE_MAX_BYTES + 1)),
      ...Array.from({ length: 21 }, (unused, index) => fileOf(`${index}.png`, "image/png", png())),
    ]);

    expect(result.accepted).toHaveLength(20);
    expect(rejectionMessages(result)).toEqual([
      REJECTION_MESSAGES.type,
      REJECTION_MESSAGES.size,
      REJECTION_MESSAGES.count,
    ]);
  });

  it("says nothing about an empty batch", () => {
    const result = validateFiles([]);
    expect(result.accepted).toHaveLength(0);
    expect(rejectionMessages(result)).toEqual([]);
  });
});
