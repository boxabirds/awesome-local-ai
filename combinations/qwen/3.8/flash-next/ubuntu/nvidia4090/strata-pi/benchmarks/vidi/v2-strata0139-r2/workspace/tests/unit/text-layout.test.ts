import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  type TextSize,
} from "../../src/shared/config";
import {
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  type Measurer,
} from "../../src/client/objects/textLayout";

/**
 * Unit tests for text layout (`text.layout`, `text.wrap`, `text.height`) with a
 * **fake measurer**, so the arithmetic is checked without a browser.
 *
 * TC-07 to TC-11 and TC-32. The fake measurer is `characters x font size x
 * 0.5`, which makes every expected number below derivable by hand. The real
 * measurer and real wrapping are covered by the e2e test (TC-26, TC-27).
 */

/** 10 board units per character at size M, 14 at size XL, and so on. */
function fakeMeasurer(): { measure: Measurer; calls: { text: string; fontPx: number }[] } {
  const calls: { text: string; fontPx: number }[] = [];
  const measure: Measurer = (text, fontPx) => {
    calls.push({ text, fontPx });
    return text.length * fontPx * 0.5;
  };
  return { measure, calls };
}

function layout(
  text: string,
  size: TextSize,
  widthMode: "auto" | "fixed",
  width?: number,
): ReturnType<typeof layoutText> {
  return layoutText({ text, size, widthMode, width }, fakeMeasurer().measure);
}

describe("text.layout: an automatic box fits its longest line", () => {
  it("TC-07 widens to the measured line plus padding, height is one line box", () => {
    const { measure, calls } = fakeMeasurer();
    const result = layoutText({ text: "Went well", size: "M", widthMode: "auto" }, measure);
    const fontPx = TEXT_SIZES.M;

    expect(calls.length).toBeGreaterThan(0);
    // The measurer is always called with the size's own font size.
    expect(new Set(calls.map((call) => call.fontPx))).toEqual(new Set([fontPx]));

    expect(result.lines).toBe(1);
    expect(result.width).toBe("Went well".length * fontPx * 0.5 + TEXT_PADDING_WORLD);
    expect(result.height).toBe(1 * fontPx * TEXT_LINE_HEIGHT);
  });

  it("TC-08 wraps at TEXT_MAX_AUTO_WIDTH_WORLD instead of stretching further", () => {
    const line = Array.from({ length: 20 }, () => "abcde").join(" ");
    const result = layout(line, "M", "auto");

    expect(result.lines).toBeGreaterThan(1);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // Height is the line count times the line box, nothing else.
    expect(result.height).toBe(result.lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it("TC-09 a line of exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line", () => {
    const exact = "x".repeat(60); // 60 characters x 10 units = 600 at size M
    const result = layout(exact, "M", "auto");

    expect(result.lines).toBe(1);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it("an empty text still has one line box, so a fresh object has bounds", () => {
    const result = layout("", "M", "auto");
    expect(result.lines).toBe(1);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // Never narrower than the minimum: an empty text object is still clickable.
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });
});

describe("text.wrap: fixed width and explicit line breaks", () => {
  it("TC-10 a fixed width of TEXT_MIN_WIDTH_WORLD puts one long word per line", () => {
    const result = layout("planning review backlog", "M", "fixed", TEXT_MIN_WIDTH_WORLD);

    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toBe(3);
    expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it("a fixed width below the minimum is clamped to it", () => {
    const result = layout("planning review backlog", "M", "fixed", 10);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toBeGreaterThan(1);
  });

  it("TC-11 explicit line breaks always start a new line", () => {
    const result = layout("one\ntwo\n", "M", "auto");
    expect(result.lines).toBe(3); // "one", "two", and the empty line after the last break
    expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    const inside = layout("ship it\nnow", "XL", "fixed", 200);
    expect(inside.lines).toBe(2);
    expect(inside.height).toBe(2 * TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(inside.width).toBe(200);
  });

  it("a word wider than the fixed width takes a line of its own", () => {
    const result = layout("supercalifragilisticexpialidocious ok", "M", "fixed", 40);
    expect(result.lines).toBe(2);
  });
});

describe("text.size: layout uses the size's font size", () => {
  it("each preset measures and heights at its own font size", () => {
    for (const size of Object.keys(TEXT_SIZES) as TextSize[]) {
      const result = layout("Went well", size, "auto");
      expect(result.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      expect(result.width).toBe("Went well".length * TEXT_SIZES[size] * 0.5 + TEXT_PADDING_WORLD);
    }
  });

  it("an unknown size is measured at DEFAULT_TEXT_SIZE rather than NaN", () => {
    const { measure, calls } = fakeMeasurer();
    const result = layoutText(
      { text: "abc", size: "XXL" as TextSize, widthMode: "auto" },
      measure,
    );
    expect(calls.every((call) => call.fontPx === TEXT_SIZES[DEFAULT_TEXT_SIZE])).toBe(true);
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
  });
});

describe("text.measuring: the fallback when there is no canvas", () => {
  it("TC-32 createCanvasMeasurer falls back to a character estimate and never throws", () => {
    const measure = createCanvasMeasurer();
    const width = measure("Went well", TEXT_SIZES[DEFAULT_TEXT_SIZE]);

    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeGreaterThan(0);

    const result = layoutText(
      { text: "Went well", size: DEFAULT_TEXT_SIZE, widthMode: "auto" },
      measure,
    );
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(result.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });

  it("the estimate is the character-count rule the fallback uses", () => {
    expect(estimateTextWidth("abcd", 20)).toBeGreaterThan(estimateTextWidth("abc", 20));
    expect(Number.isFinite(estimateTextWidth("", 20))).toBe(true);
    expect(estimateTextWidth("abcd", Number.NaN)).toBeGreaterThanOrEqual(0);
  });
});
