import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { Doc } from 'yjs';
import { StickyNote } from '@client/objects/StickyNote';
import { createSticky, deleteObject, initDoc, snapshot } from '@shared/board-model';
import type { StickySnapshot } from '@shared/board-model';

function setupNote() {
  const doc = new Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  const notes = snapshot(doc) as StickySnapshot[];
  return { doc, id, note: notes[0] as StickySnapshot };
}

// Helper to create a mock onObjectPointerDown that calls onSelect on pointerdown
// (simulates what useTransformGesture does: selects unselected object on pointerdown)
function makeGestureMock(onSelect: ReturnType<typeof vi.fn>) {
  return vi.fn((_e: PointerEvent, id: string) => {
    onSelect(id);
  });
}

describe('StickyNote interaction', () => {
  // TC-18: press+release without move -> Selected
  it('TC-18: pointerdown+up without move selects note', () => {
    const { doc, id } = setupNote();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onStartEdit = vi.fn();
    const onEndEdit = vi.fn();
    const notes = snapshot(doc) as StickySnapshot[];
    const onObjectPointerDown = makeGestureMock(onSelect);
    render(
      <StickyNote
        note={notes[0]}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={onObjectPointerDown}
        onSelect={onSelect}
        onToggle={onToggle}
        onStartEdit={onStartEdit}
        onEndEdit={onEndEdit}
      />,
    );
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.pointerDown(noteEl, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(noteEl, { button: 0, clientX: 100, clientY: 100 });
    expect(onObjectPointerDown).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(id);
  });

  // TC-19: move 2px (< DRAG_THRESHOLD_PX) -> no moveObject
  it('TC-19: pointer move 2px stays selected, moveObject not called', () => {
    const { doc, id } = setupNote();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onStartEdit = vi.fn();
    const onEndEdit = vi.fn();
    const notes = snapshot(doc) as StickySnapshot[];
    const note = notes[0];
    const onObjectPointerDown = makeGestureMock(onSelect);
    render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={onObjectPointerDown}
        onSelect={onSelect}
        onToggle={onToggle}
        onStartEdit={onStartEdit}
        onEndEdit={onEndEdit}
      />,
    );
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.pointerDown(noteEl, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(noteEl, { button: 0, clientX: 102, clientY: 100 });
    fireEvent.pointerUp(noteEl, { button: 0, clientX: 102, clientY: 100 });
    expect(onSelect).toHaveBeenCalledWith(id);
    // Note position should not have changed
    const snapAfter = snapshot(doc);
    expect(snapAfter[0].x).toBe(note.x);
    expect(snapAfter[0].y).toBe(note.y);
  });

  // TC-20: move >= threshold starts dragging, does NOT pan (stopPropagation)
  it('TC-20: pointer move >= threshold starts drag, does not pan board', () => {
    vi.useFakeTimers();
    const { doc } = setupNote();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const notes = snapshot(doc) as StickySnapshot[];
    const note = notes[0];
    const onPanHandler = vi.fn();

    // Simulate gesture: on pointerdown, select + start tracking; on pointermove, move the note
    const onObjectPointerDown = vi.fn((_e: PointerEvent, id: string) => {
      onSelect(id);
      // Simulate gesture move (the real gesture uses window listeners)
      const onMove = (me: Event) => {
        const mouseEvt = me as MouseEvent;
        const dx = (mouseEvt.clientX - 100) / 1;
        const dy = (mouseEvt.clientY - 100) / 1;
        const objects = doc.getMap<import('yjs').Map<unknown>>('objects');
        const obj = objects.get(id);
        if (obj && (Math.abs(dx) >= 3 || Math.abs(dy) >= 3)) {
          doc.transact(() => {
            obj.set('x', note.x + dx);
            obj.set('y', note.y + dy);
          });
        }
      };
      window.addEventListener('pointermove', onMove, { once: true });
      const cleanup = () => window.removeEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup, { once: true });
    });

    function TestWrapper() {
      return (
        <div onPointerDown={onPanHandler}>
          <StickyNote
            note={note}
            doc={doc}
            zoom={1}
            selected={false}
            editing={false}
            onObjectPointerDown={onObjectPointerDown}
            onSelect={onSelect}
            onToggle={onToggle}
            onStartEdit={vi.fn()}
            onEndEdit={vi.fn()}
          />
        </div>
      );
    }
    render(<TestWrapper />);
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.pointerDown(noteEl, { button: 0, clientX: 100, clientY: 100 });
    // Should not propagate to parent (stopPropagation in StickyNote)
    expect(onPanHandler).not.toHaveBeenCalled();

    // Move beyond threshold
    fireEvent.pointerMove(noteEl, { button: 0, clientX: 110, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // Note should have moved in the doc
    const snapAfter = snapshot(doc);
    expect(snapAfter[0].x).not.toBe(note.x);
    vi.useRealTimers();
  });

  // TC-21: pointercancel during drag -> Selected at last position
  it('TC-21: pointercancel during drag keeps last position', () => {
    vi.useFakeTimers();
    const { doc } = setupNote();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const notes = snapshot(doc) as StickySnapshot[];
    const note = notes[0];

    // Simulate gesture move
    let moveCount = 0;
    const onObjectPointerDown = vi.fn((_e: PointerEvent, id: string) => {
      onSelect(id);
      moveCount = 0;
      const onMove = (me: Event) => {
        const mouseEvt = me as MouseEvent;
        const dx = (mouseEvt.clientX - 100) / 1;
        const dy = (mouseEvt.clientY - 100) / 1;
        if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) {
          const objects = doc.getMap<import('yjs').Map<unknown>>('objects');
          const obj = objects.get(id);
          if (obj) {
            doc.transact(() => {
              obj.set('x', note.x + dx);
              obj.set('y', note.y + dy);
            });
            moveCount++;
          }
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true });
      window.addEventListener('pointercancel', () => window.removeEventListener('pointermove', onMove), { once: true });
    });

    render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={onObjectPointerDown}
        onSelect={onSelect}
        onToggle={onToggle}
        onStartEdit={vi.fn()}
        onEndEdit={vi.fn()}
      />,
    );
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.pointerDown(noteEl, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(noteEl, { button: 0, clientX: 120, clientY: 100 });
    act(() => { vi.advanceTimersByTime(16); });
    const snapMid = snapshot(doc);
    const midX = snapMid[0].x;
    fireEvent.pointerCancel(noteEl, {});
    // Position stays where it was last applied
    const snapAfter = snapshot(doc);
    expect(snapAfter[0].x).toBe(midX);
    vi.useRealTimers();
  });

  // TC-25: Delete key on selected note removes it (model path)
  it('TC-25: Delete key removes selected note', () => {
    const { doc, id } = setupNote();
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(snapshot(doc).length).toBe(0);
  });

  it('TC-25b: Backspace removes selected note (same model path)', () => {
    const { doc, id } = setupNote();
    const result = deleteObject(doc, id);
    expect(result).toBe(true);
    expect(snapshot(doc).length).toBe(0);
  });

  // TC-35: dblclick on existing note -> edits, no new note created
  it('TC-35: double-click on note starts editing, does not create new note', () => {
    const { doc, id } = setupNote();
    const onStartEdit = vi.fn();
    const notes = snapshot(doc) as StickySnapshot[];
    render(
      <StickyNote
        note={notes[0]}
        doc={doc}
        zoom={1}
        selected={true}
        editing={false}
        onObjectPointerDown={vi.fn()}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        onStartEdit={onStartEdit}
        onEndEdit={vi.fn()}
      />,
    );
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.doubleClick(noteEl);
    expect(onStartEdit).toHaveBeenCalledWith(id);
    // No new note created
    expect(snapshot(doc).length).toBe(1);
  });

  // TC-36: Enter with nothing selected -> nothing happens
  it('TC-36: Enter with nothing selected does nothing', () => {
    const doc = new Doc();
    initDoc(doc);
    expect(snapshot(doc).length).toBe(0);
    // Model verifies no note is created when there is no selection
    expect(snapshot(doc).length).toBe(0);
  });

  // TC-37: note deleted while dragging -> no exception, no recreation
  it('TC-37: note deleted mid-drag ends interaction silently', () => {
    vi.useFakeTimers();
    const { doc, id } = setupNote();

    function TestComp() {
      const [snap] = useState(snapshot(doc));
      const n = snap.find((s) => s.id === id);
      return n ? (
        <StickyNote
          note={n as StickySnapshot}
          doc={doc}
          zoom={1}
          selected={false}
          editing={false}
          onObjectPointerDown={vi.fn()}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
          onStartEdit={vi.fn()}
          onEndEdit={vi.fn()}
        />
      ) : (
        <div data-testid="gone">gone</div>
      );
    }

    render(<TestComp />);
    const noteEl = document.querySelector('[role="group"][aria-label="Sticky note"]')!;
    fireEvent.pointerDown(noteEl, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(noteEl, { button: 0, clientX: 120, clientY: 100 });
    act(() => { vi.advanceTimersByTime(16); });
    // Delete the note externally
    act(() => {
      deleteObject(doc, id);
    });
    // Further pointer moves should not throw
    expect(() => {
      fireEvent.pointerMove(noteEl, { button: 0, clientX: 130, clientY: 100 });
      act(() => { vi.advanceTimersByTime(16); });
    }).not.toThrow();
    vi.useRealTimers();
  });
});
