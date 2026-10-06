import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as Y from "yjs";
import { initDoc, LOCAL_ORIGIN, snapshot } from "../../src/shared/board-model";
import { TEXT_MAX_CHARS, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from "../../src/shared/config";
import { applyTextDiff } from "../../src/shared/text-edit";
import { createText, getTextContent, setTextSize } from "../../src/shared/objects/text";
import { useTextBoxSync } from "../../src/client/objects/useTextBoxSync";
import type { Measurer } from "../../src/client/objects/textLayout";
import { createPeer } from "../unit/helpers/peer";

/**
 * Component tests for the box sync rule (`text.height`, `sync.local_only`):
 * **TC-12, TC-13**.
 *
 * A measured box is an ordinary document field, so the question is who writes
 * it. Only the client that changed the text or the size may. These tests render
 * the hook against real Y.Docs - one local, one connected as a remote peer -
 * and count the transactions this client's document actually emitted.
 *
 * The measurer is a fake (`characters x font size x 0.5`) so every expected
 * number below is exact; the real measurer is covered by the e2e test.
 */

const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

interface BoxWrite {
  readonly width: number;
  readonly height: number;
}

interface Harness {
  readonly doc: Y.Doc;
  readonly id: string;
  /** LOCAL_ORIGIN writes of this object's `width` - one per stored box. */
  readonly boxWrites: BoxWrite[];
  /** Every LOCAL_ORIGIN transaction this document emitted. */
  readonly localTransactions: number;
  box(): { width: number; height: number };
}

function harness(): Harness {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createText(doc, { x: 0, y: 0 });
  if (typeof id !== "string") throw new Error("createText failed");

  const boxWrites: BoxWrite[] = [];
  let localTransactions = 0;
  doc.on("update", (_update, origin) => {
    if (origin === LOCAL_ORIGIN) localTransactions += 1;
  });
  doc.getMap<Y.Map<unknown>>("objects").observeDeep((events, transaction) => {
    if (transaction.origin !== LOCAL_ORIGIN) return;
    for (const event of events) {
      const target = event.target;
      if (!(target instanceof Y.Map)) continue;
      const keys = (event as { keys?: Map<string, unknown> }).keys;
      if (!keys || !keys.has("width")) continue;
      boxWrites.push({
        width: Number(target.get("width")),
        height: Number(target.get("height")),
      });
    }
  });

  return {
    doc,
    id,
    boxWrites,
    get localTransactions() {
      return localTransactions;
    },
    box() {
      const object = snapshot(doc).find((entry) => entry.id === id);
      return { width: Number(object?.width), height: Number(object?.height) };
    },
  };
}

function localEdit(doc: Y.Doc, id: string, text: string): void {
  const ytext = getTextContent(doc, id);
  if (!ytext) throw new Error("text object is missing");
  applyTextDiff(ytext, text, LOCAL_ORIGIN, TEXT_MAX_CHARS);
}

describe("text.height: who writes the measured box", () => {
  it("TC-12 a local text change stores the measured box exactly once", () => {
    const board = harness();
    render(<TextBoxProbe doc={board.doc} id={board.id} />);

    localEdit(board.doc, board.id, "hello world");

    const fontPx = TEXT_SIZES.M;
    const measured = {
      width: "hello world".length * fontPx * 0.5 + 8,
      height: fontPx * 1.3,
    };
    expect(board.boxWrites).toEqual([measured]);
    expect(board.box()).toEqual(measured);
    // The text edit and the box write are the only transactions this tab made.
    expect(board.localTransactions).toBe(2);
  });

  it("TC-12 a remote text change stores nothing: the box stays as the local client left it", () => {
    const board = harness();
    render(<TextBoxProbe doc={board.doc} id={board.id} />);
    const peer = createPeer(board.doc);
    const before = board.box();
    const transactions = board.localTransactions;

    peer.change((peerDoc) => {
      const ytext = getTextContent(peerDoc, board.id);
      if (!ytext) throw new Error("the peer cannot see the text object");
      ytext.insert(0, "an extremely long remote annotation that would measure far wider");
    });

    // The remote text is here, the box is untouched, and this tab wrote nothing.
    expect(getTextContent(board.doc, board.id)?.toString().startsWith("an extremely")).toBe(true);
    expect(board.box()).toEqual(before);
    expect(board.boxWrites).toHaveLength(0);
    expect(board.localTransactions).toBe(transactions);

    peer.destroy();
    board.doc.destroy();
  });

  it("a size change from this tab re-measures; the same size from a peer does not", () => {
    const board = harness();
    render(<TextBoxProbe doc={board.doc} id={board.id} />);
    const peer = createPeer(board.doc);

    peer.change((peerDoc) => {
      setTextSize(peerDoc, board.id, "L");
    });
    expect(board.boxWrites).toHaveLength(0);

    expect(setTextSize(board.doc, board.id, "XL")).toBe(true);
    expect(board.boxWrites).toHaveLength(1);
    expect(board.box().height).toBe(TEXT_SIZES.XL * 1.3);

    peer.destroy();
    board.doc.destroy();
  });

  it("TC-13 a remeasure whose box is already correct writes nothing", () => {
    const board = harness();
    const sync = renderSync(board.doc, board.id);

    localEdit(board.doc, board.id, "hello");
    expect(board.boxWrites).toHaveLength(1);

    const box = board.box();
    const transactions = board.localTransactions;

    sync.remeasureAfterLocalChange();
    sync.remeasureAfterLocalChange();

    expect(board.boxWrites).toHaveLength(1);
    expect(board.box()).toEqual(box);
    expect(board.localTransactions).toBe(transactions);
  });

  it("an unchanged box stays unwritten even from an explicit call", () => {
    const board = harness();
    const sync = renderSync(board.doc, board.id);
    const transactions = board.localTransactions;

    // The box a fresh object was given is already what this measurer returns
    // for empty text at size M, so there is nothing to correct.
    sync.remeasureAfterLocalChange();

    expect(board.boxWrites).toHaveLength(0);
    expect(board.box().width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(board.localTransactions).toBe(transactions);
  });
});

// ---- probe ----------------------------------------------------------------

/** Renders nothing: the hook's only output is what it writes to the document. */
function TextBoxProbe({ doc, id }: { doc: Y.Doc; id: string }): null {
  useTextBoxSync(doc, id, measure);
  return null;
}

function renderSync(doc: Y.Doc, id: string) {
  let sync: { remeasureAfterLocalChange(): void } | undefined;
  function Probe(): null {
    sync = useTextBoxSync(doc, id, measure);
    return null;
  }
  render(<Probe />);
  if (!sync) throw new Error("the sync hook did not run");
  return sync;
}
