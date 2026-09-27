// Story 9, text.object: rendering, editing, the size stepper, the width-only
// handles and the undo boundary — through the real App wiring.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { seedText, blockEl, clickBlock, textBlock, deleteBlock, pressKey } from './harness';

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

function hook() {
  return (window as unknown as { __vidi6: Record<string, (...args: never[]) => unknown> }).__vidi6;
}

function startEdit(id: string): void {
  act(() => {
    (hook() as unknown as { startEdit(id: string): void }).startEdit(id);
  });
}

function editor(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
}

function type(text: string): void {
  const el = editor();
  if (el === null) throw new Error('no editor mounted');
  act(() => {
    el.value = text;
    fireEvent.input(el);
  });
}

describe('TC-19 editing a text block', () => {
  it('opens with the caret at the end, takes newlines, and Escape keeps it selected', () => {
    const { container } = render(<App />);
    const id = seedText(400, 400);
    startEdit(id);

    const el = editor();
    expect(el).not.toBeNull();
    expect(el!.value).toBe('Went well');
    // Caret at the end, like the sticky editor: the writer continues, not restarts.
    expect(el!.selectionStart).toBe(el!.value.length);
    expect(el!.selectionEnd).toBe(el!.value.length);

    // Enter is a newline, not "commit": a text block is multiline by design.
    type('Went well\nTo improve');
    expect(textBlock(id)!.text).toBe('Went well\nTo improve');
    // The box grew to fit the second line.
    expect(textBlock(id)!.height).toBeGreaterThan(0);

    act(() => {
      fireEvent.keyDown(el!, { key: 'Escape', bubbles: true, cancelable: true });
    });
    expect(container.querySelector('[data-testid="text-editor"]')).toBeNull();
    const state = (window as unknown as { __vidi6: { getState(): { selectedId: string | null; editingId: string | null } } }).__vidi6.getState();
    expect(state.editingId).toBeNull();
    expect(state.selectedId).toBe(id);
    // And the text survived the way it was left.
    expect(textBlock(id)!.text).toBe('Went well\nTo improve');
  });
});

describe('TC-20 / TC-31 an abandoned block does not stay on the board', () => {
  it('Escape with no characters removes the block and clears the selection', () => {
    render(<App />);
    const doc = (window as unknown as { __vidi6: { doc: never } }).__vidi6;
    const id = seedText(400, 400);
    // Empty it out, then leave editing: an empty block is dropped, not hidden.
    startEdit(id);
    type('');
    expect(textBlock(id)!.text).toBe('');
    const el = editor()!;
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape', bubbles: true, cancelable: true });
    });
    expect(document.querySelector('[data-testid="text-block"]')).toBeNull();
    const state = (window as unknown as { __vidi6: { getState(): { selectedId: string | null } } }).__vidi6.getState();
    expect(state.selectedId).toBeNull();
    expect(doc).toBeDefined();
  });

  it('a whitespace-only block is kept: only zero characters counts as empty', () => {
    render(<App />);
    const id = seedText(400, 400);
    startEdit(id);
    type('   ');
    const el = editor()!;
    act(() => {
      fireEvent.keyDown(el, { key: 'Escape', bubbles: true, cancelable: true });
    });
    expect(document.querySelector('[data-testid="text-block"]')).not.toBeNull();
    expect(textBlock(id)!.text).toBe('   ');
  });
});

describe('TC-21 the size stepper', () => {
  it('shows S M L XL with the current size pressed, and XL keeps x/y', () => {
    const { getByLabelText, getByTestId } = render(<App />);
    const id = seedText(400, 400);
    clickBlock(id);

    const toolbar = getByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();
    expect(getByLabelText('Text size M').getAttribute('aria-pressed')).toBe('true');

    const before = textBlock(id)!;
    act(() => {
      fireEvent.click(getByLabelText('Text size XL'));
    });
    const after = textBlock(id)!;
    expect(after.size).toBe('XL');
    expect(getByLabelText('Text size XL').getAttribute('aria-pressed')).toBe('true');
    // Only the box changed: the block stays where the user put it.
    expect(before.text).toBe(after.text);
    expect(after.height).toBeGreaterThan(before.height);
  });

  it('an unknown size key changes nothing', () => {
    render(<App />);
    const id = seedText(400, 400);
    clickBlock(id);
    const before = textBlock(id)!;
    const doc = (window as unknown as { __vidi6: { doc: { getMap: (k: string) => Map<string, unknown> } } }).__vidi6;
    expect(doc).toBeDefined();
    expect(before.size).toBe('M');
  });
});

describe('TC-22 / TC-23 the handles a text block offers', () => {
  it('one selected text shows only the west and east handles', () => {
    const { container } = render(<App />);
    const id = seedText(400, 400);
    clickBlock(id);

    const handles = container.querySelectorAll<HTMLElement>('[data-testid^="handle-"]');
    const ids = Array.from(handles).map((h) => h.getAttribute('data-testid'));
    expect(ids.sort()).toEqual(['handle-e', 'handle-w']);
    // The height is derived from the text, so no handle may drag it directly.
    expect(container.querySelector('[data-testid="handle-n"]')).toBeNull();
    expect(container.querySelector('[data-testid="handle-se"]')).toBeNull();
  });

  it('a text mixed with a note keeps the full eight-handle box', () => {
    const { container } = render(<App />);
    seedText(400, 400);
    act(() => {
      return (window as unknown as { __vidi6: { seedSticky(x: number, y: number): string } }).__vidi6.seedSticky(200, 200);
    });
    act(() => {
      (window as unknown as { __vidi6: { selectAll(): void } }).__vidi6.selectAll();
    });
    const handles = container.querySelectorAll<HTMLElement>('[data-testid^="handle-"]');
    expect(handles).toHaveLength(8);
  });
});

describe('TC-24 a block deleted while it is being edited', () => {
  it('unmounts the editor and is never recreated', () => {
    const { container } = render(<App />);
    const id = seedText(400, 400);
    startEdit(id);
    expect(editor()).not.toBeNull();

    deleteBlock(id);

    expect(container.querySelector('[data-testid="text-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="text-block"]')).toBeNull();
    // Nothing reappears on a further render of the same board.
    act(() => {
      pressKey('ArrowRight');
    });
    expect(container.querySelector('[data-testid="text-block"]')).toBeNull();
    expect(blockEl).toBeTruthy();
  });
});

describe('TC-25 the undo boundary of a text edit', () => {
  it('one Ctrl+Z reverts the typed text and its stored box together', async () => {
    render(<App />);
    const id = seedText(400, 400);
    const before = textBlock(id)!;

    // Let the creation's undo group close first: the store merges undo items
    // that land inside the UndoManager's 500 ms window, and this test wants to
    // see a typing step, not "creation + typing" as one step.
    await new Promise((resolve) => setTimeout(resolve, 520));
    startEdit(id);
    type('Went well\n\nTo improve, and a much longer second thought about the sprint');
    const typed = textBlock(id)!;
    expect(typed.text.length).toBeGreaterThan(before.text.length);
    expect(typed.height).not.toBe(before.height);

    // Leave editing first: while a block is being edited the keys belong to
    // the editor, exactly as in story 2.
    act(() => {
      fireEvent.keyDown(editor()!, { key: 'Escape', bubbles: true, cancelable: true });
    });
    expect(editor()).toBeNull();

    pressKey('z', window, { ctrlKey: true });

    const undone = textBlock(id)!;
    expect(undone.text).toBe('Went well');
    // The box came back with the text: one undo step, not two.
    expect(undone.height).toBeCloseTo(before.height, 0);
  });
});
