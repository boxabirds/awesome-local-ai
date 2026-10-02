import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { screenToWorld } from '../../src/client/canvas/camera';
import { snapshot, snapshotObjects, createSticky } from '../../src/shared/board-model';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { pointer, frames, typeInto } from './pointerUtils';

/** Deterministic measurer: 0.6 world units of width per character per font px. */
const measure = (text: string, fontPx: number): number => text.length * fontPx * 0.6;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(readOnly = false) {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} readOnly={readOnly} measure={measure} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    viewport: screen.getByTestId('board-viewport'),
    textButton: screen.getByRole('button', { name: 'Text (T)' }),
    selectButton: screen.getByRole('button', { name: 'Select (V)' }),
    stickyButton: screen.getByRole('button', { name: 'Sticky note (N)' }),
  };
}

/** The Text tool must not be active for these to make sense. */
function pressKey(target: Node | Window, key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(target, { key, bubbles: true, cancelable: true, ...init });
  frames();
}

function texts(doc: Parameters<typeof snapshotObjects>[0]): TextSnapshot[] {
  return snapshotObjects(doc).filter((obj) => obj.type === 'text') as TextSnapshot[];
}

describe('Tool mode (story 9)', () => {
  it('TC-14: T activates the Text tool, Escape and V return to Select', () => {
    const { handle, textButton, selectButton } = setup();

    expect(handle.getTool()).toBe('select');
    expect(selectButton).toHaveAttribute('aria-pressed', 'true');
    expect(textButton).toHaveAttribute('aria-pressed', 'false');

    pressKey(window, 't');
    expect(handle.getTool()).toBe('text');
    expect(textButton).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton).toHaveAttribute('aria-pressed', 'false');

    // Escape returns to Select (and clears the selection).
    pressKey(window, 'Escape');
    expect(handle.getTool()).toBe('select');

    // T then V returns to Select too.
    pressKey(window, 't');
    expect(handle.getTool()).toBe('text');
    pressKey(window, 'v');
    expect(handle.getTool()).toBe('select');
  });

  it('TC-15: a board that cannot be edited ignores T and disables the Text button', () => {
    const { handle, textButton } = setup(true);

    expect(textButton).toBeDisabled();
    pressKey(window, 't');
    expect(handle.getTool()).toBe('select');

    // Setting the tool programmatically is ignored as well (negative).
    act(() => {
      handle.setTool('text');
    });
    frames();
    expect(handle.getTool()).toBe('select');
  });

  it('TC-16: T typed into a sticky being edited is a character, not a tool switch', () => {
    const { handle, doc } = setup();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 100, y: 100 });
      handle.selection.startEdit(id);
    });
    frames();

    const editor = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    pressKey(editor, 't');
    typeInto(editor, 't');
    frames();

    expect(handle.getTool()).toBe('select');
    expect(handle.getEditingId()).toBe(id);
    expect(editor.value).toBe('t');
  });

  it('TC-17: clicking the board with the Text tool places text at the clicked point', () => {
    const { handle, doc, viewport, textButton } = setup();

    pressKey(window, 't');
    expect(textButton).toHaveAttribute('aria-pressed', 'true');

    const expected = screenToWorld(handle.getCamera(), { x: 300, y: 200 });
    pointer(viewport, 'pointerdown', 300, 200);
    pointer(viewport, 'pointerup', 300, 200);
    frames();

    const created = texts(doc);
    expect(created).toHaveLength(1);
    // The click is the top-left corner of the text, never its centre.
    expect(created[0].x).toBeCloseTo(expected.x, 6);
    expect(created[0].y).toBeCloseTo(expected.y, 6);

    // The tool hands back to Select and the new text is selected and editing.
    expect(handle.getTool()).toBe('select');
    expect(handle.getEditingId()).toBe(created[0].id);
    expect(handle.getSelectedId()).toBe(created[0].id);
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-17b: clicking on top of an existing object with the Text tool still places text', () => {
    const { handle, doc, viewport } = setup();

    // A sticky first, in select mode; the press also selects it.
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });
    frames();
    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(note, 'pointerup', 640, 400);
    frames();
    expect(handle.getSelectedIds().size).toBe(1);

    pressKey(window, 't');
    pointer(viewport, 'pointerdown', 640, 400);
    pointer(viewport, 'pointerup', 640, 400);
    frames();

    // The text is created on top of the note, and the note is no longer the
    // only object: the press did not move or edit it.
    expect(texts(doc)).toHaveLength(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-17c: with the Text tool a drag pans nothing, marquees nothing and places nothing', () => {
    const { handle, doc, viewport } = setup();

    pressKey(window, 't');
    pointer(viewport, 'pointerdown', 400, 400);
    pointer(viewport, 'pointermove', 500, 460);
    pointer(viewport, 'pointerup', 500, 460);
    frames();

    // The board did not pan.
    expect(handle.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
    // A drag is not a click, so no text was placed.
    expect(texts(doc)).toHaveLength(0);
    // And no marquee selection was made.
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    expect(handle.getSelectedIds().size).toBe(0);
  });

  it('TC-18: N creates a sticky note at the centre of the view and opens it for typing', () => {
    const { handle, doc } = setup();

    pressKey(window, 'n');

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const centre = screenToWorld(handle.getCamera(), {
      x: 1280 / 2,
      y: 800 / 2,
    });
    expect(notes[0].x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 6);
    expect(notes[0].y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 6);
    expect(handle.getEditingId()).toBe(notes[0].id);
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();

    // The Sticky note button does the same thing (regression of story 2).
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    frames();
    expect(snapshot(doc)).toHaveLength(2);
  });
});
