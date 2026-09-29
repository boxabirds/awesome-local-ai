/**
 * Story 9 component tests — text.tool_ui (TC-14, TC-16, TC-17, TC-18):
 * the T/V/Escape tool keyboard, typing a character while an editor is open
 * (negative), text creation at the click point with the tool reverting to
 * Select, and the N sticky regression. TC-15 (locked board) lives in
 * ToolLocked.test.tsx (file-level provider mock).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects, getStickyText, snapshot } from 'src/shared/board-model';
import { STICKY_SIZE_WORLD } from 'src/shared/config';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

// The initial camera is resetCamera(viewport): world (0,0) at the screen
// centre of the 1024x768 jsdom window (same assumption as transform.test.tsx).

function selectButton(): HTMLElement {
  return screen.getByTestId('select-tool-button');
}
function textButton(): HTMLElement {
  return screen.getByTestId('text-tool-button');
}

describe('text.tool_ui (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-14: T activates the Text tool; Escape and V return to Select; the buttons mirror the state', async () => {
    // Initial: Select active.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    const user = userEvent.setup();
    await user.keyboard('T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    await user.keyboard('T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-16: with a sticky in edit mode, pressing T types a character (does not switch tools)', async () => {
    const doc = getDoc();

    // N creates a sticky at the view centre; Enter starts editing it.
    fireEvent.keyDown(window, { key: 'n' });
    const [note] = snapshot(doc);
    expect(note.type).toBe('sticky');
    fireEvent.keyDown(window, { key: 'Enter' });
    const textarea = await screen.findByTestId('sticky-note-textarea');
    expect(textarea).toHaveFocus();

    const user = userEvent.setup();
    await user.keyboard('T');

    // The keystroke went into the editor (as a capital T — the default
    // keyboard layout types uppercase for 'T'); the tool is unchanged.
    expect(getStickyText(doc, note.id)!.toString()).toBe('T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
  });

  it('TC-17: Text tool + click at a screen point creates text at the world point, reverts to Select, and opens the editor', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('T');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    // Click at screen (712,434) → world (200,50) with a 1024x768 viewport.
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 712, clientY: 434 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 712, clientY: 434 });

    const [obj] = allObjects(doc);
    expect(obj.type).toBe('text');
    expect(obj.x).toBe(200);
    expect(obj.y).toBe(50);

    // The tool reverted to Select and the new text is in edit mode.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-editor')).toBeVisible();
    expect(screen.getByTestId('text-textarea')).toHaveFocus();
  });

  it('TC-18: N still creates a sticky at the view centre (regression)', async () => {
    const doc = getDoc();

    const user = userEvent.setup();
    await user.keyboard('n');

    const [obj] = snapshot(doc);
    expect(obj.type).toBe('sticky');
    // Centred on the view centre (world 0,0): the 200x200 note spans
    // x ∈ [-100,100], y ∈ [-100,100].
    expect(obj.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(obj.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(screen.getByTestId('sticky-note')).toBeVisible();
    // The tool is unchanged (Select).
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });
});
