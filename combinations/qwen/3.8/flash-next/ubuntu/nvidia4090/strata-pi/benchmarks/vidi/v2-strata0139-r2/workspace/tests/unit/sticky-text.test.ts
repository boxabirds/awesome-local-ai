import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
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
} from "../../src/client/objects/StickyText";
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_PHRASE, buildProse } from "../fixtures/texts";

/**
 * Unit tests for the pure text logic of `sticky.text` (TC-13 to TC-17), run
 * against a **real** Y.Text inside a real Y.Doc so the diff is observed the
 * way story 3 will observe it on the wire.
 */

interface TextOp {
  insert?: string;
  retain?: number;
  delete?: number;
}

let doc: Y.Doc;
let ytext: Y.Text;
let deltas: TextOp[][];
let updates = 0;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on("update", () => {
    updates += 1;
  });

  const id = createSticky(doc, { x: 0, y: 0 });
  if (typeof id !== "string") throw new Error("createSticky failed");
  const text = getStickyText(doc, id);
  if (!text) throw new Error("note text is missing");
  ytext = text;
  deltas = [];
  ytext.observe((event) => deltas.push(event.delta as TextOp[]));
});

function set(newText: string): void {
  applyTextDiff(ytext, newText, LOCAL_ORIGIN);
}

function summary(): { inserted: string; deleted: number; ops: TextOp[] } {
  const ops = deltas.flat();
  return {
    inserted: ops.map((op) => op.insert ?? "").join(""),
    deleted: ops.reduce((total, op) => total + (op.delete ?? 0), 0),
    ops,
  };
}

function count(kind: "insert" | "delete"): number {
  return summary().ops.filter((op) =>
    kind === "insert" ? typeof op.insert === "string" : typeof op.delete === "number",
  ).length;
}

/** True when the string contains a lone (broken) surrogate. */
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

// ---- TC-13: minimal diff --------------------------------------------------

describe("applyTextDiff (TC-13)", () => {
  it("inserting one character in the middle is a single insert at that index", () => {
    set("abc");
    deltas = [];
    updates = 0;

    set("abXc");

    expect(ytext.toString()).toBe("abXc");
    expect(deltas).toHaveLength(1);
    expect(summary().ops).toEqual([{ retain: 2 }, { insert: "X" }]);
    expect(count("delete")).toBe(0);
    expect(updates).toBe(1);
  });

  it("deleting one character in the middle is a single delete", () => {
    set("abXc");
    deltas = [];
    updates = 0;

    set("abc");

    expect(ytext.toString()).toBe("abc");
    expect(summary().ops).toEqual([{ retain: 2 }, { delete: 1 }]);
    expect(count("insert")).toBe(0);
    expect(updates).toBe(1);
  });

  it("replacing a selection changes only the replaced span", () => {
    set("Fix onboarding today");
    deltas = [];
    updates = 0;

    set("Fix launch today");

    expect(ytext.toString()).toBe("Fix launch today");
    expect(summary().inserted).toBe("launch");
    expect(summary().deleted).toBe("onboarding".length);
    expect(count("insert")).toBe(1);
    expect(count("delete")).toBe(1);
    expect(updates).toBe(1);
  });

  it("a multi-line retro item added to existing text only appends", () => {
    set(SHORT_PHRASE);
    deltas = [];

    set(`${SHORT_PHRASE}\n${RETRO_ITEM}`);

    expect(ytext.toString()).toBe(`${SHORT_PHRASE}\n${RETRO_ITEM}`);
    expect(summary().deleted).toBe(0);
    expect(summary().inserted).toBe(`\n${RETRO_ITEM}`);
    expect(count("insert")).toBe(1);
  });

  it("an unchanged value writes nothing", () => {
    set("abc");
    deltas = [];
    updates = 0;

    set("abc");

    expect(deltas).toHaveLength(0);
    expect(updates).toBe(0);
    expect(ytext.toString()).toBe("abc");
  });

  it("surrogate pairs are never split by the diff", () => {
    set("a\u{1F600}b");
    deltas = [];

    set("a\u{1F600}c");
    expect(ytext.toString()).toBe("a\u{1F600}c");
    expect(summary().deleted).toBe(1);
    expect(summary().inserted).toBe("c");
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
  });

  it("replacing text right next to an emoji keeps the emoji intact", () => {
    set("\u{1F600}ab");
    deltas = [];

    set("Xab");
    expect(ytext.toString()).toBe("Xab");
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    expect(summary().inserted).toBe("X");
  });

  it("inserting a second emoji in the middle is a pure insert", () => {
    set("a\u{1F600}b");
    deltas = [];

    set("a\u{1F600}\u{1F600}b");
    expect(ytext.toString()).toBe("a\u{1F600}\u{1F600}b");
    expect(ytext.toString()).not.toContain("\u{FFFD}");
    expect(hasLoneSurrogate(ytext.toString())).toBe(false);
    expect(summary().deleted).toBe(0);
  });

  it("keeping the prefix and suffix means concurrent typing survives (story 3)", () => {
    set("hello");
    deltas = [];
    // Someone else appends " world" ...
    doc.transact(() => ytext.insert(5, " world"), "remote");
    deltas = [];
    // ... while this client types a character into the middle.
    set("hullo world");
    expect(ytext.toString()).toBe("hullo world");
    expect(summary().inserted).toBe("u");
    expect(summary().deleted).toBe(1);
    expect(summary().inserted.length + summary().deleted).toBeLessThan("hello world".length);
  });
});

// ---- TC-14 to TC-16: length limit ----------------------------------------

describe("clampToLimit (TC-14, TC-15, TC-16)", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000", () => {
    expect(PROSE_1200).toHaveLength(1200);
    const kept = clampToLimit(PROSE_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it("TC-14: applying the clamped paste stores 1,000 characters", () => {
    const kept = clampToLimit(PROSE_1200);
    set(kept);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(kept);
  });

  it("TC-15: 999 + 1 character is accepted (boundary)", () => {
    const near = buildProse(STICKY_TEXT_MAX_CHARS - 1);
    expect(near).toHaveLength(999);
    const next = clampToLimit(`${near}x`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next.endsWith("x")).toBe(true);
  });

  it("TC-16: 1,000 + 1 character is rejected and the text stays at 1,000", () => {
    set(PROSE_1000);
    deltas = [];
    updates = 0;

    const next = clampToLimit(`${PROSE_1000}x`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(next).toBe(PROSE_1000);

    // A single keystroke at the limit changes nothing.
    set(next);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ytext.toString()).toBe(PROSE_1000);
    expect(deltas).toHaveLength(0);
    expect(updates).toBe(0);
  });

  it("shorter text passes through unchanged", () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit("")).toBe("");
  });

  it("an explicit max is honoured", () => {
    expect(clampToLimit("abcdefghij", 4)).toBe("abcd");
  });
});

// ---- TC-17: counter visibility -------------------------------------------

describe("counterVisible (TC-17)", () => {
  it("appears when 50 or fewer characters remain", () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 51)).toBe(false); // 949 -> 51 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 50)).toBe(true); // 950 -> 50 left
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - 49)).toBe(true); // 951 -> 49 left
  });

  it("boundary values around zero remaining", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS + 1)).toBe(true);
  });
});
