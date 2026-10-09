import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';

// Story 4: while the room reports the board could not be loaded (close 4500),
// every editing path must be a no-op. The transport is replaced so the test
// can drive the connection state directly and grab the App's Y.Doc.
const setStates = new Set<(state: string) => void>();
let capturedDoc: Y.Doc | null = null;

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (doc: Y.Doc, _boardId: string, onState: (state: string) => void) => {
    capturedDoc = doc;
    setStates.add(onState);
    return { destroy: () => setStates.delete(onState) };
  }
}));

import { BoardShell, canEdit } from '../../src/client/pages/BoardShell';

function drive(state: string): void {
  act(() => {
    for (const setState of setStates) setState(state);
  });
}

beforeEach(() => {
  setStates.clear();
  capturedDoc = null;
});

afterEach(() => {
  cleanup();
});

test('TC-23 a load_failed board ignores double-click, toolbar, drag and Delete', () => {
  render(<BoardShell boardId="read-only-test" />);
  drive('connected');
  const doc = capturedDoc;
  if (doc === null) throw new Error('doc not captured');
  const id = createSticky(doc, { x: 5, y: 5 }) as string;
  const snap = () => JSON.stringify(snapshot(doc));
  const baseline = snap();

  drive('load_failed');
  expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe('load_failed');

  // Double-click the board surface: no note appears.
  fireEvent.doubleClick(screen.getByTestId('board-viewport'));
  expect(snap()).toBe(baseline);

  // The Sticky note button is disabled.
  const button = screen.getByRole('button', { name: 'Sticky note' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(snap()).toBe(baseline);

  // Selecting is allowed, but dragging, colouring and deleting are not.
  const note = screen.getByTestId(`sticky-${id}`);
  fireEvent.pointerDown(note, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(note, { button: 0, pointerId: 1, clientX: 180, clientY: 160 });
  fireEvent.pointerUp(note, { pointerId: 1 });
  expect(snap()).toBe(baseline);
  expect(screen.queryByTestId(`note-toolbar-anchor-${id}`)).toBeNull();

  fireEvent.keyDown(window, { key: 'Delete' });
  expect(snap()).toBe(baseline);
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(snap()).toBe(baseline);

  // Recovery re-enables everything without a page reload.
  drive('connected');
  fireEvent.doubleClick(screen.getByTestId('board-viewport'));
  expect(snap()).not.toBe(baseline);
});

test('canEdit is false only for load_failed', () => {
  expect(canEdit('connecting')).toBe(true);
  expect(canEdit('connected')).toBe(true);
  expect(canEdit('reconnecting')).toBe(true);
  expect(canEdit('confirmed')).toBe(true);
  expect(canEdit('load_failed')).toBe(false);
});
