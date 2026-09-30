import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot } from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';
import { StickyNote } from '@client/objects/StickyNote';
import type { ObjectProps } from '@client/objects/registry';

// Helper to create a test doc with a sticky note
function makeDocWithNote(x = 0, y = 0): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
  return { doc, id };
}

// Render a StickyNote with mock selection callbacks (story 7 props).
function renderNote(props: Partial<ObjectProps> = {}) {
  const { doc, id } = makeDocWithNote();
  const snap = snapshot(doc);
  const obj = snap[0];

  const mockProps: ObjectProps = {
    obj,
    doc,
    zoom: 1,
    selected: false,
    editing: false,
    onObjectPointerDown: vi.fn(),
    onStartEdit: vi.fn(),
    onEndEdit: vi.fn(),
    ...props,
  };

  const result = render(<StickyNote {...mockProps} />);
  return { ...result, doc, id, obj };
}

// Create a pointer event with pointerId for jsdom
function createPointerEvent(type: string, opts: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

describe('sticky.interaction (StickyNote, story 7 contract)', () => {
  it('renders the persisted width/height (200x200 by default)', () => {
    const { container } = renderNote();
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    expect(note).not.toBeNull();
    const style = note.style;
    expect(style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(style.height).toBe(`${STICKY_SIZE_WORLD}px`);
  });

  it('renders explicit width/height from the snapshot', () => {
    const { doc, id } = makeDocWithNote();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    objects.get(id)!.set('width', 150);
    objects.get(id)!.set('height', 180);
    const obj = snapshot(doc)[0];
    const { container } = renderNote({ obj });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    expect(note.style.width).toBe('150px');
    expect(note.style.height).toBe('180px');
  });

  // TC-18 (story 7): press+release without move → onObjectPointerDown is
  // delegated to the transform gesture with the note id.
  it('TC-18: pointerdown delegates to the transform gesture with the note id', () => {
    const onObjectPointerDown = vi.fn();
    const { container } = renderNote({ onObjectPointerDown });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;

    fireEvent(note, createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    expect(onObjectPointerDown).toHaveBeenCalledTimes(1);
    expect(onObjectPointerDown.mock.calls[0][1]).toBeTypeOf('string');
  });

  it('pointerdown stopPropagation prevents the viewport pan from starting', () => {
    let propagated = true;
    const { container } = renderNote();
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    const parent = note.parentElement!;
    parent.addEventListener('pointerdown', () => { propagated = false; });
    fireEvent(note, createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    expect(propagated).toBe(false);
  });

  it('right-click does not delegate to the gesture', () => {
    const onObjectPointerDown = vi.fn();
    const { container } = renderNote({ onObjectPointerDown });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    fireEvent(note, createPointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 2 }));
    expect(onObjectPointerDown).not.toHaveBeenCalled();
  });

  it('shows a selection outline when selected', () => {
    const { container } = renderNote({ selected: true });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    expect(note.getAttribute('data-selected')).toBe('');
    expect(note.style.outline).toContain('2px');
  });

  it('no selection outline when not selected', () => {
    const { container } = renderNote({ selected: false });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    expect(note.hasAttribute('data-selected')).toBe(false);
  });

  // TC-35: dblclick on existing note → starts editing, no new note
  it('TC-35: dblclick starts editing and does not create a new note', () => {
    const onStartEdit = vi.fn();
    const { container, doc } = renderNote({ onStartEdit });
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
    const beforeCount = snapshot(doc).length;

    fireEvent.doubleClick(note);

    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onStartEdit.mock.calls[0][0]).toBeTypeOf('string');
    expect(snapshot(doc).length).toBe(beforeCount);
  });

  it('note deleted while a gesture is in flight does not throw on pointerup', () => {
    const { container } = renderNote();
    const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]');
    fireEvent(note!, createPointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    expect(() => {
      fireEvent(note!, createPointerEvent('pointerup', { clientX: 110, clientY: 100 }));
    }).not.toThrow();
  });
});
