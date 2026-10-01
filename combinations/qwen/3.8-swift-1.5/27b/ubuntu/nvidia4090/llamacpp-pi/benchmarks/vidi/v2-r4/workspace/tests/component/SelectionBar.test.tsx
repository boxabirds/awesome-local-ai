import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { SelectionBar } from '../../src/client/board/SelectionBar';

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SelectionBar component tests', () => {
  // TC-16: all selected ids deleted remotely → selection empty, bar hidden
  it('TC-16: SelectionBar returns null when ids is empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = render(
      <SelectionBar
        ids={new Set()}
        snapshot={[]}
        doc={doc}
        onDelete={() => {}}
        onColor={() => {}}
      />
    );
    expect(result.container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });

  // TC-17: two selected → "2 selected" + Delete selection button; aria-live announces count
  it('TC-17: two selected shows "2 selected" and Delete button with aria-live', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 300, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const ids = new Set([id1, id2]);
    const { container } = render(
      <SelectionBar
        ids={ids}
        snapshot={snap}
        doc={doc}
        onDelete={() => {}}
        onColor={() => {}}
      />
    );

    const bar = container.querySelector('[data-testid="selection-bar"]');
    expect(bar).toBeTruthy();

    const count = container.querySelector('[data-testid="selection-count"]');
    expect(count).toBeTruthy();
    expect(count!.textContent).toBe('2 selected');
    expect(count!.getAttribute('aria-live')).toBe('polite');

    const deleteBtn = container.querySelector('[aria-label="Delete selection"]');
    expect(deleteBtn).toBeTruthy();
  });

  // TC-18: one sticky selected → NoteToolbar instead of bar
  it('TC-18: one sticky selected shows NoteToolbar', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const ids = new Set([id1]);
    const { container } = render(
      <SelectionBar
        ids={ids}
        snapshot={snap}
        doc={doc}
        onDelete={() => {}}
        onColor={() => {}}
      />
    );

    // Should show NoteToolbar (which has data-testid="note-toolbar")
    const toolbar = container.querySelector('[data-testid="note-toolbar"]');
    expect(toolbar).toBeTruthy();

    // Should NOT show the multi-select bar
    const count = container.querySelector('[data-testid="selection-count"]');
    expect(count).toBeNull();
  });

  // TC-17 extra: three selected shows "3 selected"
  it('TC-17: three selected shows "3 selected"', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 0, y: 0 });
    const id2 = createSticky(doc, { x: 300, y: 0 });
    const id3 = createSticky(doc, { x: 600, y: 0 });
    const snap = snapshot(doc) as readonly ObjectSnapshot[];

    const ids = new Set([id1, id2, id3]);
    const { container } = render(
      <SelectionBar
        ids={ids}
        snapshot={snap}
        doc={doc}
        onDelete={() => {}}
        onColor={() => {}}
      />
    );

    const count = container.querySelector('[data-testid="selection-count"]');
    expect(count!.textContent).toBe('3 selected');
  });
});
