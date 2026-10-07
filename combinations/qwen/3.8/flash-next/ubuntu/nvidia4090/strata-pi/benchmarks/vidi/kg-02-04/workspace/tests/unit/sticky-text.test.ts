import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
} from "../../src/shared/board-model";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from "../../src/client/objects/StickyText";
import {
  MULTILINE_RETRO_TEXT,
  OVER_LIMIT_1001,
  PASTE_1200,
  PROSE_1000,
  SHORT_NOTE_TEXT,
} from "../fixtures/texts";

/**
 * Unit tests for the pure text logic of sticky notes (sticky.text).
 *
 * A *real* Y.Text in a *real* Y.Doc: the minimal-diff requirement is about the
 * operations Yjs records, so the store cannot be mocked.
 */

interface DeltaOp {
  retain?: number;
  insert?: string;
  delete?: number;
}

interface TextCase {
  doc: Y.Doc;
  ytext: Y.Text;
  /** The delta Yjs recorded for each observed change. */
  deltas: DeltaOp[][];
  updateCount(): number;
  act<T>(fn: () => T): { result: T; updates: number };
}

function textCase(initial = ""): TextCase {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (!id) throw new Error("createSticky rejected its point");
  const ytext = getStickyText(doc, id);
  if (!(ytext instanceof Y.Text)) throw new Error("note has no Y.Text");

  if (initial.length > 0) {
    doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);
  }

  const deltas: DeltaOp[][] = [];
  ytext.observe((event) => {
    deltas.push(
      event.changes.delta.map((op) => op as unknown as DeltaOp),
    );
  });

  let updates = 0;
  doc.on("update", () => {
    updates += 1;
  });

  return {
    doc,
    ytext,
    deltas,
    updateCount: () => updates,
    act<T>(fn: () => T) {
      const before = updates;
      const result = fn();
      return { result, updates: updates - before };
    },
  };
}

function insertedLength(ops: DeltaOp[]): number {
  return ops.reduce((total, op) => total + (op.insert?.length ?? 0), 0);
}

function deletedLength(ops: DeltaOp[]): number {
  return ops.reduce((total, op) => total + (op.delete ?? 0), 0);
}

