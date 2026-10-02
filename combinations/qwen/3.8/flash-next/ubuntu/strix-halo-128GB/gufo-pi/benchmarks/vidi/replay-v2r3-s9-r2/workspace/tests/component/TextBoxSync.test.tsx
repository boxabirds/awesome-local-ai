/**
 * Component tests for text box sync (story 9, text.height).
 * TC-12 and TC-13: the client that made the local change measures and writes
 * the box; remote changes never make it write dimensions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextWidthFixed,
  setTextSize,
} from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { useTextBoxSync, writeTextBox } from '../../src/client/objects/useTextBoxSync';
import type { Measurer } from '../../src/client/objects/textLayout';

const fakeMeasure: Measurer = (text, fontPx) =>
  Array.from(text).length * fontPx * 0.5;

/** Mounts the hook against one object and exposes the manual remeasure. */
function BoxProbe({ doc, id, measure }: { doc: Y.Doc; id: string; measure: Measurer }) {
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, measure);
  return <button onClick={remeasureAfterLocalChange}>remeasure</button>;
}

function boxOf(doc: Y.Doc, id: string): { width: number; height: number } {
  const m = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
  return { width: m.get('width') as number, height: m.get('height') as number };
}

/**
 * Mirrors what the websocket provider does to a second browser: what arrives is
 * applied with a non-local origin, so it never counts as a local change.
 */
function linkDocs(a: Y.Doc, b: Y.Doc): () => void {
  let syncing = false;
  const relay = (from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (syncing || origin === 'provider') return;
    syncing = true;
    try {
      to.transact(() => Y.applyUpdate(to, update), 'provider');
    } finally {
      syncing = false;
    }
  };
  const onA = relay(a, b);
  const onB = relay(b, a);
  a.on('update', onA);
  b.on('update', onB);
  return () => {
    a.off('update', onA);
    b.off('update', onB);
  };
}

/** Push everything `from` knows about into `to`, as the provider would. */
function syncDocs(from: Y.Doc, to: Y.Doc): void {
  to.transact(() => Y.applyUpdate(to, Y.encodeStateAsUpdate(from)), 'provider');
}

describe('text.height — box sync (TC-12)', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createText(doc, { x: 0, y: 0 }, 'local')!;
  });

  afterEach(() => {
    cleanup();
  });

  it('TC-12: a short sentence in automatic width is a little wider than its words', () => {
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);

    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'Went well', LOCAL_ORIGIN);
    });

    const measured = fakeMeasure('Went well', TEXT_SIZES.M);
    const box = boxOf(doc, id);
    expect(box.width).toBeCloseTo(measured + TEXT_AUTO_WIDTH_PADDING_WORLD, 6);
    expect(box.width).toBeGreaterThan(measured);
    expect(box.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-12: a long line wraps at the maximum width and the height follows', () => {
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);

    const line = 'a'.repeat(40) + ' ' + 'b'.repeat(40); // 810 units at size M
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, line, LOCAL_ORIGIN);
    });

    const box = boxOf(doc, id);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-12: switching to a fixed width rewraps the text and grows the height', () => {
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'data idea time', LOCAL_ORIGIN);
    });
    const before = boxOf(doc, id);

    act(() => {
      setTextWidthFixed(doc, id, 40); // one four-character word per line
    });

    const after = boxOf(doc, id);
    expect(after.width).toBe(40);
    expect(after.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('a size change updates the stored box', () => {
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'Went well', LOCAL_ORIGIN);
    });
    const medium = boxOf(doc, id);

    act(() => {
      setTextSize(doc, id, 'XL');
    });

    const bigger = boxOf(doc, id);
    expect(bigger.width).toBeGreaterThan(medium.width);
    expect(bigger.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
  });

  it('a change whose box is unchanged writes nothing', () => {
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'Went well', LOCAL_ORIGIN);
    });

    // The box is already correct: measuring again must not open a transaction.
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);
    expect(writeTextBox(doc, id, fakeMeasure)).toBe(false);
    act(() => {
      screen.getByRole('button', { name: 'remeasure' }).click();
    });
    doc.off('update', onUpdate);
    expect(updates).toBe(0);
  });

  it('the manual remeasure produces the same box as the automatic sync', async () => {
    const user = userEvent.setup();
    render(<BoxProbe doc={doc} id={id} measure={fakeMeasure} />);
    act(() => {
      applyTextDiff(getTextContent(doc, id)!, 'Went well', LOCAL_ORIGIN);
    });
    const synced = boxOf(doc, id);
    await user.click(screen.getByRole('button', { name: 'remeasure' }));
    expect(boxOf(doc, id)).toEqual(synced);
  });
});

describe('text.height — sync is local only (TC-13)', () => {
  it('TC-13: a remote change never makes this client write dimensions', () => {
    const local = new Y.Doc();
    const peer = new Y.Doc();
    initDoc(local);
    initDoc(peer);
    const unlink = linkDocs(local, peer);

    const id = createText(local, { x: 0, y: 0 }, 'local')!;
    syncDocs(local, peer);
    render(<BoxProbe doc={local} id={id} measure={fakeMeasure} />);

    act(() => {
      applyTextDiff(getTextContent(local, id)!, 'hi', LOCAL_ORIGIN);
    });
    const boxBeforeRemoteEdit = boxOf(local, id);
    expect(boxBeforeRemoteEdit.width).toBeCloseTo(
      fakeMeasure('hi', TEXT_SIZES.M) + TEXT_AUTO_WIDTH_PADDING_WORLD,
      6,
    );

    // The peer types a long paragraph: the text arrives, the box must not move.
    act(() => {
      applyTextDiff(getTextContent(peer, id)!, 'hi and a great many more words', 'peer');
      syncDocs(peer, local);
    });
    expect(getTextContent(local, id)!.toString()).toBe('hi and a great many more words');
    expect(boxOf(local, id)).toEqual(boxBeforeRemoteEdit);

    // The next local change re-syncs the box for everybody.
    act(() => {
      applyTextDiff(getTextContent(local, id)!, 'hi and a great many more words!', LOCAL_ORIGIN);
    });
    expect(boxOf(local, id).width).toBeGreaterThan(boxBeforeRemoteEdit.width);

    unlink();
    local.destroy();
    peer.destroy();
  });
});
