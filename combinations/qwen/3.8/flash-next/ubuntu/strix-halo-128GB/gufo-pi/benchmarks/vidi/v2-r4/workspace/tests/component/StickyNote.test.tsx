import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';


let renderResult: RenderResult;
let doc: Y.Doc;

function renderApp(): RenderResult {
  doc = new Y.Doc();
  renderResult = render(<App doc={doc} />);
  flush();
  return renderResult;
}

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function cameraOf(): { x: number; y: number; zoom: number } {
  const el = viewportEl();
  return {
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.zoom),
  };
}

function notes(): ReturnType<typeof snapshot> {
  return snapshot(doc);
}

function pointerEvent(
  type: string,
  x: number,
  y: number,
  target: Element = viewportEl(),
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  fireEvent(target, event);
  return event;
}

function mouseUpOnNote(x: number, y: number, note: Element): void {
  pointerEvent('pointerup', x, y, note);
}

function doubleClickOn(note: Element): void {
  fireEvent(
    note,
    new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }),
  );
}

function keyEvent(key: string, target: Window | Element = window): void {
  fireEvent(
    target,
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

function noteEls(): HTMLElement[] {
  return screen.getAllByTestId('sticky-note') as HTMLElement[];
}

/** A note centred on the world origin: screen (600,400) with the default camera. */
function addNote(at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at);
  });
  flush();
  return id;
}

/** Screen point at the centre of the note whose top-left is (x, y). */
function centreOf(noteX: number, noteY: number): { x: number; y: number } {
  const camera = cameraOf();
  return {
    x: (noteX - camera.x) * camera.zoom + STICKY_SIZE_WORLD / 2,
    y: (noteY - camera.y) * camera.zoom + STICKY_SIZE_WORLD / 2,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  renderResult?.unmount?.();
  vi.useRealTimers();
});

describe('sticky.interaction — select', () => {
  it('TC-18 a press and release without movement selects the note and shows its toolbar', () => {
    renderApp();
    const id = addNote();
    const note = noteEls()[0]!;
    expect(note).toHaveAttribute('data-selected', 'false');
    expect(note).toHaveAccessibleName('Sticky note');

    const at = centreOf(0, 0);
    pointerEvent('pointerdown', at.x, at.y, note);
    mouseUpOnNote(at.x, at.y, note);
    flush();

    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(notes()[0]!.id).toBe(id);
  });

  it('TC-22 a click on empty board space clears the selection and hides the toolbar', () => {
    renderApp();
    addNote();
    const note = screen.getByTestId('sticky-note');
    const at = centreOf(0, 0);
    pointerEvent('pointerdown', at.x, at.y, note);
    mouseUpOnNote(at.x, at.y, note);
    flush();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    // click far from the note: empty board space
    pointerEvent('pointerdown', 200, 700);
    pointerEvent('pointerup', 200, 700);
    flush();

    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });
});

describe('sticky.interaction — drag to move', () => {
  it('TC-19 movement below the threshold selects but never moves the note', () => {
    renderApp();
    addNote();
    const note = screen.getByTestId('sticky-note');
    const before = notes()[0]!;
    const at = centreOf(before.x, before.y);

    pointerEvent('pointerdown', at.x, at.y, note);
    pointerEvent('pointermove', at.x + DRAG_THRESHOLD_PX - 1, at.y + 1, note);
    flush();
    mouseUpOnNote(at.x + DRAG_THRESHOLD_PX - 1, at.y + 1, note);
    flush();

    expect(notes()[0]!.x).toBe(before.x);
    expect(notes()[0]!.y).toBe(before.y);
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
  });

  it('TC-20 movement at the threshold drags the note and leaves the camera alone', () => {
    renderApp();
    addNote({ x: 400, y: 300 });
    const before = notes()[0]!;
    const cameraBefore = cameraOf();
    const note = screen.getByTestId('sticky-note');
    const at = centreOf(before.x, before.y);

    pointerEvent('pointerdown', at.x, at.y, note);
    pointerEvent('pointermove', at.x + DRAG_THRESHOLD_PX, at.y, note);
    flush();

    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-dragging', 'true');
    // 100% zoom: 3 screen pixels are 3 world units
    expect(notes()[0]!.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    expect(cameraOf()).toEqual(cameraBefore);

    // the grid and the other notes did not move either: no pan happened
    pointerEvent('pointermove', at.x + 60, at.y + 40, note);
    flush();
    expect(cameraOf()).toEqual(cameraBefore);
    mouseUpOnNote(at.x + 60, at.y + 40, note);
    flush();
    expect(notes()[0]!.x).toBeCloseTo(before.x + 60, 6);
    expect(notes()[0]!.y).toBeCloseTo(before.y + 40, 6);
  });

  it('TC-21 a cancelled drag keeps the last applied position', () => {
    renderApp();
    addNote({ x: 200, y: 100 });
    const before = notes()[0]!;
    const note = screen.getByTestId('sticky-note');
    const at = centreOf(before.x, before.y);

    pointerEvent('pointerdown', at.x, at.y, note);
    pointerEvent('pointermove', at.x + 40, at.y + 20, note);
    flush();
    const during = notes()[0]!;
    expect(during.x).toBeCloseTo(before.x + 40, 6);

    pointerEvent('pointercancel', at.x + 55, at.y + 30, note);
    flush();

    const after = notes()[0]!;
    expect(after.x).toBeCloseTo(during.x, 6);
    expect(after.y).toBeCloseTo(during.y, 6);
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-dragging', 'false');
  });

  it('TC-25 Delete and Backspace remove the selected note (separate runs)', () => {
    for (const key of ['Delete', 'Backspace']) {
      renderApp();
      addNote();
      const note = screen.getByTestId('sticky-note');
      const at = centreOf(0, 0);
      pointerEvent('pointerdown', at.x, at.y, note);
      mouseUpOnNote(at.x, at.y, note);
      flush();

      keyEvent(key);
      flush();

      expect(notes()).toHaveLength(0);
      expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
      cleanup();
      renderResult.unmount();
    }
  });

  it('TC-35 a double-click on an existing note edits it and creates nothing', () => {
    renderApp();
    const id = addNote();
    const note = screen.getByTestId('sticky-note');

    doubleClickOn(note);
    flush();

    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.id).toBe(id);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-36 Enter with nothing selected creates and edits nothing', () => {
    renderApp();
    keyEvent('Enter');
    flush();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });

  it('TC-37 a note deleted mid-drag ends the drag silently and is not recreated', () => {
    renderApp();
    const id = addNote({ x: 100, y: 100 });
    const note = screen.getByTestId('sticky-note');
    const at = centreOf(100, 100);

    pointerEvent('pointerdown', at.x, at.y, note);
    pointerEvent('pointermove', at.x + 30, at.y + 30, note);
    flush();

    act(() => {
      deleteObject(doc, id);
    });
    flush();

    expect(notes()).toHaveLength(0);
    // further pointer traffic is a no-op, not a re-creation
    pointerEvent('pointermove', at.x + 80, at.y + 80, document.body);
    pointerEvent('pointerup', at.x + 80, at.y + 80, document.body);
    flush();
    expect(notes()).toHaveLength(0);
  });

  it('TC-37 a note deleted while editing ends editing and is not recreated', () => {
    renderApp();
    const id = addNote();
    const note = screen.getByTestId('sticky-note');
    doubleClickOn(note);
    flush();
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    act(() => {
      deleteObject(doc, id);
    });
    flush();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
  });
});
