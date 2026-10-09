import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import { createSticky, getStickyText, initDoc } from "../../src/shared/board-model";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from "../../src/client/objects/StickyText";
import {
  PROSE_1000,
  PROSE_1200,
  RETRO_ITEM,
  SHORT_PHRASE,
  proseOfLength,
} from "../fixtures/texts";

/**
 * sticky.text unit tests (TC-13 to TC-17) against a real Y.Text.
 *
 * The minimal-diff requirement is the important one: a full replace would let a
 * local keystroke destroy whatever a teammate typed (story 3).
 */

type TextOp = number | { retain?: number; insert?: string; delete?: number };

interface Ops {
  retains: number;
  inserts: string[];
  deletes: number;
}

function opsOf(delta: readonly TextOp[]): Ops {
  const ops: Ops = { retains: 0, inserts: [], deletes: 0 };
  for (const op of delta) {
    if (typeof op === "number") ops.retains += op;
    else if (typeof op.retain === "number") ops.retains += op.retain;
    else if (typeof op.insert === "string") ops.inserts.push(op.insert);
    else if (typeof op.delete === "number") ops.deletes += op.delete;
  }
  return ops;
}

function fixture(initial: string) {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 }) as string;
  const ytext = getStickyText(doc, id)!;
  if (initial.length > 0) doc.transact(() => ytext.insert(0, initial));

  /** Applies one edit and reports what the document saw. */
  const apply = (next: string, origin: unknown = "test") => {
    const events: { ops: Ops }[] = [];
    const origins: unknown[] = [];
    let updates = 0;

    const observeText = (event: Y.YTextEvent) => {
      events.push({ ops: opsOf(event.delta as unknown as readonly TextOp[]) });
    };
    const onUpdate = (_update: Uint8Array, originValue: unknown) => {
      updates += 1;
      origins.push(originValue);
    };

    ytext.observe(observeText);
    doc.on("update", onUpdate);
    try {
      applyTextDiff(ytext, next, origin);
    } finally {
      ytext.unobserve(observeText);
      doc.off("update", onUpdate);
    }

    return { text: ytext.toString(), events, updates, origins };
  };

  return { doc, id, ytext, apply };
}

