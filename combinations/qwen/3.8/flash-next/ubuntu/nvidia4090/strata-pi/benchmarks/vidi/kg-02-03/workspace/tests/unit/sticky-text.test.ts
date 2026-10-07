import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from "../../src/client/objects/StickyText";
import {
  LONG_NOTE_TEXT_1000,
  PASTE_TEXT_1200,
  RETRO_ITEM_TEXT,
  SHORT_NOTE_TEXT,
  textOfLength,
} from "../fixtures/texts";

/**
 * Unit tests for the pure parts of sticky.text: TC-13 to TC-17.
 * A real `Y.Text` inside a real `Y.Doc` is observed for its delta ops, because
 * "one minimal change" is exactly what keeps story 3 concurrent typing safe.
 */

interface DeltaOp {
  insert?: string | unknown;
  delete?: number;
  retain?: number;
}

interface Fixture {
  doc: Y.Doc;
  ytext: Y.Text;
  deltas: DeltaOp[][];
  updates: () => number;
}

function fixture(initial = ""): Fixture {
  const doc = new Y.Doc();
  const ytext = doc.getText("note");
  if (initial) ytext.insert(0, initial);

  const deltas: DeltaOp[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as DeltaOp[]);
  });

  let updateCount = 0;
  doc.on("update", () => {
    updateCount += 1;
  });

  return { doc, ytext, deltas, updates: () => updateCount };
}

/** All insert strings in the observed deltas. */
function inserted(deltas: DeltaOp[][]): string[] {
  return deltas
    .flat()
    .filter((op) => typeof op.insert === "string")
    .map((op) => op.insert as string);
}

/** Total characters removed by the observed deltas. */
function deleted(deltas: DeltaOp[][]): number {
  return deltas.flat().reduce((total, op) => total + (op.delete ?? 0), 0);
}

/** Screen index where an insertion happened, derived from the delta ops. */
function insertIndex(ops: DeltaOp[]): number {
  let index = 0;
  for (const op of ops) {
    if (op.retain !== undefined) index += op.retain;
    else if (typeof op.insert === "string") break;
    else if (op.delete !== undefined) break;
  }
  return index;
}

/** True when a string contains a surrogate pair cut in half. */
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

describe("fixtures", () => {
  it("are realistic prose of the exact lengths the tests need", () => {
    expect(LONG_NOTE_TEXT_1000).toHaveLength(1000);
    expect(PASTE_TEXT_1200).toHaveLength(1200);
    expect(PASTE_TEXT_1200.startsWith(LONG_NOTE_TEXT_1000)).toBe(true);
    expect(textOfLength(949)).toHaveLength(949);
    expect(textOfLength(1001)).toHaveLength(1001);
    expect(SHORT_NOTE_TEXT).toBe("Faster onboarding");
    expect(RETRO_ITEM_TEXT.split("\n")).toHaveLength(3);
    expect(RETRO_ITEM_TEXT.length).toBeGreaterThan(100);
    expect(RETRO_ITEM_TEXT.length).toBeLessThan(160);
    // Not a run of repeated single characters.
    expect(new Set(LONG_NOTE_TEXT_1000.split(" ")).size).toBeGreaterThan(40);
  });
});

