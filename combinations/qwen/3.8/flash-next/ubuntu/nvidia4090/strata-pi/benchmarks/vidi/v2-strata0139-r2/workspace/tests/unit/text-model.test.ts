import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  snapshot,
  type ObjectSnapshot,
} from "../../src/shared/board-model";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from "../../src/shared/config";
import {
  createText,
  deleteIfEmpty,
  getTextContent,
  isEmptyText,
  setTextSize,
  setTextWidthFixed,
  textSnapshot,
} from "../../src/shared/objects/text";
import { applyLocalEdit, clampToLimit } from "../../src/shared/text-edit";
import { SHORT_PHRASE, buildProse } from "../fixtures/texts";

/**
 * Unit tests for the text object model (`text.model`, `text.limit`).
 *
 * TC-01 to TC-06. They run against a real Y.Doc, exactly the way the client
 * and the Durable Object will: `objects` is a Y.Map of Y.Maps and every call
 * reports `true` / `false` for "did a transaction get sent".
 */

let doc: Y.Doc;
let updates: number;
let modelEvents: { id: string; keys: string[] }[];

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  modelEvents = [];
  doc.on("update", (_update, origin) => {
    if (origin === LOCAL_ORIGIN) updates += 1;
  });
  doc.getMap<Object>("objects").observeDeep((events) => {
    for (const event of events) {
      // Duck-typed on purpose: yjs exposes its event classes as YMapEvent /
      // YTextEvent, and only the map events carry `keys`.
      if (!(event.target instanceof Y.Map)) continue;
      const keys = (event as { keys?: Map<string, unknown> }).keys;
      if (!keys) continue;
      modelEvents.push({
        id: String(event.target.get("id") ?? ""),
        keys: [...keys.keys()],
      });
    }
  });
});

function texts(): readonly ObjectSnapshot[] {
  return snapshot(doc).filter((object) => object.type === "text");
}

function onlyText(): ObjectSnapshot {
  const list = texts();
  if (list.length !== 1) throw new Error(`expected one text object, got ${list.length}`);
  return list[0]!;
}

describe("text.model: createText", () => {
  it("TC-01 creates a text object at the point, size M, width mode auto, empty content", () => {
    const noteId = createSticky(doc, { x: 0, y: 0 });
    if (typeof noteId !== "string") throw new Error("createSticky failed");

    const id = createText(doc, { x: 100, y: 50 }, "g_test");
    if (typeof id !== "string") throw new Error("createText failed");

    const object = onlyText();
    expect(object.id).toBe(id);
    expect(object.type).toBe("text");
    expect(object.x).toBe(100);
    expect(object.y).toBe(50);
    expect(object.size).toBe(DEFAULT_TEXT_SIZE);
    expect(object.size).toBe("M");
    expect(object.widthMode).toBe("auto");
    expect(object.text).toBe("");
    expect(object.createdBy).toBe("g_test");
    expect(object.z).toBeGreaterThan(
      snapshot(doc).find((entry) => entry.id === noteId)?.z ?? 0,
    );
    // A fresh object has a box before it is ever measured, so it has bounds.
    expect(Number.isFinite(object.width)).toBe(true);
    expect(Number.isFinite(object.height)).toBe(true);
    expect(object.width).toBeGreaterThan(0);
    expect(object.height).toBeGreaterThan(0);
    // The content is a Y.Text, not a string.
    expect(getTextContent(doc, id)).toBeInstanceOf(Y.Text);
    expect(getTextContent(doc, id)?.toString()).toBe("");
    expect(textSnapshot(doc).map((entry) => entry.id)).toEqual([id]);
  });

  it("TC-06 refuses a non-finite point and opens no transaction", () => {
    const before = updates;

    expect(createText(doc, { x: Number.NaN, y: 10 })).toBeNull();
    expect(createText(doc, { x: 10, y: Number.POSITIVE_INFINITY })).toBeNull();
    expect(createText(doc, { x: 10, y: Number.NaN })).toBeNull();

    expect(texts()).toHaveLength(0);
    expect(updates).toBe(before);
  });
});