describe("sticky.text: minimal diff", () => {
  it("TC-13: 'abc' -> 'abXc' is a single insert of 'X' at index 2", () => {
    const { apply } = fixture("abc");
    const result = apply("abXc");

    expect(result.text).toBe("abXc");
    expect(result.events).toHaveLength(1);
    const { ops } = result.events[0]!;
    expect(ops.inserts).toEqual(["X"]);
    expect(ops.deletes).toBe(0);
    // The delta retains the first two characters, so the insert lands at index 2.
    expect(ops.retains).toBe(2);
    expect(result.updates).toBe(1);
  });

  it("TC-13b: a deletion in the middle is a single delete", () => {
    const { apply } = fixture("abc");
    const result = apply("ac");

    expect(result.text).toBe("ac");
    expect(result.events).toHaveLength(1);
    const { ops } = result.events[0]!;
    expect(ops.deletes).toBe(1);
    expect(ops.inserts).toEqual([]);
    expect(ops.retains).toBe(1);
  });

  it("TC-13c: replacing a selection is one delete plus one insert, never a rewrite", () => {
    const { apply } = fixture("Faster onboarding");
    const result = apply("Faster onboarding guide");

    expect(result.text).toBe("Faster onboarding guide");
    expect(result.events).toHaveLength(1);
    const { ops } = result.events[0]!;
    expect(ops.inserts).toEqual([" guide"]);
    expect(ops.deletes).toBe(0);

    const replaced = fixture("one two three").apply("one 2 three");
    expect(replaced.text).toBe("one 2 three");
    expect(replaced.events).toHaveLength(1);
    const inner = replaced.events[0]!.ops;
    expect(inner.deletes).toBe(3);
    expect(inner.inserts).toEqual(["2"]);
    // Never delete-all + insert-all.
    expect(inner.deletes + inner.inserts.join("").length).toBeLessThan("one 2 three".length);
  });

  it("TC-13d: unchanged text writes nothing", () => {
    const { apply, id } = fixture(SHORT_PHRASE);
    const result = apply(SHORT_PHRASE);
    expect(result.text).toBe(SHORT_PHRASE);
    expect(result.events).toHaveLength(0);
    expect(result.updates).toBe(0);
    expect(id).toBeTruthy();
  });

  it("TC-13e: multi-line note text diffs at the end without touching earlier lines", () => {
    const { apply } = fixture(RETRO_ITEM);
    const next = `${RETRO_ITEM} The parking lot was ignored.`;
    const result = apply(next);
    expect(result.text).toBe(next);
    expect(result.events).toHaveLength(1);
    const { ops } = result.events[0]!;
    expect(ops.deletes).toBe(0);
    expect(ops.inserts).toEqual([" The parking lot was ignored."]);
  });

  it("TC-13f: surrogate pairs are never split by a diff boundary", () => {
    // The two emoji share a high surrogate, which is where a naive
    // prefix/suffix diff would cut a pair in half.
    const smiley = "\u{1F600}";
    const heart = "\u{1F60D}";
    const { apply, ytext } = fixture(`a${smiley}b`);
    const result = apply(`a${heart}b`);

    expect(result.text).toBe(`a${heart}b`);
    expect(Array.from(result.text)).toEqual(["a", heart, "b"]);
    expect(ytext.length).toBe(4);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(result.text)).toBe(
      false,
    );

    const inserted = fixture(`keep \u{1F44D} this`).apply("keep \u{1F44D} this note");
    expect(inserted.text).toBe("keep \u{1F44D} this note");
    expect(inserted.events[0]!.ops.inserts).toEqual([" note"]);
    expect(inserted.events[0]!.ops.deletes).toBe(0);
  });

  it("writes through one transaction with the given origin", () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const ytext = getStickyText(doc, id)!;

    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    applyTextDiff(ytext, "hello", "my-origin");
    applyTextDiff(ytext, "hello", "my-origin");

    expect(ytext.toString()).toBe("hello");
    expect(origins).toEqual(["my-origin"]);
  });
});

describe("sticky.text: length limit", () => {
  it("TC-14: a 1,200 character paste keeps exactly the first 1,000", () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);

    const { apply } = fixture("");
    const result = apply(clamped);
    expect(result.text).toHaveLength(1000);
    expect(result.text).toBe(PROSE_1000);
  });

  it("TC-15: 999 characters plus one is accepted (boundary)", () => {
    const base = proseOfLength(999);
    expect(base).toHaveLength(999);
    const next = clampToLimit(`${base}z`);
    expect(next).toHaveLength(1000);
    expect(next.endsWith("z")).toBe(true);

    const { apply } = fixture(base);
    const result = apply(next);
    expect(result.text).toHaveLength(1000);
    expect(result.updates).toBe(1);
  });

  it("TC-16: one more character at 1,000 is dropped (boundary)", () => {
    const base = PROSE_1000;
    const clamped = clampToLimit(`${base}z`);
    expect(clamped).toHaveLength(1000);
    expect(clamped).toBe(base);

    const { apply } = fixture(base);
    const result = apply(clamped);
    expect(result.text).toBe(base);
    expect(result.updates).toBe(0);
  });

  it("clampToLimit leaves anything at or under the limit untouched, and honours an explicit limit", () => {
    expect(clampToLimit("")).toBe("");
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(PROSE_1000)).toHaveLength(1000);
    expect(clampToLimit("abcdefghij", 4)).toBe("abcd");
    expect(clampToLimit(RETRO_ITEM)).toBe(RETRO_ITEM);
  });
});

describe("sticky.text: counter visibility", () => {
  it("TC-17: the counter appears at 950 characters and below (boundary)", () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it("TC-17b: short notes never show the counter, a full note always does", () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_PHRASE.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true);
  });
});
