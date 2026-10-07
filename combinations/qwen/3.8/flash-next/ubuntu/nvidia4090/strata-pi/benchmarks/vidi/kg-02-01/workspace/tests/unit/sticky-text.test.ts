import * as Y from "yjs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from "../../src/client/objects/StickyText";
import { LOCAL_ORIGIN } from "../../src/shared/board-model";
import { PROSE_1000, PROSE_1200, SHORT_TEXT } from "../fixtures/texts";

/**
 * Unit tests for the pure parts of sticky.text: `clampToLimit`,
 * `applyTextDiff` and `counterVisible` run against a real `Y.Text`, plus
 * `fitFontSize` against a simulated measuring element (real font layout is
 * verified in e2e TC-33, which jsdom cannot do).
 */

type Op = Y.YTextEvent["delta"][number];

interface TextHarness {
  doc: Y.Doc;
  text: Y.Text;
  /** Every delta the text observed, flattened to Yjs Delta ops. */
  ops: () => Op[];
  updates: () => number;
}

let h: TextHarness;
let deltas: Op[][] = [];

beforeEach(() => {
  const doc = new Y.Doc();
  const text = doc.getText("note");

  const recorded: Op[][] = [];
  deltas = recorded;
  text.observe((event) => {
    recorded.push(event.delta);
  });

  let updates = 0;
  doc.on("update", () => {
    updates += 1;
  });

  h = {
    doc,
    text,
    ops: () => deltas.flat(),
    updates: () => updates,
  };
});

/** Set the "before" text; the seed's own delta is not part of a test. */
function seed(value: string): void {
  h.text.insert(0, value);
  deltas.length = 0;
}

function deletes(ops: Op[]): number {
  return ops.filter((op) => typeof op.delete === "number").length;
}