describe("text.model: text.size", () => {
  it("TC-02 writes one update for a known size and rejects an unknown one", () => {
    const id = createText(doc, { x: 0, y: 0 });
    if (typeof id !== "string") throw new Error("createText failed");

    expect(setTextSize(doc, id, "XL")).toBe(true);
    expect(onlyText().size).toBe("XL");
    expect(onlyText().x).toBe(0);
    expect(onlyText().y).toBe(0);

    const before = updates;
    expect(setTextSize(doc, id, "XXL")).toBe(false);
    expect(setTextSize(doc, id, "")).toBe(false);
    expect(setTextSize(doc, id, 12 as unknown as string)).toBe(false);
    expect(onlyText().size).toBe("XL");
    expect(updates).toBe(before);
  });

  it("every size in TEXT_SIZES is accepted and the stale id is refused", () => {
    const id = createText(doc, { x: 0, y: 0 });
    if (typeof id !== "string") throw new Error("createText failed");

    for (const size of Object.keys(TEXT_SIZES) as TextSize[]) {
      expect(setTextSize(doc, id, size)).toBe(true);
      expect(onlyText().size).toBe(size);
    }

    const before = updates;
    expect(setTextSize(doc, "gone", "M")).toBe(false);
    expect(updates).toBe(before);
  });
});

