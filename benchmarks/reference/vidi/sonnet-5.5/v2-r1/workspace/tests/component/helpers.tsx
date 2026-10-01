import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';

export const FRAME_MS = 20;

export function flush() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export const viewport = () => screen.getByTestId('board-viewport');
export const notes = () => screen.queryAllByRole('group', { name: 'Sticky note' });

/** Mirrors the App wiring for one board, exposing the real Y.Doc and selection state to the test. */
export interface Probe {
  doc: Y.Doc;
  selectedId: string | null;
  editingId: string | null;
}

export function Harness(props: { probe: Probe; zoom?: number; onReady?(doc: Y.Doc): void }) {
  const { doc, notes: list } = useBoardDoc();
  const sel = useSelection();
  props.probe.doc = doc;
  props.probe.selectedId = sel.selectedId;
  props.probe.editingId = sel.editingId;
  return (
    <div data-testid="harness" onPointerDown={() => sel.select(null)}>
      {list.map((n) => (
        <StickyNote
          key={n.id}
          note={n}
          doc={doc}
          zoom={props.zoom ?? 1}
          selected={sel.selectedId === n.id}
          editing={sel.editingId === n.id}
          onSelect={sel.select}
          onStartEdit={sel.startEdit}
          onEndEdit={sel.endEdit}
        />
      ))}
    </div>
  );
}

export function newProbe(): Probe {
  return { doc: undefined as unknown as Y.Doc, selectedId: null, editingId: null };
}

export function addNote(probe: Probe, text = '', at = { x: 100, y: 100 }): string {
  let id: string | false = false;
  act(() => {
    id = createSticky(probe.doc, at);
    if (id && text) getStickyText(probe.doc, id)?.insert(0, text);
  });
  if (!id) throw new Error('create failed');
  return id;
}

export function press(el: Element, x = 0, y = 0) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
}
export function moveTo(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function release(el: Element, x = 0, y = 0) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}
