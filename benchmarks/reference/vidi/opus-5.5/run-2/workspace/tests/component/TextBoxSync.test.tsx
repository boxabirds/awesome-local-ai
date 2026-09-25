/**
 * Story 9 useTextBoxSync (TC-12, TC-13): the measured box is written only after local
 * changes, never because of a remote peer's change, and never when it is unchanged.
 * Two real Y.Docs (local + simulated remote peer) and a fake measurer.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextBox,
  setTextSize,
  setTextWidthFixed,
} from '../../src/shared/objects/text';
import { TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { layoutText, type Measurer } from '../../src/client/objects/textLayout';
import { useTextBoxSync } from '../../src/client/objects/useTextBoxSync';
import '../../src/client/objects/registry';

const REMOTE = Symbol('remote');
/** Every character is half the font size wide. */
const fake: Measurer = (text, fontPx) => (text.length * fontPx) / 2;

/** Local doc and a peer doc kept in sync like two browser tabs. */
function peers(): { local: Y.Doc; remote: Y.Doc } {
  const local = new Y.Doc();
  const remote = new Y.Doc();
  local.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(remote, u, REMOTE);
  });
  remote.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(local, u, REMOTE);
  });
  return { local, remote };
}

/** Counts writes of width/height made by `doc` itself (not received from the peer). */
function boxWrites(doc: Y.Doc): { count: number } {
  const state = { count: 0 };
  doc.getMap('objects').observeDeep((events, tr) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    if (events.some((e) => e instanceof Y.YMapEvent && (e.keysChanged.has('width') || e.keysChanged.has('height')))) {
      state.count += 1;
    }
  });
  return state;
}

function box(doc: Y.Doc, id: string): { width: unknown; height: unknown } {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
  return { width: obj.get('width'), height: obj.get('height') };
}

describe('text.layout: useTextBoxSync', () => {
  it('TC-12 a remote text change causes no local write; a local change exactly one', () => {
    const { local, remote } = peers();
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    const writes = boxWrites(local);
    const { result } = renderHook(() => useTextBoxSync(local, id, fake));

    // The peer types: the local client never writes dimensions for it.
    remote.transact(() => getTextContent(remote, id)!.insert(0, 'Went well'));
    expect(getTextContent(local, id)!.toString()).toBe('Went well');
    expect(writes.count).toBe(0);

    // A local change: exactly one write with the measured box.
    local.transact(() => getTextContent(local, id)!.insert(9, '!'), LOCAL_ORIGIN);
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(1);
    const expected = layoutText('Went well!', 'M', 'auto', null, fake);
    expect(box(local, id)).toEqual({ width: expected.width, height: expected.height });
    // The peer receives the box but never re-measures it.
    expect(box(remote, id)).toEqual(box(local, id));
  });

  it('TC-12 in the app: remote typing into a rendered text object writes nothing locally', () => {
    const { local, remote } = peers();
    const id = createText(local, { x: 0, y: 0 }, 'g_local')!;
    getTextContent(local, id)!.insert(0, 'Hi');
    render(<App doc={local} />);
    const writes = boxWrites(local);
    act(() => {
      remote.transact(() => getTextContent(remote, id)!.insert(2, ' there, everyone'));
    });
    expect(screen.getByRole('group', { name: 'Hi there, everyone' })).toBeInTheDocument();
    expect(writes.count).toBe(0);
  });

  it('TC-12 in the app: one local keystroke writes the box once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_local')!;
    render(<App doc={doc} />);
    const el = screen.getByRole('group', { name: 'Empty text' });
    fireEvent.doubleClick(el);
    const editor = screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
    const writes = boxWrites(doc);
    editor.value = 'Went well';
    fireEvent.input(editor);
    expect(getTextContent(doc, id)!.toString()).toBe('Went well');
    expect(writes.count).toBe(1);
  });

  it('TC-13 a size change whose remeasured box equals the stored box writes nothing', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_local')!;
    getTextContent(doc, id)!.insert(0, 'Went well');
    const xl = layoutText('Went well', 'XL', 'auto', null, fake);
    setTextBox(doc, id, { width: xl.width, height: xl.height });
    const { result } = renderHook(() => useTextBoxSync(doc, id, fake));
    setTextSize(doc, id, 'XL');
    const writes = boxWrites(doc);
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(0);
    expect(box(doc, id)).toEqual({ width: xl.width, height: xl.height });
  });

  it('auto → fixed after a width drag rewraps and writes the new height once', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'g_local')!;
    getTextContent(doc, id)!.insert(0, 'one two six');
    const { result } = renderHook(() => useTextBoxSync(doc, id, fake));
    act(() => result.current.remeasureAfterLocalChange());
    expect(box(doc, id).height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    setTextWidthFixed(doc, id, TEXT_MIN_WIDTH_WORLD);
    const writes = boxWrites(doc);
    act(() => result.current.remeasureAfterLocalChange());
    expect(writes.count).toBe(1);
    expect(box(doc, id)).toEqual({ width: TEXT_MIN_WIDTH_WORLD, height: 3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT });
  });
});
