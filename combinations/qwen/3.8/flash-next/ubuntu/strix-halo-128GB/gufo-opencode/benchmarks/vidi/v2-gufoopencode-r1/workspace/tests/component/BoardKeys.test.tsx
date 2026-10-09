import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX, MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { snapshot } from '../../src/shared/board-model';
import { makeSticky } from '../fixtures/stickies';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';

interface KeyRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<KeyRegistry | null>;

function KeyHarness(): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: true });
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} />;
}

function mountHarness(): void {
  registry = { current: null };
  render(<KeyHarness />);
}

function api(): KeyRegistry {
  return registry.current!;
}

function pressWindow(key: string, init: KeyboardEventInit = {}): boolean {
  let prevented = false;
  act(() => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    prevented = event.defaultPrevented;
  });
  return prevented;
}

afterEach(() => {
  cleanup();
});

describe('selection keyboard commands (sel.keyboard)', () => {
  test('TC-27: Ctrl+A selects every object and is default-prevented', () => {
    mountHarness();
    const { doc } = api();
    act(() => {
      makeSticky(doc, 0, 0);
      makeSticky(doc, 300, 0);
      makeSticky(doc, 0, 300);
    });
    expect(pressWindow('a', { ctrlKey: true })).toBe(true);
    expect(api().selection.ids.size).toBe(3);
  });

  test('TC-28: Ctrl+A on an empty board selects nothing and raises no error', () => {
    mountHarness();
    expect(pressWindow('a', { metaKey: true })).toBe(true);
    expect(api().selection.ids.size).toBe(0);
  });

  test('TC-29: arrow nudge moves by one unit, Shift by ten, with preventDefault', () => {
    mountHarness();
    const { doc, selection } = api();
    act(() => {
      const id = makeSticky(doc, 0, 0);
      selection.setMany([id], false);
    });
    const before = snapshot(doc)[0];
    expect(pressWindow('ArrowRight')).toBe(true);
    expect(snapshot(doc)[0].x).toBe(before.x + NUDGE_STEP_WORLD);
    expect(snapshot(doc)[0].y).toBe(before.y);
    expect(pressWindow('ArrowUp', { shiftKey: true })).toBe(true);
    expect(snapshot(doc)[0].y).toBe(before.y - NUDGE_LARGE_STEP_WORLD);
    expect(api().selection.ids.size).toBe(1);
  });

  test('TC-30: Backspace while editing text edits the text and keeps the note', () => {
    mountHarness();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    });
    const id = snapshot(api().doc)[0].id;
    const editor = screen.getByTestId('sticky-editor');
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(snapshot(api().doc).length).toBe(1);
    expect(snapshot(api().doc)[0].id).toBe(id);
    expect(api().selection.editingId).toBe(id);
  });

  test('TC-31: Delete removes every selected object and empties the selection', () => {
    mountHarness();
    const { doc, selection } = api();
    act(() => {
      const ids = [makeSticky(doc, 0, 0), makeSticky(doc, 300, 0)];
      selection.setMany(ids, false);
    });
    expect(api().selection.ids.size).toBe(2);
    expect(pressWindow('Delete')).toBe(true);
    expect(snapshot(api().doc).length).toBe(0);
    expect(api().selection.ids.size).toBe(0);
  });

  test('arrows and Delete without a selection do nothing and are not prevented', () => {
    mountHarness();
    const { doc } = api();
    act(() => {
      makeSticky(doc, 0, 0);
    });
    const before = snapshot(api().doc)[0];
    expect(pressWindow('ArrowRight')).toBe(false);
    expect(snapshot(api().doc)[0].x).toBe(before.x);
    expect(pressWindow('Delete')).toBe(false);
    expect(snapshot(api().doc).length).toBe(1);
  });
});