describe("text.model: fixed width and the box", () => {
  it("TC-03 clamps a fixed width to TEXT_MIN_WIDTH_WORLD and switches the mode", () => {
    const id = createText(doc, { x: 300, y: 0 });
    if (typeof id !== "string") throw new Error("createText failed");
    expect(onlyText().widthMode).toBe("auto");

    expect(setTextWidthFixed(doc, id, 30)).toBe(true);
    expect(onlyText().width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(onlyText().widthMode).toBe("fixed");

    expect(setTextWidthFixed(doc, id, 250)).toBe(true);
    expect(onlyText().width).toBe(250);
    expect(onlyText().widthMode).toBe("fixed");

    const before = updates;
    expect(setTextWidthFixed(doc, id, Number.NaN)).toBe(false);
    expect(setTextWidthFixed(doc, "gone", 250)).toBe(false);
    expect(updates).toBe(before);
  });
});

describe("text.model: empty content", () => {
  it("TC-04 treats only zero characters as empty, and deletes exactly that", () => {
    const empty = createText(doc, { x: 0, y: 0 });
    const whitespace = createText(doc, { x: 10, y: 0 });
    const written = createText(doc, { x: 20, y: 0 });
    for (const id of [empty, whitespace, written]) {
      if (typeof id !== "string") throw new Error("createText failed");
    }

    expect(isEmptyText(doc, empty!)).toBe(true);
    expect(deleteIfEmpty(doc, empty!)).toBe(true);
    expect(snapshot(doc).some((object) => object.id === empty)).toBe(false);

    const text = getTextContent(doc, whitespace!);
    text?.insert(0, "   ");
    expect(isEmptyText(doc, whitespace!)).toBe(false);
    expect(deleteIfEmpty(doc, whitespace!)).toBe(false);
    expect(snapshot(doc).some((object) => object.id === whitespace)).toBe(true);

    const typed = getTextContent(doc, written!);
    typed?.insert(0, SHORT_PHRASE);
    expect(isEmptyText(doc, written!)).toBe(false);
    expect(deleteIfEmpty(doc, written!)).toBe(false);

    // A stale id is refused and opens no transaction.
    const before = updates;
    expect(isEmptyText(doc, "gone")).toBe(false);
    expect(deleteIfEmpty(doc, "gone")).toBe(false);
    expect(updates).toBe(before);
  });
});

describe("text.limit: the shared clamp", () => {
  it("TC-05 clamps at exactly TEXT_MAX_CHARS and lets one more character under the limit through", () => {
    const atLimit = buildProse(TEXT_MAX_CHARS);
    expect(clampToLimit(atLimit, TEXT_MAX_CHARS)).toBe(atLimit);
    expect(clampToLimit(`${atLimit}x`, TEXT_MAX_CHARS).length).toBe(TEXT_MAX_CHARS);

    const under = buildProse(TEXT_MAX_CHARS - 1);
    const applied = clampToLimit(`${under}z`, TEXT_MAX_CHARS);
    expect(applied.length).toBe(TEXT_MAX_CHARS);
    expect(applied.endsWith("z")).toBe(true);

    expect(clampToLimit("abc", TEXT_MAX_CHARS)).toBe("abc");
  });
});

describe("text.model: rejected calls never touch the document", () => {
  it("a rejected mutation produces no model event and no local update", () => {
    const before = updates;

    expect(setTextSize(doc, "missing", "L")).toBe(false);
    expect(setTextWidthFixed(doc, "missing", 100)).toBe(false);
    expect(deleteIfEmpty(doc, "missing")).toBe(false);
    expect(getTextContent(doc, "missing")).toBeUndefined();

    expect(updates).toBe(before);
    expect(modelEvents).toHaveLength(0);
  });
});

describe("text.model: the edit a field made lives in the shared text (TC-29)", () => {
  // Each case is one board document plus a second participant's document that
  // syncs with it. `initDoc` runs once per document.
  function textField(target: Y.Doc, id: string): Y.Text {
    const entry = target.getMap<Y.Map<unknown>>("objects").get(id);
    if (!entry) throw new Error(`no object entry ${id}`);
    const ytext = entry.get("text");
    if (!(ytext instanceof Y.Text)) throw new Error("the object holds no text");
    return ytext;
  }

  function createOn(board: Y.Doc, value: string): { id: string; ytext: Y.Text } {
    const id = createText(board, { x: 0, y: 0 });
    if (!id) throw new Error("createText was refused");
    const ytext = textField(board, id);
    applyLocalEdit(ytext, "", value, LOCAL_ORIGIN);
    return { id, ytext };
  }

  /** A participant who has this board, and can write into it. */
  function peerOf(board: Y.Doc, id: string) {
    const peer = new Y.Doc();
    initDoc(peer);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(board));
    return { peer, ytext: textField(peer, id) };
  }

  function sync(board: Y.Doc, peer: Y.Doc): void {
    Y.applyUpdate(board, Y.encodeStateAsUpdate(peer));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(board));
  }

  it("text written elsewhere is pulled into the field without losing what was typed here", () => {
    const board = doc;
    const { id, ytext } = createOn(board, "went well");
    const { peer, ytext: peerText } = peerOf(board, id);

    peer.transact(() => peerText.insert(peerText.length, " — everyone kept up"));
    sync(board, peer);

    // The field now holds the merged text and goes on typing.
    const merged = ytext.toString();
    expect(applyLocalEdit(ytext, merged, `${merged}!`, LOCAL_ORIGIN)).toBe(true);

    expect(ytext.toString()).toBe("went well — everyone kept up!");
    const stored = textSnapshot(board).find((entry) => entry.id === id);
    expect(stored?.text).toBe("went well — everyone kept up!");
    expect(stored?.type).toBe("text");
  });

  it("text written into the field over text that arrived from elsewhere is not overwritten", () => {
    const board = doc;
    const { id, ytext } = createOn(board, "went well: ");
    const { peer, ytext: peerText } = peerOf(board, id);

    // Somebody else's tail reaches the shared text but not this field yet.
    peer.transact(() => peerText.insert(peerText.length, "the board is faster"));
    sync(board, peer);

    // A whole phrase typed at the caret, from the value the field still held.
    expect(applyLocalEdit(ytext, "went well: ", "went well: nobody was lost", LOCAL_ORIGIN)).toBe(true);

    const shared = ytext.toString();
    expect(shared).toContain("went well: ");
    expect(shared).toContain("the board is faster");
    expect(shared).toContain("nobody was lost");
    // Nothing was destroyed: every character each side typed is still there.
    expect(shared.length).toBe(
      "went well: ".length + "the board is faster".length + "nobody was lost".length,
    );
  });

  it("a deletion the shared text already made elsewhere is not made twice", () => {
    const board = doc;
    const { id, ytext } = createOn(board, "abc def");
    const { peer, ytext: peerText } = peerOf(board, id);

    // Elsewhere " def" became " xyz".
    peer.transact(() => {
      peerText.delete(3, 4);
      peerText.insert(3, " xyz");
    });
    sync(board, peer);

    // This field deletes " def" out of the value it still holds.
    expect(applyLocalEdit(ytext, "abc def", "abc", LOCAL_ORIGIN)).toBe(true);

    expect(ytext.toString()).toBe("abc xyz");
  });

  it("an unchanged value changes nothing and opens no transaction", () => {
    const board = doc;
    const { ytext } = createOn(board, "same");
    let transactions = 0;
    board.on("update", () => {
      transactions += 1;
    });
    expect(applyLocalEdit(ytext, "same", "same", LOCAL_ORIGIN)).toBe(false);
    expect(transactions).toBe(0);
  });
});
