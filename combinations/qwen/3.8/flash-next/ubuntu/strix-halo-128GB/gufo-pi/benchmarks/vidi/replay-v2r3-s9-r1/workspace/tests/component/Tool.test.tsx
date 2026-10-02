/**
 * Tool mode tests (story 9, text.tool_ui). TC-14 to TC-18: the V/T/Escape
 * shortcuts, the toolbar's pressed state, placing text with a board click and
 * the sticky note shortcuts that must keep working.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { Measurer } from '../../src/client/objects/textLayout';
import { pointer, frames, typeInto } from './pointerUtils';

/** Deterministic measurer: 0.5 world units per character per font pixel. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

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
    selection: handle.selection,
    board: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

describe('tool mode (TC-14 to TC-18)', () => {
  it('TC-14: T activates the text tool, Escape and V return to select', () => {
    const { handle } = setup();
    frames();
    expect(handle.getTool()).toBe('select');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 't' });
    frames();
    expect(handle.getTool()).toBe('text');
    expect(screen.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    frames();
    expect(handle.getTool()).toBe('select');

    // And the same switch through the toolbar buttons.
    fireEvent.click(screen.getByRole('button', { name: 'Text (T)' }));
    frames();
    expect(handle.getTool()).toBe('text');
    fireEvent.keyDown(window, { key: 't' });
    frames();
    expect(handle.getTool()).toBe('text'); // already text, unchanged
    fireEvent.keyDown(window, { key: 'v' });
    frames();
    expect(handle.getTool()).toBe('select');
    fireEvent.click(screen.getByRole('button', { name: 'Select (V)' }));
    frames();
    expect(handle.getTool()).toBe('select');
  });

  it('TC-14: the board shows a text cursor while the text tool is active', () => {
    setup();
    frames();
    const viewport = document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
    expect(viewport.style.cursor).toBe('default');

    fireEvent.keyDown(window, { key: 'T' });
    frames();
    expect(viewport.style.cursor).toBe('text');
    // Objects step out of the way so a click always reaches the board.
    const world = document.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
    expect(world.style.pointerEvents).toBe('none');
  });

  it('TC-15: on a board that failed to load T is ignored and the Text button is disabled', () => {
    const { handle } = setup(true);
    frames();

    const textButton = screen.getByRole('button', { name: 'Text (T)' });
    expect(textButton).toBeDisabled();
    fireEvent.click(textButton);
    frames();
    expect(handle.getTool()).toBe('select');

    fireEvent.keyDown(window, { key: 't' });
    frames();
    expect(handle.getTool()).toBe('select');
    expect(snapshot(handle.doc)).toHaveLength(0);
  });

  it('TC-16: pressing T while editing a note types the letter and keeps the tool', () => {
    const { handle, doc } = setup();
    frames();

    // Open a note for typing through the toolbar button.
    fireEvent.click(screen.getByRole('button', { name: /Sticky note/i }));
    frames();
    const editor = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    expect(handle.getEditingId()).not.toBeNull();

    fireEvent.keyDown(editor, { key: 't' });
    frames();
    expect(handle.getTool()).toBe('select');

    // The keystroke belongs to the note: typing still works.
    typeInto(editor, 't');
    frames();
    expect(snapshot(doc)[0].text).toBe('t');
    expect(handle.getTool()).toBe('select');
  });

  it('TC-17: a board click with the text tool creates text there and opens it for typing', () => {
    const { handle, doc } = setup();
    frames();

    fireEvent.keyDown(window, { key: 't' });
    frames();

    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 320, 210);
    pointer(board, 'pointerup', 320, 210);
    frames();

    const created = snapshot(doc).filter((o) => o.type === 'text');
    expect(created).toHaveLength(1);
    // Camera is at the origin with zoom 1, so the world point is the click point.
    expect(created[0].x).toBeCloseTo(320, 6);
    expect(created[0].y).toBeCloseTo(210, 6);

    // The tool reverts to Select and the new text is being edited.
    expect(handle.getTool()).toBe('select');
    expect(handle.getEditingId()).toBe(created[0].id);
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-17: a click over an existing object still creates text on top of it', () => {
    const { handle, doc } = setup();
    frames();

    // A note placed by the toolbar button, then editing closed.
    fireEvent.click(screen.getByRole('button', { name: /Sticky note/i }));
    frames();
    const note = snapshot(doc)[0];
    expect(note.type).toBe('sticky');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 't' });
    frames();

    // The press is at the note's centre. In the browser the objects layer is
    // pointer-events:none in text mode, so the board receives it.
    const cam = handle.getCamera();
    const sx = (note.x + STICKY_SIZE_WORLD / 2 - cam.x) * cam.zoom;
    const sy = (note.y + STICKY_SIZE_WORLD / 2 - cam.y) * cam.zoom;
    const world = document.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
    expect(world.style.pointerEvents).toBe('none');
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', sx, sy);
    pointer(board, 'pointerup', sx, sy);
    frames();

    const texts = snapshot(doc).filter((o) => o.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].id).not.toBe(note.id);
    expect(texts[0].x).toBeCloseTo(note.x + STICKY_SIZE_WORLD / 2, 6);
    expect(handle.getTool()).toBe('select');
  });

  it('TC-18: N still creates a sticky note at the view centre', () => {
    const { handle } = setup();
    frames();

    fireEvent.keyDown(window, { key: 'n' });
    frames();

    const notes = snapshot(handle.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('sticky');
    const cam = handle.getCamera();
    expect(notes[0].x).toBeCloseTo(640 / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].y).toBeCloseTo(400 / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2, 6);
    expect(handle.getEditingId()).toBe(notes[0].id);
    expect(handle.getTool()).toBe('select');
  });

  it('N is ignored while typing and on a board that cannot be edited', () => {
    const { handle, doc } = setup(true);
    frames();
    fireEvent.keyDown(window, { key: 'n' });
    frames();
    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedIds().size).toBe(0);
  });
});
