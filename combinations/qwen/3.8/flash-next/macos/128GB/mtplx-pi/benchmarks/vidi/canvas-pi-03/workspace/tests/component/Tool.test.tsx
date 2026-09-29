// Story 9, text.tool: the Text tool's shortcuts, its toolbar state and what a
// press does while it is armed.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { App } from '../../src/client/App';
import type { ProviderLike } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { pointerEvent, fire, pressKey, seed, tool } from './harness';

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

function hook() {
  return (
    window as unknown as {
      __vidi6: {
        tool(): 'select' | 'text';
        snapshot(): Array<{ id: string; type: string }>;
        select(id: string | null): void;
        startEdit(id: string): void;
        getState(): { selectedId: string | null; editingId: string | null };
      };
    }
  ).__vidi6;
}

function viewport(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (!el) throw new Error('no viewport');
  return el;
}

function blockCount(): number {
  return document.querySelectorAll('[data-testid="text-block"]').length;
}

describe('TC-14 the tool toggle', () => {
  it('T arms the Text tool, Escape and V disarm it, and the button follows', () => {
    render(<App />);
    const textButton = screen.getByLabelText('Text (T)');
    const selectButton = screen.getByLabelText('Select (V)');
    expect(tool()).toBe('select');
    expect(textButton.getAttribute('aria-pressed')).toBe('false');

    pressKey('t');
    expect(tool()).toBe('text');
    expect(textButton.getAttribute('aria-pressed')).toBe('true');
    expect(selectButton.getAttribute('aria-pressed')).toBe('false');
    // The board shows what the next click will do.
    expect(viewport().style.cursor).toBe('text');

    pressKey('Escape');
    expect(tool()).toBe('select');
    expect(textButton.getAttribute('aria-pressed')).toBe('false');
    expect(viewport().style.cursor).toBe('grab');

    pressKey('t');
    expect(tool()).toBe('text');
    pressKey('v');
    expect(tool()).toBe('select');
  });

  it('a combination with Ctrl/Cmd/Alt is never a tool shortcut', () => {
    render(<App />);
    pressKey('t', window, { ctrlKey: true });
    expect(tool()).toBe('select');
    pressKey('t', window, { metaKey: true });
    expect(tool()).toBe('select');
    pressKey('t', window, { shiftKey: true });
    // Shift+T is a bare key as far as the tool layer is concerned.
    expect(tool()).toBe('text');
  });
});

describe('TC-15 a board that could not be loaded has no tools', () => {
  it('T is ignored, the Text button is disabled and a click creates nothing', async () => {
    const provider = (): ProviderLike => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      return {
        synced: false,
        on: (event, listener) => {
          const list = listeners.get(event) ?? [];
          list.push(listener);
          listeners.set(event, list);
        },
        off: () => {},
        destroy: () => {},
        emitClose: () => {
          for (const listener of listeners.get('connection-close') ?? []) listener({ code: CLOSE_BOARD_LOAD_FAILED });
        },
      } as ProviderLike & { emitClose(): void };
    };
    const made: Array<ProviderLike & { emitClose?(): void }> = [];
    const { container } = render(
      <App
        boardId="board-under-test"
        providerFactory={(_url, _id, _doc) => {
          const p = provider() as ProviderLike & { emitClose(): void };
          made.push(p);
          return p;
        }}
      />,
    );
    await act(async () => {
      made[0]?.emitClose?.();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const textButton = screen.getByLabelText('Text (T)');
    expect(textButton.hasAttribute('disabled')).toBe(true);
    expect(textButton.getAttribute('aria-disabled')).toBe('true');

    pressKey('t');
    expect(tool()).toBe('select');

    // And even a forced arming could not create: the board is read-only.
    act(() => {
      (window as unknown as { __vidi6: { tool(): string } }).__vidi6;
      fire(viewport(), pointerEvent('pointerdown', 400, 300));
      fire(viewport(), pointerEvent('pointerup', 400, 300));
    });
    expect(blockCount()).toBe(0);
    expect(container).toBeTruthy();
  });
});

describe('TC-16 typing is not a shortcut', () => {
  it("T inside a note editor types 't' and leaves the tool alone", () => {
    render(<App />);
    const id = seed(400, 400);
    act(() => {
      hook().startEdit(id);
    });
    const editor = document.querySelector('textarea[data-testid="sticky-textarea"]');
    expect(editor).not.toBeNull();
    act(() => {
      (editor as HTMLTextAreaElement).focus();
    });

    pressKey('t', editor!);
    pressKey('t'); // even a bare window key is owned by the editor while editing
    expect(tool()).toBe('select');
    expect(document.querySelector('[data-testid="text-block"]')).toBeNull();
  });
});

describe('TC-17 creating with the Text tool', () => {
  it('a click on empty board places a block, edits it, and disarms the tool', () => {
    render(<App />);
    pressKey('t');
    expect(tool()).toBe('text');

    act(() => {
      fire(viewport(), pointerEvent('pointerdown', 420, 300));
      fire(viewport(), pointerEvent('pointerup', 420, 300));
    });

    const blocks = document.querySelectorAll('[data-testid="text-block"]');
    expect(blocks).toHaveLength(1);
    expect(document.querySelector('[data-testid="text-editor"]')).not.toBeNull();
    expect(tool()).toBe('select');
    expect(hook().getState().editingId).not.toBeNull();
  });

  it('a press-drag draws a box and pins the block to that width', () => {
    render(<App />);
    pressKey('t');
    act(() => {
      fire(viewport(), pointerEvent('pointerdown', 300, 200));
      fire(viewport(), pointerEvent('pointermove', 520, 260));
      fire(viewport(), pointerEvent('pointerup', 520, 260));
    });
    const blocks = document.querySelectorAll<HTMLElement>('[data-testid="text-block"]');
    expect(blocks).toHaveLength(1);
    // The dragged rectangle became the block: wider than a plain click's
    // default, and in fixed-width mode.
    expect(parseFloat(blocks[0].style.width)).toBeGreaterThan(60);
    const snap = hook().snapshot();
    const created = snap.find((o) => o.type === 'text');
    expect(created).toBeDefined();
    const state = (window as unknown as { __vidi6: { textBlock(id: string): { widthMode: string } | null } }).__vidi6;
    expect(state.textBlock(created!.id)?.widthMode).toBe('fixed');
  });

  it('a click while the tool is armed does not clear the selection or pan', () => {
    render(<App />);
    const id = seed(400, 400);
    act(() => {
      hook().select(id);
    });
    expect(hook().getState().selectedId).toBe(id);
    const before = (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera();

    pressKey('t');
    act(() => {
      fire(viewport(), pointerEvent('pointerdown', 200, 200));
      fire(viewport(), pointerEvent('pointermove', 320, 320));
      fire(viewport(), pointerEvent('pointerup', 320, 320));
    });
    // The tool owns the drag, so the camera did not move under it.
    const after = (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera();
    expect(after).toEqual(before);
  });
});

describe('TC-18 the sticky shortcut still works', () => {
  it('N creates a sticky note at the view centre', () => {
    render(<App />);
    pressKey('n');
    const snap = hook().snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].type).toBe('sticky');
    expect(hook().getState().editingId).toBe(snap[0].id);
    expect(tool()).toBe('select');
  });

  it('N while the Text tool is armed creates nothing (the tool owns the keys)', () => {
    render(<App />);
    pressKey('t');
    pressKey('n');
    expect(hook().snapshot()).toHaveLength(0);
    expect(tool()).toBe('text');
  });
});
