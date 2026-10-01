import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

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

function addNote(at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at);
  });
  flush();
  return id;
}

function notes() {
  return snapshot(doc);
}

function noteEl(): HTMLElement {
  return screen.getByTestId('sticky-note') as HTMLElement;
}

function cameraOf(): { x: number; y: number; zoom: number } {
  const el = screen.getByTestId('board-viewport');
  return { x: Number(el.dataset.cameraX), y: Number(el.dataset.cameraY), zoom: Number(el.dataset.zoom) };
}

function centreOf(noteX: number, noteY: number): { x: number; y: number } {
  const camera = cameraOf();
  return {
    x: (noteX - camera.x) * camera.zoom + STICKY_SIZE_WORLD / 2,
    y: (noteY - camera.y) * camera.zoom + STICKY_SIZE_WORLD / 2,
  };
}

function pointer(type: string, x: number, y: number, target: Element): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(target, event);
}

function selectNote(): void {
  const at = centreOf(0, 0);
  pointer('pointerdown', at.x, at.y, noteEl());
  pointer('pointerup', at.x, at.y, noteEl());
  flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  renderResult?.unmount?.();
  vi.useRealTimers();
});

describe('sticky.toolbar — colour', () => {
  it('TC-27 clicking the Pink swatch recolours the note and keeps the selection', () => {
    renderApp();
    const id = addNote();
    selectNote();

    const pink = screen.getByRole('button', { name: 'Pink colour' });
    expect(pink).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pink);
    flush();

    expect(notes()[0]!.color).toBe('pink');
    expect(notes()[0]!.id).toBe(id);
    expect(noteEl()).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('every swatch has an accessible name and the six colours are present', () => {
    renderApp();
    addNote();
    selectNote();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByRole('button', { name: `${name} colour` })).toBeInTheDocument();
    }
  });
});

describe('sticky.toolbar — create', () => {
  it('TC-28 the Sticky note button creates one note centred on the viewport and edits it', () => {
    renderApp();
    expect(notes()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    flush();

    expect(notes()).toHaveLength(1);
    const note = notes()[0]!;
    // The viewport is 1200 x 800 and the camera starts centred on the world
    // origin, so the visible centre is world (0,0): the note's top-left is
    // half a note size away from it.
    expect(note.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    expect(note.color).toBe('yellow');
    expect(noteEl()).toHaveAttribute('data-editing', 'true');
    expect(screen.getByTestId('sticky-textarea')).toHaveFocus();
  });

  it('the toolbar button carries the double-click hint as its tooltip', () => {
    renderApp();
    expect(screen.getByRole('button', { name: 'Sticky note' })).toHaveAttribute(
      'title',
      'Sticky note – or double-click the board',
    );
  });
});

describe('sticky.toolbar — delete', () => {
  it('TC-29 the bin button removes the note and clears the selection', () => {
    renderApp();
    const id = addNote();
    selectNote();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    flush();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    expect(id).toBeTruthy();
  });

  it('clicking the toolbar does not clear the selection', () => {
    renderApp();
    addNote();
    selectNote();
    const cameraBefore = cameraOf();

    fireEvent.pointerDown(screen.getByTestId('note-toolbar'), { clientX: 10, clientY: 10 });
    flush();

    expect(noteEl()).toHaveAttribute('data-selected', 'true');
    expect(cameraOf()).toEqual(cameraBefore);
  });
});
