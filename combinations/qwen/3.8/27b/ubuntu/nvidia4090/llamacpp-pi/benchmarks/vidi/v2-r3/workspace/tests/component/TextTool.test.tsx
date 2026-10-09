/**
 * Story 9 component tests (TC-14 to TC-18): tool mode and the Text tool.
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { renderBoard } from './board-harness';

// Quiet provider; the mock also exposes the state handler on globalThis so a
// test can simulate a load failure after mount.
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    const g = globalThis as Record<string, unknown>;
    g.__vidi6_conn_handler = onState;
    onState((g.__vidi6_conn_state as string | undefined) ?? 'connected');
    return {
      destroy() {
        if (g.__vidi6_conn_handler === onState) delete g.__vidi6_conn_handler;
      },
    };
  },
}));

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  delete (globalThis as Record<string, unknown>).__vidi6_conn_handler;
  cleanup();
});

const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
const textBtn = () => screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const textLayer = () => h.container.querySelector('[data-text-tool-layer]') as HTMLElement | null;

describe('text.tool_ui', () => {
  it('TC-14: T arms Text; Escape and V return to Select', () => {
    expect(pressed(selectBtn())).toBe(true);
    expect(textLayer()).toBeNull();

    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textBtn())).toBe(true);
    expect(pressed(selectBtn())).toBe(false);
    expect(textLayer()).not.toBeNull(); // the text-tool click layer is live

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(pressed(selectBtn())).toBe(true);
    expect(textLayer()).toBeNull();

    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textBtn())).toBe(true);
    fireEvent.keyDown(window, { key: 'v' });
    expect(pressed(selectBtn())).toBe(true);
  });

  it('TC-15: canEdit false → Text disabled, T ignored, active Text reverts to Select', () => {
    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(textBtn())).toBe(true);

    // The board load fails after the tool was armed.
    act(() => {
      const g = globalThis as Record<string, unknown>;
      (g.__vidi6_conn_handler as (s: string) => void)('load_failed');
    });
    expect(textBtn().disabled).toBe(true);
    expect(pressed(selectBtn())).toBe(true); // the active Text tool reverted
    expect(pressed(textBtn())).toBe(false);

    fireEvent.keyDown(window, { key: 't' });
    expect(pressed(selectBtn())).toBe(true); // T is ignored
    expect(textLayer()).toBeNull();
  });

  it('TC-16: T while editing a note types "t" — the tool stays Select', () => {
    h.seed((doc) => {
      createSticky(doc, { x: 100, y: 100 });
    });
    const note = h.container.querySelector('[data-note-id]') as HTMLElement;
    fireEvent.doubleClick(note);
    const textarea = screen.getByLabelText('Note text') as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: 't' });
    expect(pressed(selectBtn())).toBe(true); // the shortcut was ignored
    expect(textLayer()).toBeNull();
  });

  it('TC-17: Text active + click on the board → text at the click point, Select restored, editor mounted', () => {
    fireEvent.keyDown(window, { key: 't' });
    expect(textLayer()).not.toBeNull();

    // Click at screen (300, 200); camera (0,0,1) → world (300, 200).
    fireEvent.click(textLayer()!, { clientX: 300, clientY: 200 });

    // The tool returns to Select immediately.
    expect(pressed(selectBtn())).toBe(true);
    expect(textLayer()).toBeNull();

    // The text object exists at the click point (top-left) and its editor is
    // mounted for the new id.
    const textEl = h.container.querySelector('[data-text-id]') as HTMLElement;
    expect(textEl).not.toBeNull();
    expect(textEl.style.left).toBe('300px');
    expect(textEl.style.top).toBe('200px');
    expect(screen.getByLabelText('Text')).toBeTruthy();
  });

  it('TC-18: N creates a sticky at the view centre and leaves the tool Select', () => {
    expect(h.container.querySelectorAll('[data-note-id]')).toHaveLength(0);

    fireEvent.keyDown(window, { key: 'n' });

    const notes = h.container.querySelectorAll('[data-note-id]');
    expect(notes).toHaveLength(1);
    const note = notes[0] as HTMLElement;
    // View centre at camera (0,0,1): (innerWidth/2, innerHeight/2); the
    // sticky is centred on the click point.
    expect(note.style.left).toBe(`${window.innerWidth / 2 - STICKY_SIZE_WORLD / 2}px`);
    expect(note.style.top).toBe(`${window.innerHeight / 2 - STICKY_SIZE_WORLD / 2}px`);
    expect(pressed(selectBtn())).toBe(true);
    expect(textLayer()).toBeNull();
  });
});
