import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { screenToWorld } from '../../src/client/canvas/camera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { newBoardId } from '../../src/shared/board-id';
import type { ConnectOptions } from '../../src/client/sync/connectBoard';
import { FakeClock, FakeProvider } from './fake-sync';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { dispatchKey, getCamera, TEST_BOARD_ID } from './util';
import {
  clickWithPointer,
  createUnselectedNote,
  getSelection,
  getSnapshot,
  noteEl,
  typeText,
  viewportEl,
} from './stickyUtil';
import { getTexts, toolButton, toolState } from './textUtil';

/**
 * Story 9 — the Text tool (text.tool_ui).
 *
 * A tool is per tab and per board: it lives in React state, never in the shared
 * document, so two people on one board are never in each other's mode (PRD text.tool).
 */
describe('tool mode and the Text tool (text.tool_ui)', () => {
  // TC-14: T switches to Text and the button says so; Escape and V come back.
  it('TC-14 T activates the Text tool, Escape and V return to Select', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    expect(toolState()).toBe('select');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('text').getAttribute('aria-pressed')).toBe('false');

    dispatchKey({ key: 't' });
    expect(toolState()).toBe('text');
    expect(toolButton('text').getAttribute('aria-pressed')).toBe('true');
    expect(toolButton('select').getAttribute('aria-pressed')).toBe('false');
    // The pointer is a caret while Text is active, so the mode is visible at the cursor.
    expect(viewportEl().getAttribute('data-tool')).toBe('text');
    expect(viewportEl().style.cursor).toBe('text');

    // Escape also drops back to Select (PRD text.tool).
    dispatchKey({ key: 'Escape' });
    expect(toolState()).toBe('select');

    dispatchKey({ key: 't' });
    expect(toolState()).toBe('text');
    dispatchKey({ key: 'v' });
    expect(toolState()).toBe('select');
  });

  // TC-15: a board that cannot be edited has no Text tool to switch to.
  it('TC-15 leaves the Text tool alone when the board cannot be edited (negative)', () => {
    const provider = new FakeProvider();
    const clock = new FakeClock();
    const connect: ConnectOptions = { after: clock.after };
    render(<Board boardId={newBoardId()} sync connect={connect} provider={provider} />);
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(toolState()).toBe('select');

    act(() => provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED));

    // The button is disabled, and the shortcut that would use it does nothing either.
    expect(toolButton('text').disabled).toBe(true);
    expect(toolButton('text').getAttribute('aria-disabled')).toBe('true');
    dispatchKey({ key: 't' });
    expect(toolState()).toBe('select');
    expect(getTexts()).toHaveLength(0);
  });

  // TC-16: T inside a text field is the letter t, not a mode change.
  it('TC-16 types the letter while text is being edited and leaves the tool (negative)', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const note = await createUnselectedNote('Retro');
    clickWithPointer(noteEl(0), { x: 40, y: 40 });
    // Enter starts editing, then the letters go into the note.
    expect(dispatchKey({ key: 'Enter' })).toBe(true);
    expect(getSelection().editingId).toBe(note.id);

    // The letter belongs to the note, and the tool stays where it was.
    await typeText('t');

    expect(toolState()).toBe('select');
    expect(getSnapshot().find((n) => n.id === note.id)!.text).toBe('Retrot');
    expect(getTexts()).toHaveLength(0);
  });

  // TC-17: a click in the Text tool puts a text where it was clicked and starts editing.
  it('TC-17 creates a text at the clicked point, edits it, and returns to Select', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    dispatchKey({ key: 't' });
    expect(toolState()).toBe('text');

    const before = getCamera();
    clickWithPointer(viewportEl(), { x: 300, y: 200 });

    const texts = getTexts();
    expect(texts).toHaveLength(1);
    const expected = screenToWorld(before, { x: 300, y: 200 });
    // Top-left at the click, size M, automatic width, nothing typed yet (PRD text.create).
    expect(texts[0]).toMatchObject({
      type: 'text',
      x: expected.x,
      y: expected.y,
      size: 'M',
      widthMode: 'auto',
      text: '',
    });

    // Straight into editing, and the tool is back to Select for the next click.
    expect(getSelection().editingId).toBe(texts[0]!.id);
    expect(screen.getByTestId('text-object-input')).not.toBeNull();
    expect(toolState()).toBe('select');
  });

  // TC-18: N still does exactly what the Sticky note button does.
  it('TC-18 N still creates a sticky note at the centre of the view', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    dispatchKey({ key: 'n' });

    expect(getSnapshot()).toHaveLength(1);
    expect(getTexts()).toHaveLength(0);
    // Centred on the visible board area, as story 2 established.
    // The same screen point the app calls the centre of the view.
    const camera = getCamera();
    const centre = screenToWorld(camera, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const note = getSnapshot()[0]!;
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 6);
    // And it is ready to type in, like the button.
    expect(getSelection().editingId).toBe(note.id);
  });
});
