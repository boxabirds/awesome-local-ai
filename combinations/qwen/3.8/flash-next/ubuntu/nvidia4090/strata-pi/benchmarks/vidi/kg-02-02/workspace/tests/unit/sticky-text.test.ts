import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from "../../src/client/objects/StickyText";
import { LOCAL_ORIGIN } from "../../src/shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import {
  LONG_PROSE,
  PROSE_1000,
  PROSE_1200,
  RETRO_NOTE_TEXT,
  SHORT_NOTE_TEXT,
  proseOfLength,
} from "../fixtures/texts";

/**
 * Unit tests for the pure half of sticky.text: the minimal Y.Text diff, the
 * length limit and the counter threshold. Font fitting needs real layout and
 * is verified in the e2e tests (TC-33).
 */

interface DeltaOp {
  retain?: number;
  insert?: unknown;
  delete?: number;
}

/** A `Y.Text` living in a real document, plus recorders for its events. */
function makeText(initial: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText("note-text");
  if (initial.length > 0) doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);

  const deltas: DeltaOp[][] = [];
  const textHandler = (event: Y.YTextEvent) => {
    deltas.push(event.delta.map((op) => ({ ...op })));
  };
  ytext.observe(textHandler);

  const origins: unknown[] = [];
  const updateHandler = (_update: Uint8Array, origin: unknown) => {
    origins.push(origin);
  };
  doc.on("update", updateHandler);

  return {
    doc,
    ytext,
    deltas,
    origins,
    /** `ytext` events recorded so far (deleted ranges, inserted text). */
    changes: () => deltas.map(summarise),
  };
}

/** Rewrites a delta into "which original indexes were deleted / what was inserted where". */
function summarise(delta: DeltaOp[]) {
  const deletes: number[] = [];
  const inserts: { at: number; text: string }[] = [];
  let index = 0;
  for (const op of delta) {
    if (typeof op.retain === "number") {
      index += op.retain;
    } else if (typeof op.insert === "string") {
      inserts.push({ at: index, text: op.insert });
    } else if (typeof op.delete === "number") {
      for (let i = 0; i < op.delete; i += 1) deletes.push(index + i);
      index += op.delete;
    }
  }
  return { deletes, inserts, insertedText: inserts.map((i) => i.text).join("") };
}

/** True when the string contains an unpaired surrogate. */
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

