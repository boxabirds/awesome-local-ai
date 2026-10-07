import { act, screen } from '@testing-library/react';
import type { TextSnapshot } from '../../src/shared/objects/text';
import type { SeedText } from '../../src/client/canvas/testHooks';
import { dispatchKey, dispatchPointer } from './util';
import { clickWithPointer, getSelection, getSnapshot, hook, viewportEl } from './stickyUtil';

/** Every text object on the board, in paint order (story 9). */
export function getTexts(): readonly TextSnapshot[] {
  return hook().getTexts();
}

export function textEls(): HTMLElement[] {
  return screen.queryAllByTestId('text-object');
}

export function textEl(index = 0): HTMLElement {
  const el = textEls()[index];
  if (!el) throw new Error(`no text object at index ${index}`);
  return el;
}

/** The tool the board is in, read from the viewport the user is looking at. */
export function toolState(): 'select' | 'text' {
  return viewportEl().getAttribute('data-tool') === 'text' ? 'text' : 'select';
}

export function toolButton(tool: 'select' | 'text'): HTMLButtonElement {
  return screen.getByTestId(tool === 'text' ? 'tool-text' : 'tool-select') as HTMLButtonElement;
}

/** Create texts as fixtures (as if the board had been saved with them on it). */
export function seedTexts(specs: readonly SeedText[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedTexts(specs);
  });
  return ids;
}

export function seedText(spec: SeedText): string {
  return seedTexts([spec])[0]!;
}

/**
 * The Text tool's whole gesture: press T, click at a screen point, and the board is
 * writing a text there. Returns the new object.
 */
export function createTextAt(x: number, y: number): TextSnapshot {
  dispatchKey({ key: 't' });
  clickWithPointer(viewportEl(), { x, y });
  const texts = getTexts();
  return texts[texts.length - 1]!;
}

/** Type into the text editor that the board just opened. */
export function typeIntoText(text: string): void {
  const input = screen.getByTestId('text-object-input') as HTMLTextAreaElement;
  act(() => {
    input.focus();
    // One character at a time, because each keystroke is a transaction of its own.
    for (const char of text) {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

/**
 * Shift-drag a rubber band over the board: story 3's way of selecting several
 * objects at once, which is how a text and a note end up in one selection.
 */
export async function marquee(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const vp = viewportEl();
  dispatchPointer(vp, 'pointerdown', { pointerId: 3, clientX: from.x, clientY: from.y, shiftKey: true });
  dispatchPointer(vp, 'pointermove', { pointerId: 3, clientX: to.x, clientY: to.y });
  dispatchPointer(vp, 'pointerup', { pointerId: 3, clientX: to.x, clientY: to.y });
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
  });
}

/**
 * A key pressed with the text editor holding the caret. jsdom needs the event on the
 * focused element itself, because that is where a real keystroke starts.
 */
export function pressKey(key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  const input = screen.getByTestId('text-object-input');
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: opts.ctrlKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** Click a text with the pointer, in the Select tool (selects it). */
export function clickText(at = { x: 10, y: 10 }, index = 0): void {
  clickWithPointer(textEl(index), at);
}

/** Start editing an existing text the way a person does: double-click it. */
export function editText(at = { x: 10, y: 10 }, index = 0): void {
  const el = textEl(index);
  dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: at.x, clientY: at.y });
  dispatchPointer(el, 'pointerup', { pointerId: 1, clientX: at.x, clientY: at.y });
  const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** The id being edited right now, of either kind. */
export function editingId(): string | null {
  return getSelection().editingId;
}

/** Sticky notes only, so a test can tell the two kinds apart. */
export function noteCount(): number {
  return getSnapshot().length;
}
