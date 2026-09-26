import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, act, render, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '@/client/App';
import { renderFullApp, hooks, makeNote, firePointer, pressKey, typeText } from './story2';

// Story 5: the board page checks existence before rendering the board.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// TC-15 (load-failure lock) needs a mocked useBoardDoc like story 4's tests.
// Other tests keep the real hook: the mock falls back to it unless a test
// installs a fake board state in `boardDocMock.current`.
const { boardDocMock } = vi.hoisted(() => ({
  boardDocMock: { current: null as null | { doc: Y.Doc; objects: never[]; connectionState: string } },
}));
vi.mock('@/client/board/useBoardDoc', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/client/board/useBoardDoc')>();
  return {
    ...real,
    useBoardDoc: vi.fn((...args: Parameters<typeof real.useBoardDoc>) =>
      boardDocMock.current ?? real.useBoardDoc(...args),
    ),
  };
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  boardDocMock.current = null;
});

function selectButton(): HTMLButtonElement {
  return screen.getByTestId('select-tool-button') as HTMLButtonElement;
}
function textButton(): HTMLButtonElement {
  return screen.getByTestId('text-tool-button') as HTMLButtonElement;
}

function pressKeyOnWindow(key: string, init?: KeyboardEventInit): void {
  pressKey(window, key, init);
}

describe('story 9: tool mode (text.tool_ui)', () => {
  it('TC-14: T activates the Text tool, Escape returns to Select, V does too', async () => {
    await renderFullApp();
    // Initial state: Select pressed, Text not.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    pressKeyOnWindow('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    pressKeyOnWindow('Escape');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');

    pressKeyOnWindow('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    pressKeyOnWindow('v');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-14 (buttons): clicking the tool buttons switches the tool', async () => {
    await renderFullApp();
    act(() => {
      textButton().click();
    });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      selectButton().click();
    });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-15: with a failed board load, T is ignored and the Text button is disabled', async () => {
    window.history.pushState({}, '', '/b/abcdefghij0123456789ab');
    const doc = new Y.Doc();
    boardDocMock.current = { doc, objects: [], connectionState: 'load_failed' };

    render(<App />);
    await screen.findByTestId('board-viewport', undefined, { timeout: 5000 });

    expect(textButton()).toBeDisabled();
    pressKeyOnWindow('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    // No object was created.
    expect(hooks().getObjects()).toHaveLength(0);
  });

  it('TC-16: pressing T while editing a sticky types the character, tool unchanged (negative)', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    // Select the note and start editing (Enter on a single selection).
    const note = hooks().getNotes().find((n) => n.id === id)!;
    const el = document.querySelector(`[data-id="${id}"]`)!;
    firePointer(el, 'pointerdown', note.x + 100 + 512, note.y + 100 + 384);
    firePointer(el, 'pointerup', note.x + 100 + 512, note.y + 100 + 384);
    pressKeyOnWindow('Enter');
    const ta = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    // T is pressed with the editor focused: the key goes to the editor, not
    // the tool.
    pressKey(ta, 't');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    // The character can be typed into the note.
    typeText(ta, 't');
    expect(hooks().getNotes().find((n) => n.id === id)?.text).toBe('t');
  });

  it('TC-17: Text active + board click creates text at the click point, tool back to Select', async () => {
    await renderFullApp();
    pressKeyOnWindow('t');
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    // Click empty board space at screen (300, 200) -> world (-212, -184).
    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 300, 200);
    firePointer(viewport, 'pointerup', 300, 200);

    const objects = hooks().getObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      type: 'text',
      x: -212,
      y: -184,
      size: 'M',
      widthMode: 'auto',
    });
    // Tool returned to Select; the new object is selected and editing.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(hooks().getSelection()).toEqual([objects[0].id]);
    expect(screen.getByTestId('text-textarea')).toBeInTheDocument();
  });

  it('TC-17 (drag with the Text tool is not a pan): movement between down/up creates nothing', async () => {
    await renderFullApp();
    pressKeyOnWindow('t');
    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 300, 200);
    firePointer(viewport, 'pointermove', 340, 220);
    firePointer(viewport, 'pointerup', 340, 220);
    expect(hooks().getObjects()).toHaveLength(0);
    // The camera did not move either.
    expect(hooks().getCamera()).toEqual({ x: -512, y: -384, zoom: 1 });
  });

  it('TC-18: N creates a sticky at the view centre (story 2 regression)', async () => {
    await renderFullApp();
    pressKeyOnWindow('n');
    const notes = hooks().getNotes();
    expect(notes).toHaveLength(1);
    // The sticky is centred on the view centre (0, 0): top-left at (-100, -100).
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
    // N does not switch the tool.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('regression: double-click on empty board still creates a sticky with the Select tool', async () => {
    await renderFullApp();
    const viewport = screen.getByTestId('board-viewport');
    act(() => {
      viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
    });
    const notes = hooks().getNotes();
    expect(notes).toHaveLength(1);
    // Centred on the click point (world -212, -184).
    expect(notes[0].x).toBe(-312);
    expect(notes[0].y).toBe(-284);
  });
});
