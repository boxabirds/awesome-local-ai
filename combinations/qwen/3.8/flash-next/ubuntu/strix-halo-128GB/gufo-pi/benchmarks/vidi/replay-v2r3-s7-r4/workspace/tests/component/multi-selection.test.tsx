import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { pointer, frames } from './pointerUtils';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
  };
}

const noteEls = () => screen.getAllByTestId('sticky-note');
function clickNote(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y);
  pointer(window, 'pointerup', x, y);
  frames();
}
function shiftClickNote(el: HTMLElement, x = 640, y = 400): void {
  pointer(el, 'pointerdown', x, y, { shiftKey: true });
  pointer(window, 'pointerup', x, y, { shiftKey: true });
  frames();
}

describe('multi-selection + selection bar', () => {
  it('TC-16: Ctrl+A selects all, clicking one keeps exactly that one', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(300, 0);
    create(600, 0);
    frames();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    frames();
    expect(handle.getSelectedIds()).toHaveLength(3);

    clickNote(noteEls()[1]);
    expect(handle.getSelectedIds()).toHaveLength(1);
    expect(noteEls()[1]).toHaveAttribute('data-selected', 'true');
  });

  it('TC-16 boundary: Ctrl+A with a single object selects it', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    frames();
    expect(handle.getSelectedIds()).toHaveLength(1);
  });

  it('TC-17: shift+click adds and removes ids; removing the last leaves empty', () => {
    const { handle, create } = setup();
    const [a, b, c] = [create(0, 0), create(300, 0), create(600, 0)];
    frames();
    const els = noteEls();

    shiftClickNote(els[0]); // {a}
    shiftClickNote(els[1]); // {a,b}
    shiftClickNote(els[2]); // {a,b,c}
    expect(handle.getSelectedIds().sort()).toEqual([a, b, c].sort());

    shiftClickNote(els[1]); // remove b → {a,c}
    expect(handle.getSelectedIds().sort()).toEqual([a, c].sort());

    shiftClickNote(els[0]); // {c}
    shiftClickNote(els[2]); // {}
    expect(handle.getSelectedIds()).toHaveLength(0);
  });

  it('TC-18: the selection bar shows a count, has bring-to-front and delete, and an aria-live count', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    const u = create(600, 0);
    frames();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();

    shiftClickNote(noteEls()[0]);
    shiftClickNote(noteEls()[1]);
    frames();

    const bar = screen.getByTestId('selection-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar-count').textContent).toBe('2 selected');
    expect(screen.getByTestId('selection-count-live').textContent).toBe('2 objects selected');

    // Bring to front raises both selected notes above the unselected one.
    act(() => {
      screen.getByTestId('bring-to-front').click();
    });
    frames();
    const ordered = snapshot(doc);
    const z = (id: string) => ordered.find((n) => n.id === id)!.z;
    expect(z(a)).toBeGreaterThan(z(u));
    expect(z(b)).toBeGreaterThan(z(u));

    // Delete removes both and empties the selection; the live count follows.
    act(() => {
      screen.getByTestId('delete-selection').click();
    });
    frames();
    expect(snapshot(doc).map((n) => n.id)).toEqual([u]);
    expect(handle.getSelectedIds()).toHaveLength(0);
    expect(screen.getByTestId('selection-count-live').textContent).toBe('Nothing selected');
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('TC-19: Ctrl+A gives every object an outline and the bar reports the full count', () => {
    const { handle, create } = setup();
    create(0, 0);
    create(300, 0);
    create(600, 0);
    frames();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    frames();
    noteEls().forEach((el) => expect(el).toHaveAttribute('data-selected', 'true'));
    expect(screen.getByTestId('selection-bounds')).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar-count').textContent).toBe('3 selected');
  });

  it('TC-19 boundary: a single selection shows outlines but no selection bar', () => {
    const { create } = setup();
    create(0, 0);
    frames();
    clickNote(noteEls()[0]);
    expect(noteEls()[0]).toHaveAttribute('data-selected', 'true');
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('selection-bounds')).toBeInTheDocument();
  });

  it('remote delete prunes the selection to the surviving ids', () => {
    const { handle, doc, create } = setup();
    const a = create(0, 0);
    const b = create(300, 0);
    frames();
    shiftClickNote(noteEls()[0]);
    shiftClickNote(noteEls()[1]);
    expect(handle.getSelectedIds().sort()).toEqual([a, b].sort());

    act(() => {
      deleteObject(doc, b);
    });
    frames();
    expect(handle.getSelectedIds()).toEqual([a]);
  });

  it('TC-28 (read-only): selection works but delete and bring-to-front do nothing', () => {
    const { handle, doc, create } = setup(true);
    const a = create(0, 0);
    const b = create(300, 0);
    frames();
    shiftClickNote(noteEls()[0]);
    shiftClickNote(noteEls()[1]);
    expect(handle.getSelectedIds()).toHaveLength(2);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    frames();
    expect(snapshot(doc)).toHaveLength(2);

    act(() => {
      screen.getByTestId('bring-to-front').click();
    });
    frames();
    const ordered = snapshot(doc);
    expect(ordered.find((n) => n.id === a)!.z).toBeLessThan(ordered.find((n) => n.id === b)!.z);
  });
});
