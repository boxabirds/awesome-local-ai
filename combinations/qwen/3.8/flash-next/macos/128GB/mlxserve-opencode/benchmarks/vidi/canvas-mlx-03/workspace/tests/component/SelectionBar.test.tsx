// Story 7 `sel.interaction` component cases (TC-16, TC-17, TC-18) — plus the
// selection bar's one action.
//
// A real Y.Doc and the real board shell: the selection is this client's local
// state, so "a colleague deleted it" is simulated by mutating the shared document
// the way a remote update would.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import {
  initDoc,
  createSticky,
  deleteObjects,
  deleteObject,
  snapshot,
} from '../../src/shared/board-model.ts';

function firePointer(
  el: Element,
  type: string,
  x: number,
  y: number,
  opts: { shift?: boolean } = {},
) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

let doc: Y.Doc;
let a: string;
let b: string;

function setup() {
  doc = new Y.Doc();
  initDoc(doc);
  a = createSticky(doc, { x: 300, y: 300 });
  b = createSticky(doc, { x: 700, y: 300 });
  render(<BoardApp doc={doc} />);
}

const note = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const selectedAttr = (id: string) => note(id).getAttribute('data-selected');

function clickNote(id: string) {
  firePointer(note(id), 'pointerdown', 20, 20);
  firePointer(note(id), 'pointerup', 20, 20);
}
function shiftClickNote(id: string) {
  firePointer(note(id), 'pointerdown', 20, 20, { shift: true });
  firePointer(note(id), 'pointerup', 20, 20);
}
function selectTwo() {
  clickNote(a);
  shiftClickNote(b);
}
/** What assistive technology is told about the selection. */
const live = () => screen.getByTestId('selection-live').textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 7 sel.interaction selection bar (TC-16..TC-18)', () => {
  it('TC-17 two selected: "2 selected" and a Delete selection button, announced', () => {
    setup();
    selectTwo();
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeInTheDocument();
    // The count is announced, not merely painted.
    expect(screen.getByTestId('selection-live')).toHaveAttribute('aria-live', 'polite');
    expect(live()).toBe('2 selected');
  });

  it('TC-17 three selected: the count counts the objects that exist', () => {
    setup();
    let c = '';
    act(() => {
      c = createSticky(doc, { x: 300, y: 700 });
    });
    selectTwo();
    shiftClickNote(c);
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('3 selected');
    expect(live()).toBe('3 selected');
  });

  it('TC-17 the Delete selection button removes every selected object and clears', () => {
    setup();
    selectTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    flush();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(live()).toBe('');
  });

  it('TC-18 one sticky selected: its note toolbar, not the selection bar', () => {
    setup();
    clickNote(a);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    // A single selection is not worth a count announcement.
    expect(live()).toBe('');
  });

  it('TC-16 every selected object deleted remotely: selection empty, bar hidden', () => {
    setup();
    selectTwo();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    flush();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(live()).toBe('');
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
  });

  it('TC-16 boundary: deleting one of two leaves the other selected and no bar', () => {
    setup();
    selectTwo();
    act(() => {
      deleteObject(doc, b);
    });
    flush();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(live()).toBe('');
    expect(selectedAttr(a)).toBe('true');
    // and the survivor can still be deleted with the keyboard
    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    flush();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('selection lives in this client only: nothing about it is written to the doc', () => {
    setup();
    const before = Y.encodeStateAsUpdate(doc);
    selectTwo();
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('a colleague selecting the same object does not take it over', () => {
    setup();
    clickNote(a);
    // A remote client touching the same object only changes the object, never my
    // selection: selection is per-client state.
    act(() => {
      doc.transact(() => {
        (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(a)!.set('color', 'blue');
      });
    });
    flush();
    expect(selectedAttr(a)).toBe('true');
  });
});

function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}