/** Lone surrogate halves, which would corrupt the text for good. */
function loneSurrogates(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

// ---- TC-13: minimal diff shape --------------------------------------------

describe("applyTextDiff (TC-13)", () => {
  it("inserts a single character in the middle with one insert op", () => {
    seed("abc");
    const updatesBefore = h.updates();

    applyTextDiff(h.text, "abXc", LOCAL_ORIGIN);

    expect(h.text.toString()).toBe("abXc");
    expect(h.ops()).toEqual([{ retain: 2 }, { insert: "X" }]);
    expect(deletes(h.ops())).toBe(0);
    expect(h.updates() - updatesBefore).toBe(1);
  });

  it("deletes a run in the middle with one delete op", () => {
    seed("abcdef");
    applyTextDiff(h.text, "abef", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("abef");
    expect(h.ops()).toEqual([{ retain: 2 }, { delete: 2 }]);
  });

  it("replaces a selection with one delete and one insert", () => {
    seed("abc");
    applyTextDiff(h.text, "aXc", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("aXc");
    expect(h.ops()).toEqual([{ retain: 1 }, { delete: 1 }, { insert: "X" }]);
  });

  it("appends without touching the existing text", () => {
    seed("abc");
    applyTextDiff(h.text, "abcde", LOCAL_ORIGIN);
    expect(h.ops()).toEqual([{ retain: 3 }, { insert: "de" }]);
  });

  it("prepends without touching the existing text", () => {
    seed("abc");
    applyTextDiff(h.text, "xabc", LOCAL_ORIGIN);
    expect(h.ops()).toEqual([{ insert: "x" }]);
  });

  it("writes nothing when the text has not changed", () => {
    seed("abc");
    const updatesBefore = h.updates();
    applyTextDiff(h.text, "abc", LOCAL_ORIGIN);
    expect(h.ops()).toEqual([]);
    expect(h.updates() - updatesBefore).toBe(0);
    expect(h.text.toString()).toBe("abc");
  });

  it("keeps multi-line text intact", () => {
    seed("line one\nline two");
    applyTextDiff(h.text, "line one\nline two\nline three", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("line one\nline two\nline three");
    expect(deletes(h.ops())).toBe(0);
  });

  it("does not split emoji surrogate pairs (insert)", () => {
    seed("ship the 🚀 launch plan");
    applyTextDiff(h.text, "ship the 🚀 X launch plan", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("ship the 🚀 X launch plan");
    expect(deletes(h.ops())).toBe(0);
    expect(h.ops().filter((op) => op.insert !== undefined)).toHaveLength(1);
  });

  it("does not split emoji surrogate pairs (delete one of two)", () => {
    seed("😀😀");
    applyTextDiff(h.text, "😀", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("😀");
    expect(loneSurrogates(h.text.toString())).toBe(false);
  });

  it("does not split emoji surrogate pairs (delete an emoji in place)", () => {
    seed("x😀y");
    applyTextDiff(h.text, "xy", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("xy");
    expect(loneSurrogates(h.text.toString())).toBe(false);
  });

  it("does not split emoji surrogate pairs (replace one emoji with another)", () => {
    seed("a😀b");
    applyTextDiff(h.text, "a😁b", LOCAL_ORIGIN);
    expect(h.text.toString()).toBe("a😁b");
    expect(loneSurrogates(h.text.toString())).toBe(false);
  });

  it("tags the transaction with the caller's origin", () => {
    seed("abc");
    const origins: unknown[] = [];
    h.doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    applyTextDiff(h.text, "abcd", "remote-provider");
    expect(origins).toEqual(["remote-provider"]);
  });

  it("diffing a long note stays minimal (appending to 999 chars)", () => {
    seed(PROSE_1000.slice(0, 999));
    applyTextDiff(h.text, PROSE_1000, LOCAL_ORIGIN);
    expect(h.text.toString()).toBe(PROSE_1000);
    expect(h.text.length).toBe(1000);
    expect(deletes(h.ops())).toBe(0);
    expect(h.ops()).toHaveLength(2);
  });
});

// ---- TC-14 to TC-16: length limit -----------------------------------------

describe("clampToLimit (TC-14, TC-15, TC-16)", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000", () => {
    expect(PROSE_1200.length).toBe(1200);
    const clamped = clampToLimit(PROSE_1200);

    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it("TC-14: the clamp reaches the document through applyTextDiff", () => {
    const updatesBefore = h.updates();
    const clamped = clampToLimit(PROSE_1200);
    applyTextDiff(h.text, clamped, LOCAL_ORIGIN);
    expect(h.text.toString()).toBe(clamped);
    expect(h.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(h.updates() - updatesBefore).toBe(1);
  });

  it("TC-14: an explicit max argument is honoured", () => {
    expect(clampToLimit("abcdef", 3)).toBe("abc");
  });

  it("TC-15: 999 characters plus one is accepted (boundary)", () => {
    const base = PROSE_1000.slice(0, 999);
    expect(base.length).toBe(999);
    const next = clampToLimit(`${base}z`);
    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);

    applyTextDiff(h.text, next, LOCAL_ORIGIN);
    expect(h.text.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it("TC-16: 1,000 characters plus one is rejected (boundary)", () => {
    seed(PROSE_1000);
    const over = `${PROSE_1000}z`;
    expect(over.length).toBe(STICKY_TEXT_MAX_CHARS + 1);

    const clamped = clampToLimit(over);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);

    applyTextDiff(h.text, clamped, LOCAL_ORIGIN);
    expect(h.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(h.text.toString()).toBe(PROSE_1000);
  });

  it("text at or under the limit is unchanged", () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit("")).toBe("");
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it("clamp length counts characters, not bytes or code points split", () => {
    const emoji = "😀".repeat(600); // 1,200 UTF-16 units
    expect(emoji.length).toBe(1200);
    expect(clampToLimit(emoji).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(loneSurrogates(clampToLimit(emoji))).toBe(false);
  });
});

// ---- TC-17: counter visibility --------------------------------------------

describe("counterVisible (TC-17)", () => {
  it("appears only when 50 characters or fewer remain", () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it("is false for short text and true at the limit", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it("boundary around zero length is false", () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true);
  });
});

// ---- fitFontSize (binary search; real layout is e2e TC-33) -----------------

describe("fitFontSize", () => {
  /**
   * A measuring element stand-in: `scrollHeight` is computed from the font
   * size the implementation wrote into `style.fontSize`, using a simple text
   * metric (word lengths, 1.5 line height). It exercises the search and the
   * overflow flag; real glyph metrics are covered by the e2e test.
   */
  function measuringEl(characters: number, boxWidth: number): HTMLElement {
    const style = { fontSize: "" };
    const el = {
      style,
      get scrollHeight(): number {
        const fontPx = Number(String(style.fontSize).replace("px", "")) || 0;
        const lines = Math.ceil((characters * 0.5 * fontPx) / boxWidth);
        return Math.max(1, lines) * fontPx * 1.5;
      },
    };
    return el as unknown as HTMLElement;
  }

  it("uses the maximum font size when the text fits (short note)", () => {
    const box = 200;
    const result = fitFontSize(measuringEl(SHORT_TEXT.length, box), box);
    expect(result.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(result.overflow).toBe(false);
  });

  it("shrinks to the largest size that still fits", () => {
    const box = 200;
    const characters = 200;
    const result = fitFontSize(measuringEl(characters, box), box);

    const fits = (fontPx: number) => {
      const lines = Math.max(1, Math.ceil((characters * 0.5 * fontPx) / box));
      return lines * fontPx * 1.5 <= box;
    };
    let expected = STICKY_FONT_MIN_PX;
    for (let fontPx = STICKY_FONT_MAX_PX; fontPx >= STICKY_FONT_MIN_PX; fontPx -= 1) {
      if (fits(fontPx)) {
        expected = fontPx;
        break;
      }
    }

    expect(result.overflow).toBe(false);
    expect(result.fontPx).toBe(expected);
    expect(result.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(result.fontPx).toBeGreaterThan(STICKY_FONT_MIN_PX);
  });

  it("returns the minimum size with overflow when nothing fits", () => {
    const box = 200;
    const result = fitFontSize(measuringEl(PROSE_1000.length, box), box);
    expect(result.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(result.overflow).toBe(true);
  });

  it("stays inside the configured font range", () => {
    for (const characters of [0, 1, 10, 60, 120, 400, 1000]) {
      const result = fitFontSize(measuringEl(characters, 200), 200);
      expect(result.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(result.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
      expect(Number.isInteger(result.fontPx)).toBe(true);
    }
  });
});
