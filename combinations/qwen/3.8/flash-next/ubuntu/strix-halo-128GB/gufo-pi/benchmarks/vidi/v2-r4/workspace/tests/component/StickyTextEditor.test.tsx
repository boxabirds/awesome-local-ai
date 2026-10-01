import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { PASTE_1200 } from '../fixtures/texts';


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

function noteEl(): HTMLElement {
  return screen.getByTestId('sticky-note') as HTMLElement;
}

function textarea(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
}

function textOf(id: string): string {
  return getStickyText(doc, id)?.toString() ?? '';
}

function cameraOf(): { x: number; y: number; zoom: number } {
  const el = screen.getByTestId('board-viewport');
  return {
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.zoom),
  };
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

function key(target: Element | Window, k: string): void {
  fireEvent(target, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

/** Write into the focused textarea the way a browser does: value then input. */
function typeInto(el: HTMLTextAreaElement, value: string): void {
  fireEvent.input(el, { target: { value } });
  flush();
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

describe('sticky.text — start and end editing', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    renderApp();
    const id = addNote();
    act(() => {
      getStickyText(doc, id)?.insert(0, 'Faster onboarding');
    });
    flush();

    selectNote();
    key(window, 'Enter');
    flush();

    expect(noteEl()).toHaveAttribute('data-editing', 'true');
    const el = textarea();
    expect(el).toHaveFocus();
    expect(el.value).toBe('Faster onboarding');
    expect(el.selectionStart).toBe('Faster onboarding'.length);
    expect(el.selectionEnd).toBe('Faster onboarding'.length);
  });

  it('TC-24 Escape ends editing and keeps the text', () => {
    renderApp();
    addNote();
    selectNote();
    key(window, 'Enter');
    flush();

    typeInto(textarea(), 'Keep me');
    key(textarea(), 'Escape');
    flush();

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(textOf(snapshot(doc)[0]!.id)).toBe('Keep me');
    expect(noteEl()).toHaveAttribute('data-selected', 'true');
    expect(noteEl()).toHaveAttribute('data-editing', 'false');
  });

  it('TC-38 typing then clicking outside keeps the text and deselects', () => {
    renderApp();
    addNote();
    selectNote();
    key(window, 'Enter');
    flush();

    typeInto(textarea(), 'abc');
    expect(textOf(snapshot(doc)[0]!.id)).toBe('abc');

    // pointerdown on empty board space
    pointer('pointerdown', 150, 650, screen.getByTestId('board-viewport'));
    pointer('pointerup', 150, 650, screen.getByTestId('board-viewport'));
    flush();

    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(textOf(snapshot(doc)[0]!.id)).toBe('abc');
    expect(noteEl()).toHaveAttribute('data-selected', 'false');
  });

  it('TC-26 Backspace while editing edits text and never deletes the note', () => {
    renderApp();
    addNote();
    selectNote();
    key(window, 'Enter');
    flush();

    typeInto(textarea(), 'ab');
    // The browser deletes the character before the caret, then fires input.
    key(textarea(), 'Backspace');
    typeInto(textarea(), 'a');
    flush();

    expect(notes()).toHaveLength(1);
    expect(textOf(notes()[0]!.id)).toBe('a');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('text longer than the limit is cut and the counter appears', () => {    renderApp();
    addNote();
    selectNote();
    key(window, 'Enter');
    flush();

    const pasted = PASTE_1200;
    typeInto(textarea(), pasted);
    flush();

    const kept = textOf(snapshot(doc)[0]!.id);
    expect(kept).toHaveLength(1000);
    expect(screen.getByTestId('sticky-counter')).toHaveTextContent('1000/1000');
  });
});

function notes() {
  return snapshot(doc);
}