describe("applyTextDiff", () => {
  it("TC-13: 'abc' -> 'abXc' is one insert of 'X' at index 2, not a rewrite", () => {
    const { ytext, deltas, updates } = fixture("abc");

    applyTextDiff(ytext, "abXc", null);

    expect(ytext.toString()).toBe("abXc");
    expect(deltas).toHaveLength(1);
    const ops = deltas[0];
    expect(ops.filter((op) => typeof op.insert === "string")).toHaveLength(1);
    expect(inserted(deltas)).toEqual(["X"]);
    expect(deleted(deltas)).toBe(0);
    expect(insertIndex(ops)).toBe(2);
    expect(updates()).toBe(1);
  });

  it("TC-13: a deletion in the middle is one delete, not a rewrite", () => {
    const { ytext, deltas, updates } = fixture("abcdef");

    applyTextDiff(ytext, "abcdf", null);

    expect(ytext.toString()).toBe("abcdf");
    expect(deltas).toHaveLength(1);
    const ops = deltas[0];
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(1);
    expect(deleted(deltas)).toBe(1);
    expect(inserted(deltas)).toEqual([]);
    expect(updates()).toBe(1);
  });

  it("TC-13: replacing a selection is one delete plus one insert", () => {
    const { ytext, deltas, updates } = fixture("abcdef");

    applyTextDiff(ytext, "abcXYef", null);

    expect(ytext.toString()).toBe("abcXYef");
    expect(deltas).toHaveLength(1);
    const ops = deltas[0];
    const deleteOps = ops.filter((op) => op.delete !== undefined);
    const insertOps = ops.filter((op) => typeof op.insert === "string");
    expect(deleteOps).toHaveLength(1);
    expect(insertOps).toHaveLength(1);
    expect(deleted(deltas)).toBe(1);
    expect(inserted(deltas)).toEqual(["XY"]);
    expect(updates()).toBe(1);
  });

  it("TC-13: appending and removing at the end touch only the tail", () => {
    const append = fixture(SHORT_NOTE_TEXT);
    applyTextDiff(append.ytext, `${SHORT_NOTE_TEXT} today`, null);
    expect(append.ytext.toString()).toBe(`${SHORT_NOTE_TEXT} today`);
    expect(deleted(append.deltas)).toBe(0);
    expect(inserted(append.deltas)).toEqual([" today"]);

    const remove = fixture(`${SHORT_NOTE_TEXT} today`);
    applyTextDiff(remove.ytext, SHORT_NOTE_TEXT, null);
    expect(remove.ytext.toString()).toBe(SHORT_NOTE_TEXT);
    expect(inserted(remove.deltas)).toEqual([]);
    expect(deleted(remove.deltas)).toBe(6);
  });

  it("TC-13: multi-line note text keeps its line breaks", () => {
    const { ytext, deltas } = fixture(RETRO_ITEM_TEXT);
    const next = RETRO_ITEM_TEXT.replace("Rotate", "Swap");
    applyTextDiff(ytext, next, null);
    expect(ytext.toString()).toBe(next);
    expect(ytext.toString().split("\n")).toHaveLength(3);
    expect(deleted(deltas)).toBe(6);
    expect(inserted(deltas)).toEqual(["Swap"]);
  });

  it("TC-13: emoji surrogate pairs are never cut in half", () => {
    const { ytext, deltas, updates } = fixture("😀😀 planning 🎉");

    // Replace the second emoji: the naive common prefix ends inside a pair.
    applyTextDiff(ytext, "😀😁 planning 🎉", null);

    expect(ytext.toString()).toBe("😀😁 planning 🎉");
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    for (const value of inserted(deltas)) {
      expect(hasLoneSurrogate(value)).toBe(false);
    }
    // Whole code points only: the delete removes the pair, not one code unit.
    expect(deleted(deltas) % 2).toBe(0);
    expect(inserted(deltas)).toEqual(["😁"]);
    expect(updates()).toBe(1);
  });

  it("TC-13: emoji inserted by typing is stored as one insert", () => {
    const { ytext, deltas } = fixture("idea");
    applyTextDiff(ytext, "idea 🎉", null);
    expect(ytext.toString()).toBe("idea 🎉");
    expect(inserted(deltas)).toEqual([" 🎉"]);
    expect(deleted(deltas)).toBe(0);
  });

  it("TC-13: no change writes nothing and emits no update", () => {
    const { ytext, deltas, updates } = fixture(SHORT_NOTE_TEXT);
    applyTextDiff(ytext, SHORT_NOTE_TEXT, null);
    expect(deltas).toHaveLength(0);
    expect(updates()).toBe(0);
    expect(ytext.toString()).toBe(SHORT_NOTE_TEXT);
  });

  it("TC-13: an emptying edit keeps one delete op", () => {
    const { ytext, deltas, updates } = fixture(SHORT_NOTE_TEXT);
    applyTextDiff(ytext, "", null);
    expect(ytext.toString()).toBe("");
    expect(deleted(deltas)).toBe(SHORT_NOTE_TEXT.length);
    expect(updates()).toBe(1);
  });
});

describe("clampToLimit", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000", () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    const clamped = clampToLimit(PASTE_TEXT_1200);
    expect(clamped).toHaveLength(1000);
    expect(clamped).toBe(PASTE_TEXT_1200.slice(0, 1000));

    const { ytext, deltas } = fixture("");
    applyTextDiff(ytext, clamped, null);
    expect(ytext.toString()).toHaveLength(1000);
    expect(deltas).toHaveLength(1);
  });

  it("TC-15: 999 characters plus one is accepted (boundary)", () => {
    const base = textOfLength(999);
    const next = `${base}!`;
    expect(clampToLimit(next)).toHaveLength(1000);

    const { ytext } = fixture(base);
    applyTextDiff(ytext, clampToLimit(next), null);
    expect(ytext.toString()).toHaveLength(1000);
    expect(ytext.toString().endsWith("!")).toBe(true);
  });

  it("TC-16: 1,000 characters plus one is rejected and nothing grows (boundary)", () => {
    const base = textOfLength(1000);
    const clamped = clampToLimit(`${base} extra characters`);
    expect(clamped).toHaveLength(1000);
    expect(clamped).toBe(base);

    const { ytext, deltas, updates } = fixture(base);
    applyTextDiff(ytext, clamped, null);
    expect(ytext.toString()).toBe(base);
    expect(ytext.toString()).toHaveLength(1000);
    expect(deltas).toHaveLength(0);
    expect(updates()).toBe(0);
  });

  it("uses STICKY_TEXT_MAX_CHARS by default and honours an explicit limit", () => {
    expect(clampToLimit("abc")).toBe("abc");
    expect(clampToLimit("abcdef", 4)).toBe("abcd");
    expect(clampToLimit("abcdef", 0)).toBe("");
  });

  it("never leaves half of an emoji pair at the cut", () => {
    // An emoji that ends exactly on the limit is kept whole.
    const exact = `${textOfLength(998)}\ud83c\udf89`;
    expect(clampToLimit(exact)).toHaveLength(1000);
    expect(clampToLimit(exact)).toBe(exact);
    expect(hasLoneSurrogate(clampToLimit(exact))).toBe(false);

    // An emoji that straddles the limit is dropped whole rather than cut in
    // half: "at most 1,000 characters" must not mean "a broken character".
    const straddling = `${textOfLength(999)}\ud83c\udf89`;
    const clamped = clampToLimit(straddling);
    expect(hasLoneSurrogate(clamped)).toBe(false);
    expect(clamped.length).toBeLessThanOrEqual(1000);
    expect(clamped).toBe(textOfLength(999));
  });
});

describe("counterVisible", () => {
  it("TC-17: false at 949, true at 950 and 951 characters", () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it("stays hidden for short notes and shows at the limit", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE_TEXT.length)).toBe(false);
    expect(counterVisible(999)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