function retainedBefore(ops: DeltaOp[]): number {
  let retain = 0;
  for (const op of ops) {
    if (op.retain === undefined) break;
    retain += op.retain;
  }
  return retain;
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("sticky.text: fixtures", () => {
  it("the prose fixture is exactly the text limit and the paste fixture overshoots it", () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    expect(PROSE_1000.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(PASTE_1200.length).toBe(1200);
    expect(PASTE_1200.startsWith(PROSE_1000)).toBe(true);
    expect(OVER_LIMIT_1001.length).toBe(STICKY_TEXT_MAX_CHARS + 1);
    expect(MULTILINE_RETRO_TEXT.split("\n").length).toBe(3);
    expect(SHORT_NOTE_TEXT).toBe("Faster onboarding");
  });
});

describe("sticky.text: minimal diff", () => {
  it("TC-13: 'abc' -> 'abXc' is a single insert of 'X' at index 2, not a rewrite", () => {
    const t = textCase("abc");

    const { updates } = t.act(() => applyTextDiff(t.ytext, "abXc", LOCAL_ORIGIN));

    expect(t.ytext.toString()).toBe("abXc");
    expect(updates).toBe(1);
    expect(t.deltas.length).toBe(1);
    const ops = t.deltas[0]!;
    expect(ops).toEqual([{ retain: 2 }, { insert: "X" }]);
    expect(retainedBefore(ops)).toBe(2);
    expect(deletedLength(ops)).toBe(0);
    expect(insertedLength(ops)).toBe(1);
  });

  it("TC-13: a middle deletion is a single delete inside a long note (story 3 typing survives)", () => {
    const t = textCase(PROSE_1000);

    const next = `${PROSE_1000.slice(0, 400)}${PROSE_1000.slice(401)}`;
    t.act(() => applyTextDiff(t.ytext, next, LOCAL_ORIGIN));

    expect(t.ytext.toString()).toBe(next);
    expect(t.deltas.length).toBe(1);
    const ops = t.deltas[0]!;
    expect(deletedLength(ops)).toBe(1);
    expect(insertedLength(ops)).toBe(0);
    expect(retainedBefore(ops)).toBe(400);
  });

  it("TC-13: inserting into the middle of a 1,000 character note never rewrites it", () => {
    const t = textCase(PROSE_1000);

    const next = `${PROSE_1000.slice(0, 500)}X${PROSE_1000.slice(500)}`;
    t.act(() => applyTextDiff(t.ytext, next, LOCAL_ORIGIN));

    expect(t.ytext.toString()).toBe(next);
    const ops = t.deltas[0]!;
    expect(deletedLength(ops)).toBe(0);
    expect(insertedLength(ops)).toBe(1);
    expect(retainedBefore(ops)).toBe(500);
  });

  it("TC-13: replacing a selection is one delete plus one insert", () => {
    const t = textCase(SHORT_NOTE_TEXT);

    t.act(() => applyTextDiff(t.ytext, "Faster offboarding", LOCAL_ORIGIN));

    expect(t.ytext.toString()).toBe("Faster offboarding");
    const ops = t.deltas[0]!;
    expect(deletedLength(ops)).toBe(1);
    expect(insertedLength(ops)).toBe(2);
    expect(retainedBefore(ops)).toBe(8);
  });

  it("TC-13: multi-line text is diffed like any other text", () => {
    const t = textCase(MULTILINE_RETRO_TEXT);

    const next = `${MULTILINE_RETRO_TEXT}\nPlus one more thing to try.`;
    t.act(() => applyTextDiff(t.ytext, next, LOCAL_ORIGIN));

    expect(t.ytext.toString()).toBe(next);
    const ops = t.deltas[0]!;
    expect(deletedLength(ops)).toBe(0);
    expect(insertedLength(ops)).toBe("\nPlus one more thing to try.".length);
  });

  it("TC-13: surrogate pairs (emoji) stay intact at both ends of the change", () => {
    const emoji = "\u{1F600}"; // grinning face
    const t = textCase(`Ship it ${emoji} now`);

    t.act(() => applyTextDiff(t.ytext, "Ship it  now", LOCAL_ORIGIN));
    expect(t.ytext.toString()).toBe("Ship it  now");
    expect(deletedLength(t.deltas[0]!)).toBe(2); // the whole pair, never half
    expect(hasLoneSurrogate(t.ytext.toString())).toBe(false);

    // Replacing one emoji with another also moves whole pairs.
    const other = textCase(`${emoji}z`);
    other.act(() => applyTextDiff(other.ytext, "\u{1F601}z", LOCAL_ORIGIN));
    expect(other.ytext.toString()).toBe("\u{1F601}z");
    expect(hasLoneSurrogate(other.ytext.toString())).toBe(false);
    expect(deletedLength(other.deltas[0]!)).toBe(2);
    expect(insertedLength(other.deltas[0]!)).toBe(2);

    // Appending an emoji is an insert only.
    const appended = textCase("note");
    appended.act(() => applyTextDiff(appended.ytext, `note${emoji}`, LOCAL_ORIGIN));
    expect(appended.ytext.toString()).toBe(`note${emoji}`);
    expect(deletedLength(appended.deltas[0]!)).toBe(0);
    expect(hasLoneSurrogate(appended.ytext.toString())).toBe(false);
  });

  it("TC-13: unchanged text writes nothing at all", () => {
    const t = textCase(SHORT_NOTE_TEXT);

    const { updates } = t.act(() => applyTextDiff(t.ytext, SHORT_NOTE_TEXT, LOCAL_ORIGIN));

    expect(updates).toBe(0);
    expect(t.deltas.length).toBe(0);
    expect(t.ytext.toString()).toBe(SHORT_NOTE_TEXT);
  });

  it("deleting everything and typing from scratch are single operations", () => {
    const t = textCase(SHORT_NOTE_TEXT);
    t.act(() => applyTextDiff(t.ytext, "", LOCAL_ORIGIN));
    expect(t.ytext.toString()).toBe("");
    expect(deletedLength(t.deltas[0]!)).toBe(SHORT_NOTE_TEXT.length);

    t.act(() => applyTextDiff(t.ytext, "New idea", LOCAL_ORIGIN));
    expect(t.ytext.toString()).toBe("New idea");
    expect(deletedLength(t.deltas[1]!)).toBe(0);
    expect(insertedLength(t.deltas[1]!)).toBe(8);
  });
});

describe("sticky.text: length limit", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000 characters", () => {
    const clamped = clampToLimit(PASTE_1200);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);

    const t = textCase("");
    t.act(() => applyTextDiff(t.ytext, clamped, LOCAL_ORIGIN));
    expect(t.ytext.toString()).toBe(PROSE_1000);
  });

  it("TC-15: at 999 characters one more character is accepted (boundary)", () => {
    const almostThere = PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    const t = textCase(almostThere);
    const next = clampToLimit(`${almostThere}k`);

    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
    t.act(() => applyTextDiff(t.ytext, next, LOCAL_ORIGIN));
    expect(t.ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(t.ytext.toString()).toBe(`${almostThere}k`);
  });

  it("TC-16: at exactly 1,000 characters a further character is refused (boundary)", () => {
    const t = textCase(PROSE_1000);
    const next = clampToLimit(OVER_LIMIT_1001);

    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(PROSE_1000);
    const { updates } = t.act(() => applyTextDiff(t.ytext, next, LOCAL_ORIGIN));
    expect(updates).toBe(0);
    expect(t.ytext.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(t.ytext.toString()).toBe(PROSE_1000);
  });

  it("the limit applies to the whole value, not to a single keystroke", () => {
    // 999 characters, then a 500 character paste: only the 1 allowed character
    // of headroom is kept.
    const short = PROSE_1000.slice(0, 999);
    const clamped = clampToLimit(`${short}${PASTE_1200}`);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped.startsWith(short)).toBe(true);
  });

  it("clampToLimit honours an explicit maximum and never cuts a surrogate pair", () => {
    expect(clampToLimit("abcdef", 3)).toBe("abc");
    expect(clampToLimit("abc", 10)).toBe("abc");
    expect(clampToLimit("", 10)).toBe("");

    const withEmoji = `${"x".repeat(999)}\u{1F600}`; // 1,001 code units
    const clamped = clampToLimit(withEmoji);
    expect(clamped.length).toBe(999);
    expect(hasLoneSurrogate(clamped)).toBe(false);
  });
});

