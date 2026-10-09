import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX, MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import { makeSticky } from '../fixtures/stickies';

interface SelRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<SelRegistry | null>;

function SelHarness(): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: true });
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} />;
}

function mountHarness(): void {
  registry = { current: null };
  render(<SelHarness />);
}

function api(): SelRegistry {
  return registry.current!;
}

afterEach(() => {
  cleanup();
});

describe('selection bar and outlines (sel.interaction)', () => {
  test('TC-16: all selected ids deleted remotely leaves an empty selection and no bar', () => {
    mountHarness();
    const { doc, selection } = api();
    let ids: string[] = [];
    act(() => {
      ids = [makeSticky(doc, 0, 0), makeSticky(doc, 400, 0)];
    });
    act(() => {
      selection.setMany(ids, false);
    });
    expect(api().selection.ids.size).toBe(2);
    expect(screen.getByTestId('selection-bar')).toBeTruthy();
    act(() => {
      deleteObjects(doc, ids);
    });
    expect(api().selection.ids.size).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  test('TC-17: two selected shows "2 selected", an aria-live count and a working delete button', () => {
    mountHarness();
    const { doc, selection } = api();
    let ids: string[] = [];
    act(() => {
      ids = [makeSticky(doc, 0, 0), makeSticky(doc, 400, 0)];
    });
    act(() => {
      selection.setMany(ids, false);
    });
    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    const button = screen.getByRole('button', { name: 'Delete selection' });
    act(() => {
      fireEvent.click(button);
    });
    expect(snapshot(doc).length).toBe(0);
    expect(api().selection.ids.size).toBe(0);
  });

  test('TC-18: exactly one sticky selected shows the note toolbar, not the bar', () => {
    mountHarness();
    const { doc, selection } = api();
    let id = '';
    act(() => {
      id = makeSticky(doc, 0, 0);
    });
    act(() => {
      selection.setMany([id], false);
    });
    expect(api().selection.ids.size).toBe(1);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  test('TC-19: clicking empty board without drag clears the selection', () => {
    mountHarness();
    const { doc, selection } = api();
    act(() => {
      const ids = [makeSticky(doc, 0, 0), makeSticky(doc, 400, 0)];
      selection.setMany(ids, false);
    });
    expect(api().selection.ids.size).toBe(2);
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      fireEvent.pointerDown(viewport, { button: 0, pointerId: 9, clientX: 5, clientY: 5 });
      fireEvent.pointerUp(viewport, { pointerId: 9 });
    });
    expect(api().selection.ids.size).toBe(0);
  });

  test('the selection bar never covers fewer than two objects', () => {
    mountHarness();
    const { doc, selection } = api();
    act(() => {
      const id = makeSticky(doc, 0, 0);
      selection.setMany([id], false);
    });
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});
