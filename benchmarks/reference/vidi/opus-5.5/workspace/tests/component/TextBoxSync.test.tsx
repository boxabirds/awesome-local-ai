/**
 * text.layout box sync (story 9): dimensions are written only after this client's own changes
 * (TC-12, TC-13), with a local and a simulated remote Y.Doc and a fake measurer.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { layoutText, type Measurer } from '../../src/client/objects/textLayout';
import { resizeTextWidth, useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import { initDoc, LOCAL_ORIGIN, objectSnapshot } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, isText, setTextBox, setTextSize } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { SHORT_PHRASE } from '../fixtures/texts';
import { REMOTE, selectedIds, textEditor, createTextAt, typeInto, onlyText, remote } from './textHelpers';
import { doc as boardDoc, renderBoard } from './stickyHelpers';

const CHAR_RATIO = 0.5;
const fake: Measurer = (text, fontPx) => text.length * fontPx * CHAR_RATIO;
const AUTHOR = 'g_test';

interface Pair {
  local: Y.Doc;
  peer: Y.Doc;
  id: string;
  /** LOCAL_ORIGIN transactions on the local doc that changed width or height. */
  boxWrites(): number;
  disconnect(): void;
}

/** A local doc with one text object and a peer doc exchanging every update with it. */
function pair(): Pair {
  const local = new Y.Doc();
  initDoc(local);
  const id = createText(local, { x: 0, y: 0 }, AUTHOR)!;
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local), REMOTE);
  const toPeer = (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(peer, u, REMOTE);
  };
  const toLocal = (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(local, u, REMOTE);
  };
  local.on('update', toPeer);
  peer.on('update', toLocal);
  let writes = 0;
  const obj = local.getMap<Y.Map<unknown>>('objects').get(id)!;
  obj.observe((e) => {
    if (e.transaction.origin === LOCAL_ORIGIN && (e.keysChanged.has('width') || e.keysChanged.has('height'))) {
      writes += 1;
    }
  });
  return {
    local,
    peer,
    id,
    boxWrites: () => writes,
    disconnect() {
      local.off('update', toPeer);
      peer.off('update', toLocal);
    },
  };
}

function textOf(d: Y.Doc) {
  const t = objectSnapshot(d).find(isText);
  if (!t) throw new Error('no text');
  return t;
}

let current: Pair | null = null;
afterEach(() => {
  current?.disconnect();
  current = null;
});

describe('text.layout useTextBoxSync', () => {
  it('TC-12 a remote text change causes no write; a local change causes exactly one setTextBox', () => {
    const p = (current = pair());
    const { result } = renderHook(() => useTextBoxSync(p.local, p.id, fake));

    // The other person types: their text arrives, this client writes no dimensions.
    act(() => {
      p.peer.transact(() => getTextContent(p.peer, p.id)!.insert(0, SHORT_PHRASE));
    });
    expect(textOf(p.local).text).toBe(SHORT_PHRASE);
    expect(p.boxWrites()).toBe(0);

    // This person types: one write with the measured box.
    const next = `${SHORT_PHRASE}!`;
    act(() => {
      applyTextDiff(getTextContent(p.local, p.id)!, next, LOCAL_ORIGIN);
      result.current.remeasureAfterLocalChange();
    });
    expect(p.boxWrites()).toBe(1);
    const expected = layoutText(next, 'M', 'auto', null, fake);
    expect(textOf(p.local)).toMatchObject({ width: expected.width, height: expected.height });
    // ...which the other person receives as stored.
    expect(textOf(p.peer)).toMatchObject({ width: expected.width, height: expected.height });
  });

  it('TC-13 a local size change whose re-measured box equals the stored box writes nothing (negative)', () => {
    const p = (current = pair());
    const { result } = renderHook(() => useTextBoxSync(p.local, p.id, fake));
    act(() => {
      applyTextDiff(getTextContent(p.local, p.id)!, SHORT_PHRASE, LOCAL_ORIGIN);
      result.current.remeasureAfterLocalChange();
    });
    const writesAfterTyping = p.boxWrites();
    // The box for L is already stored (e.g. by an earlier change); switching to L re-measures the same box.
    const atL = layoutText(SHORT_PHRASE, 'L', 'auto', null, fake);
    act(() => {
      setTextBox(p.local, p.id, { width: atL.width, height: atL.height });
    });
    const before = p.boxWrites();
    expect(before).toBe(writesAfterTyping + 1);
    act(() => {
      setTextSize(p.local, p.id, 'L');
      result.current.remeasureAfterLocalChange();
    });
    expect(p.boxWrites()).toBe(before);
    // Re-measuring again without any change: still nothing.
    act(() => result.current.remeasureAfterLocalChange());
    expect(p.boxWrites()).toBe(before);
  });

  it('auto → fixed after a width drag rewraps and writes the new height once', () => {
    const p = (current = pair());
    act(() => {
      applyTextDiff(getTextContent(p.local, p.id)!, 'ab cd ef', LOCAL_ORIGIN);
    });
    const start = textOf(p.local);
    const before = p.boxWrites();
    act(() => resizeTextWidth(p.local, p.id, { x: 0, y: 0, width: 40, height: 999 }, fake));
    expect(p.boxWrites()).toBe(before + 1);
    expect(textOf(p.local)).toMatchObject({
      widthMode: 'fixed',
      width: 40,
      height: 3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
      x: start.x,
      y: start.y,
    });
  });
});

describe('text.layout on the board', () => {
  it('TC-12 remote typing into a rendered text object writes no dimensions; local typing does', () => {
    renderBoard();
    const editorEl = createTextAt(300, 200);
    typeInto(editorEl, 'Went');
    const { id } = onlyText();
    expect(selectedIds()).toEqual([id]);
    let writes = 0;
    const obj = boardDoc().getMap<Y.Map<unknown>>('objects').get(id)!;
    obj.observe((e) => {
      if (e.transaction.origin === LOCAL_ORIGIN && (e.keysChanged.has('width') || e.keysChanged.has('height'))) {
        writes += 1;
      }
    });
    const boxBefore = { width: onlyText().width, height: onlyText().height };
    remote((d) => getTextContent(d, id)!.insert(4, ' well, and the next sprint went even better'));
    expect(onlyText().text).toBe('Went well, and the next sprint went even better');
    expect(textEditor()!.value).toBe('Went well, and the next sprint went even better');
    expect(writes).toBe(0);
    expect({ width: onlyText().width, height: onlyText().height }).toEqual(boxBefore);

    typeInto(textEditor()!, `${onlyText().text}!`);
    expect(writes).toBe(1);
    expect(onlyText().width).toBeGreaterThan(boxBefore.width);
  });
});