describe("sticky.text: counter visibility", () => {
  it("TC-17: the counter appears when 50 or fewer characters remain", () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
  });

  it("TC-17: no counter for short notes, counter at the limit", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1)).toBe(false);
    expect(counterVisible(900)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    // Over-long text (e.g. restored from an older schema) still reports.
    expect(counterVisible(STICKY_TEXT_MAX_CHARS + 5)).toBe(true);
  });
});

describe("sticky.text: font fit", () => {
  /**
   * jsdom has no text layout, so the element is replaced by one whose
   * `scrollHeight` follows the font size that was just measured — which is
   * exactly what `fitFontSize` does with a real element.
   */
  function measuredEl(heightFor: (fontPx: number) => number): HTMLElement {
    const el = {
      style: {} as Record<string, string>,
      get scrollHeight(): number {
        const size = Number((el.style.fontSize ?? "").replace("px", ""));
        return heightFor(size);
      },
    };
    return el as unknown as HTMLElement;
  }

  const BOX = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

  it("short text keeps the maximum font size and measures once", () => {
    let measurements = 0;
    const el = measuredEl(() => {
      measurements += 1;
      return 30; // one line
    });

    const fit = fitFontSize(el, BOX);
    expect(fit.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect(fit.overflow).toBe(false);
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
    expect(measurements).toBe(1);
  });

  it("the largest size that fits is chosen", () => {
    // Height grows with the font: 8 lines' worth, so 21 px fits 168 and 22 px does not.
    const el = measuredEl((size) => size * 8);
    const fit = fitFontSize(el, BOX);
    expect(fit.fontPx).toBe(21);
    expect(fit.overflow).toBe(false);
    expect(el.style.fontSize).toBe("21px");
  });

  it("text that never fits stays at the minimum size and reports overflow", () => {
    const el = measuredEl((size) => size * 20);
    const fit = fitFontSize(el, BOX);
    expect(fit.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(fit.overflow).toBe(true);
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MIN_PX}px`);
  });

  it("an empty note fits, and a degenerate box reports overflow instead of crashing", () => {
    expect(fitFontSize(measuredEl(() => 0), BOX)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });

    const overflow = fitFontSize(measuredEl(() => 40), 0);
    expect(overflow.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(overflow.overflow).toBe(true);

    const nan = fitFontSize(measuredEl(() => 40), Number.NaN);
    expect(nan.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(nan.overflow).toBe(true);
  });

  it("the chosen size is always inside [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]", () => {
    for (const requiredHeight of [0, 5, 60, 100, 120, 167, 168, 169, 300, 10_000]) {
      const fit = fitFontSize(measuredEl(() => requiredHeight), BOX);
      expect(fit.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
      expect(fit.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
      expect(fit.overflow).toBe(requiredHeight > BOX);
    }
  });
});