describe("applyTextDiff", () => {
  it("TC-13: 'abc' -> 'abXc' is one insert of 'X' at index 2, nothing deleted", () => {
    const text = makeText("abc");
    applyTextDiff(text.ytext, "abXc", LOCAL_ORIGIN);

    expect(text.ytext.toString()).toBe("abXc");
    expect(text.changes()).toEqual([
      { deletes: [], inserts: [{ at: 2, text: "X" }], insertedText: "X" },
    ]);
    expect(text.origins).toEqual([LOCAL_ORIGIN]);
  });

  it("TC-13: a deletion in the middle is one delete range, no insert", () => {
    const text = makeText("abcdef");
    applyTextDiff(text.ytext, "abdef", LOCAL_ORIGIN);

    expect(text.ytext.toString()).toBe("abdef");
    const [change] = text.changes();
    expect(change.deletes).toEqual([2]);
    expect(change.insertedText).toBe("");
  });

  it("TC-13: replacing a selection is one delete plus one insert", () => {
    const text = makeText("abcde");
    applyTextDiff(text.ytext, "abXde", LOCAL_ORIGIN);

    expect(text.ytext.toString()).toBe("abXde");
    const [change] = text.changes();
    expect(change.deletes).toEqual([2]);
    expect(change.insertedText).toBe("X");
  });

  it("TC-13: appending a multi-line retro item only inserts the new part", () => {
    const text = makeText("What went well:");
    applyTextDiff(text.ytext, RETRO_NOTE_TEXT, LOCAL_ORIGIN);

    expect(text.ytext.toString()).toBe(RETRO_NOTE_TEXT);
    const [change] = text.changes();
    expect(change.deletes).toEqual([]);
    expect(change.insertedText).toBe("\n- pairing on the camera maths\n- shipping the demo with real data");
  });

  it("TC-13: an edit in the middle of a long note never rewrites the note", () => {
    const text = makeText(PROSE_1000);
    const next = `${PROSE_1000.slice(0, 500)}X${PROSE_1000.slice(500)}`;
    applyTextDiff(text.ytext, next, LOCAL_ORIGIN);

    expect(text.ytext.toString()).toBe(next);
    const [change] = text.changes();
    // Not delete-all + insert-all: concurrent typing by another person (story 3) survives.
    expect(change.deletes).toEqual([]);
    expect(change.insertedText).toBe("X");
  });

  it("TC-13: identical text writes nothing (no event, no transaction)", () => {
    const text = makeText(SHORT_NOTE_TEXT);
    applyTextDiff(text.ytext, SHORT_NOTE_TEXT, LOCAL_ORIGIN);

    expect(text.deltas).toHaveLength(0);
    expect(text.origins).toHaveLength(0);
    expect(text.ytext.toString()).toBe(SHORT_NOTE_TEXT);
  });

  it("TC-13: surrogate pairs are never split in the middle", () => {
    const cases: [string, string][] = [
      ["hello \u{1F600}", "hello \u{1F600} world"],
      ["\u{1F600}\u{1F600}", "\u{1F600}"],
      ["a\u{1F600}b", "a\u{1F600}c"],
      ["idea \u{1F4A1}", "idea"],
    ];
    for (const [before, after] of cases) {
      const text = makeText(before);
      applyTextDiff(text.ytext, after, LOCAL_ORIGIN);
      expect(text.ytext.toString()).toBe(after);
      const [change] = text.changes();
      expect(hasLoneSurrogate(change.insertedText)).toBe(false);
      // A delete must cover whole characters, so the remaining text is intact.
      expect(hasLoneSurrogate(text.ytext.toString())).toBe(false);
    }
  });

  it("TC-16: text already at the limit gains nothing (no transaction)", () => {
    const text = makeText(PROSE_1000);
    const next = clampToLimit(`${PROSE_1000}x`);
    applyTextDiff(text.ytext, next, LOCAL_ORIGIN);

    expect(next.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(text.ytext.toString()).toBe(PROSE_1000);
    expect(text.deltas).toHaveLength(0);
    expect(text.origins).toHaveLength(0);
  });
});

describe("clampToLimit", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000", () => {
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);
  });

  it("TC-15: 999 characters plus one character is accepted (boundary)", () => {
    const before = proseOfLength(999);
    const clamped = clampToLimit(`${before}s`);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(`${before}s`);
  });

  it("TC-16: one character past the limit is dropped (boundary)", () => {
    const clamped = clampToLimit(`${PROSE_1000}z`);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);
  });

  it("leaves anything at or below the limit untouched", () => {
    expect(clampToLimit("")).toBe("");
    expect(clampToLimit(SHORT_NOTE_TEXT)).toBe(SHORT_NOTE_TEXT);
    const atLimit = proseOfLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit)).toBe(atLimit);
  });

  it("never cuts an emoji in half", () => {
    const withEmoji = `${proseOfLength(999)}\u{1F600} tail`;
    const clamped = clampToLimit(withEmoji);
    expect(clamped.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    expect(hasLoneSurrogate(clamped)).toBe(false);
  });

  it("respects an explicit max (used by tests and future object types)", () => {
    expect(clampToLimit("abcdef", 3)).toBe("abc");
  });

  it("the fixture really is longer than the limit", () => {
    expect(LONG_PROSE.length).toBeGreaterThan(STICKY_TEXT_MAX_CHARS);
  });
});

describe("counterVisible", () => {
  it("TC-17: appears at 950 remaining-or-fewer, not at 951", () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it("stays hidden while the note has plenty of room", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE_TEXT.length)).toBe(false);
    expect(counterVisible(900)).toBe(false);
  });

  it("is visible at the limit itself", () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
