// Component tests for sticky text editing (sticky.text).
// TC-23, TC-24, TC-26, TC-38.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import { StickyNote } from '../../src/client/objects/StickyNote';

// Fake rAF
let rafId = 0;
const rafCallbacks = new Map<number, FrameRequestCallback>();
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  rafId++;
  rafCallbacks.set(rafId, cb);
  return rafId;
});
vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  rafCallbacks.delete(id);
});

function flushRAF() {
  act(() => {
    const now = performance.now();
    const cbs = Array.from(rafCallbacks.entries());
    rafCallbacks.clear();
    cbs.forEach(([_, cb]) => cb(now));
  });
}

afterEach(() => {
  cleanup();
  rafCallbacks.clear();
});

function useDocSnapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const [snap, setSnap] = useState(() => snapshot(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const handler = () => setSnap(snapshot(doc));
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc]);
  return snap;
}

function Harness({ doc }: { doc: Y.Doc }) {
  const api = useCamera({ width: 1280, height: 800 });
  const selection = useSelection();
  const objects = useDocSnapshot(doc);

  // Keyboard handler for Enter
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter' && selection.selectedId && !selection.editingId) {
        e.preventDefault();
        selection.startEdit(selection.selectedId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection.selectedId, selection.editingId, selection]);

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport
          onDblClickEmpty={(pt) => {
            const id = createSticky(doc, pt);
            if (id) selection.startEdit(id);
          }}
          onClickEmpty={() => selection.select(null)}
        >
          {objects.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
        <div data-testid="selected" data-value={selection.selectedId ?? ''} />
        <div data-testid="editing" data-value={selection.editingId ?? ''} />
      </div>
    </CameraContext.Provider>
  );
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('sticky.text (component)', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  test('TC-23 Enter on selected note starts editing with caret at end', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });
    // Set some text
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'hello');

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select the note
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });

    // Press Enter to start editing
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    // Should be editing
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Textarea should be present and focused
    const textarea = screen.getByLabelText('Sticky note text');
    expect(textarea).toBeTruthy();
    expect(textarea).toHaveFocus();
    // Caret at end
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(5);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  test('TC-24 Escape ends editing, text preserved', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'hello world');

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select and start editing
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Press Escape
    const textarea = screen.getByLabelText('Sticky note text');
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });

    // Should be selected (not editing)
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(noteId);
    // Text preserved
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  test('TC-26 Backspace while editing deletes character, not note', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;
    ytext.insert(0, 'ab');

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Select and start editing
    act(() => {
      fireEvent.pointerDown(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 300, clientY: 300, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    // Press Backspace in the textarea (should delete 'b', not the note)
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'a';
      fireEvent.input(textarea);
    });

    // Note should still be present
    expect(screen.getByTestId('sticky-note')).toBeTruthy();
    // Text should be 'a'
    expect(ytext.toString()).toBe('a');
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  test('TC-38 type text then click outside: editor unmounts, text saved, unselected', () => {
    const doc = makeDoc();
    const noteId = createSticky(doc, { x: 200, y: 200 });
    const ytext = getStickyText(doc, noteId)!;

    render(<Harness doc={doc} />);
    const note = screen.getByTestId('sticky-note');

    // Start editing via double-click
    act(() => {
      fireEvent.doubleClick(note);
    });
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(noteId);

    // Type 'abc'
    const textarea = screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'abc';
      fireEvent.input(textarea);
    });

    // Text should be in Y.Text
    expect(ytext.toString()).toBe('abc');

    // Click outside (on the viewport)
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    });

    // Editor should be unmounted
    expect(screen.queryByLabelText('Sticky note text')).toBeNull();
    // Should be unselected
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe('');
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe('');
    // Text preserved
    expect(ytext.toString()).toBe('abc');
  });
});
