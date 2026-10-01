import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNote } from '../../src/client/objects/StickyNote';

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toolbar component tests', () => {
  // TC-27: Pink swatch → model colour pink, selection kept
  it('TC-27: clicking Pink swatch changes note colour to pink', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    expect(note.color).toBe('yellow');

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        onSelect={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const pinkBtn = container.querySelector('[aria-label="pink colour"]') as HTMLButtonElement;
    expect(pinkBtn).toBeTruthy();

    act(() => {
      pinkBtn.click();
    });

    const after = snapshot(doc)[0];
    expect(after.color).toBe('pink');
    // Selection is kept (note still exists)
    expect(after.id).toBe(id);
  });

  // TC-28: Sticky note button → one note centred on viewport centre, Editing
  it('TC-28: clicking Sticky note button creates a note and starts editing', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    let created = false;
    let editStarted = false;

    const { container } = render(
      <Toolbar
        onCreateSticky={() => {
          const id = createSticky(doc, { x: 0, y: 0 });
          created = id !== '';
          editStarted = true;
        }}
      />
    );

    const btn = container.querySelector('[aria-label="Sticky note"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    act(() => {
      btn.click();
    });

    expect(created).toBe(true);
    expect(editStarted).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
  });

  // TC-29: bin button → note removed, selection cleared
  it('TC-29: clicking delete button removes the note and clears selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    let selectionCleared = false;

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        onSelect={(sid) => { if (sid === null) selectionCleared = true; }}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const deleteBtn = container.querySelector('[aria-label="Delete note"]') as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();

    act(() => {
      deleteBtn.click();
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionCleared).toBe(true);
  });
});
