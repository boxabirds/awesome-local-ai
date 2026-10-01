import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  setRegisteredTypes,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';

// Test harness
function KeysTestHarness({
  doc,
  selection,
  snapshot,
  canEdit,
}: {
  doc: Y.Doc;
  selection: any;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}) {
  useBoardKeys({ doc, selection, snapshot, canEdit });
  return <div data-testid="keys-harness" />;
}

beforeEach(() => {
  setRegisteredTypes(new Set(['sticky']));
});

afterEach(() => {
  cleanup();
});

describe('useBoardKeys component tests', () => {
  // TC-27: Ctrl/Cmd+A selects all with preventDefault
  it('TC-27: Ctrl+A selects all objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 300, y: 0 });
    const id3 = createSticky(doc, { x: 600, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const setMany = vi.fn();
    const selection = {
      ids: new Set<string>(),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany,
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(setMany).toHaveBeenCalledWith(expect.arrayContaining([id1, id2, id3]), false);
  });

  // TC-28: Ctrl/Cmd+A on empty board → empty, no error
  it('TC-28: Ctrl+A on empty board does not throw', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const setMany = vi.fn();
    const selection = {
      ids: new Set<string>(),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany,
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    expect(() => {
      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
    }).not.toThrow();

    expect(setMany).toHaveBeenCalledWith([], false);
  });

  // TC-29: ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD
  it('TC-29: ArrowRight nudges selection right by NUDGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const startX = snap[0].x;

    const selection = {
      ids: new Set([id]),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    const after = snapshot(doc)[0];
    expect(after.x).toBe(startX + NUDGE_STEP_WORLD);
    expect(after.y).toBe(snap[0].y);
  });

  it('TC-29: Shift+ArrowUp nudges selection up by NUDGE_LARGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];
    const startX = snap[0].x;
    const startY = snap[0].y;

    const selection = {
      ids: new Set([id]),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    const after = snapshot(doc)[0];
    expect(after.y).toBe(startY - NUDGE_LARGE_STEP_WORLD);
    expect(after.x).toBe(startX);
  });

  // TC-30: Backspace while editing → text edited, objects kept (negative)
  it('TC-30: Backspace while editing does not delete objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const selection = {
      ids: new Set([id]),
      editingId: id, // editing!
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    // Objects should still exist
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-31: Delete with selection → all removed, selection empty
  it('TC-31: Delete key removes all selected objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 300, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const clear = vi.fn();
    const selection = {
      ids: new Set([id1, id2]),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear,
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(clear).toHaveBeenCalled();
  });

  // Escape clears selection
  it('Escape clears the selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const clear = vi.fn();
    const selection = {
      ids: new Set([id]),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear,
      startEdit: vi.fn(),
      endEdit: vi.fn(),
    };

    render(
      <KeysTestHarness doc={doc} selection={selection} snapshot={snap} canEdit={true} />
    );

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(clear).toHaveBeenCalled();
  });
});
