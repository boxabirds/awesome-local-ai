// Story 9 component tests: the text object — editing, toolbar, handles,
// resize-in-mixed-selection, remote deletion and undo (TC-19 to TC-25).

import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { TEXT_SIZES } from '../../src/shared/config';
import {
  click,
  dragTo,
  flushRaf,
  hooks,
  pointerUp,
  renderApp,
  typeIntoEditor,
} from './helpers';

function dblclick(el: Element): void {
  fireEvent.dblClick(el);
}

function editor(): HTMLTextAreaElement {
  const el = screen.queryByTestId('text-editor');
  if (!el) throw new Error('no text editor rendered');
  return el as HTMLTextAreaElement;
}

/** Create a text object through the model and return its id. */
function addText(x: number, y: number, text = ''): string {
  let id = '';
  act(() => {
    id = createText(hooks().doc, { x, y }, 'g_test') ?? '';
  });
  if (text !== '') {
    act(() => {
      // Default (null) origin: a plain sync change — deterministic box (the
      // initial estimate), and not captured by the undo controller.
      getTextContent(hooks().doc, id)!.insert(0, text);
    });
  }
  return id;
}

function textObj(id: string): {
  x: number;
  y: number;
  width: number;
  height: number;
  size?: string;
  widthMode?: 'auto' | 'fixed';
} | undefined {
  return hooks().getObjects().find((o) => o.id === id);
}

function textContent(id: string): string {
  return getTextContent(hooks().doc, id)!.toString();
}

function theTextEl(): HTMLElement {
  const el = screen.queryByTestId('text-object');
  if (!el) throw new Error('text object not found');
  return el;
}

function handleEl(name: string): HTMLElement {
  const el = screen.queryByRole('button', { name: `Resize ${name}` });
  if (!el) throw new Error(`handle "${name}" not found`);
  return el;
}

describe('text object (component)', () => {
  it('TC-19: double-click focuses the editor, caret at the end; Enter inserts a newline; Escape keeps the selection', async () => {
    await renderApp();
    const id = addText(0, 0, 'hi');
    const el = theTextEl();
    click(el);
    dblclick(el);
    const ta = editor();
    expect(ta).toHaveFocus();
    expect(ta.selectionStart).toBe(2);
    expect(ta.selectionEnd).toBe(2);

    // Enter inserts a newline (simulating the editor's input).
    ta.value = 'hi\n';
    fireEvent.input(ta, { target: { value: 'hi\n' } });
    expect(textContent(id)).toBe('hi\n');

    // Escape exits editing, keeps the text AND the selection.
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(textContent(id)).toBe('hi\n');
    expect(theTextEl()).toHaveAttribute('data-selected');
  });

  it('TC-20: an edit that ends empty deletes the text and clears the selection', async () => {
    await renderApp();
    addText(0, 0); // empty text, initial estimate box
    const el = theTextEl();
    click(el);
    dblclick(el);
    expect(editor()).toBeInTheDocument();

    // Escape with zero characters: the object is deleted.
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(hooks().getObjects()).toHaveLength(0);
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
    expect(el).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('TC-21: a single selected text shows S/M/L/XL with aria-pressed; XL re-measures without moving', async () => {
    await renderApp();
    const id = addText(10, 20, 'title');
    const el = theTextEl();
    click(el);

    expect(screen.getByRole('toolbar', { name: 'Text options' })).toBeInTheDocument();
    for (const s of ['S', 'M', 'L', 'XL']) {
      expect(screen.getByRole('button', { name: `Size ${s}` })).toHaveAttribute(
        'aria-pressed',
        s === 'M' ? 'true' : 'false',
      );
    }

    const before = textObj(id)!;
    fireEvent.click(screen.getByRole('button', { name: 'Size XL' }));
    const after = textObj(id)!;
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The pressed state follows the model.
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('TC-22: a single selected text exposes exactly the left/right handles', async () => {
    await renderApp();
    addText(0, 0, 'hi');
    click(screen.getByTestId('text-object'));

    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'))
      .filter((l) => l?.startsWith('Resize'));
    expect(names.sort()).toEqual(['Resize left', 'Resize right']);
  });

  it('TC-23: a mixed sticky+text selection keeps eight handles; resizing repositions the text proportionally, never resizes it', async () => {
    await renderApp();
    act(() => {
      hooks().createNoteAt(0, 0, 'yellow', 'note');
    });
    const textId = addText(300, 0, 'label');

    // Select the text, then shift-click the note: both are selected.
    // (The note's top-left is at world (−100,−100); the click lands on the
    // text-side of the union only through the note element's own rect.)
    click(screen.getByTestId('text-object'));
    const noteEl = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(noteEl, {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true,
      bubbles: true,
    });
    fireEvent.pointerUp(noteEl, {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
      shiftKey: true,
      bubbles: true,
    });
    await flushRaf();

    // All eight handles are back.
    for (const name of ['top', 'bottom', 'left', 'right']) {
      expect(handleEl(name)).toBeInTheDocument();
    }

    // The note is centred on (0,0) → (−100,−100,200,200); the text is
    // (300,0,40,26); the union is (−100,−100,440,200). Widen the union by 60
    // on the right edge: the common scale x is 500/440 and the text is
    // repositioned by exactly that ratio.
    const t0 = textObj(textId)!;
    dragTo(handleEl('right'), 60, 0, 2);
    pointerUp(handleEl('right'), 60, 0);
    await flushRaf();

    const t1 = textObj(textId)!;
    expect(t1.x).toBeCloseTo(-100 + 400 * (500 / 440), 3);
    expect(t1.width).toBe(t0.width); // never resized
    expect(t1.height).toBe(t0.height);
    expect(t1.size).toBe(t0.size); // font size unchanged
  });

  it('TC-24: a remote deletion while editing unmounts the editor without crashing', async () => {
    await renderApp();
    const id = addText(0, 0, 'hi');
    const el = theTextEl();
    click(el);
    dblclick(el);
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();

    // A peer deletes the object through the real doc (remote origin).
    act(() => {
      hooks().doc.transact(() => {
        hooks().doc.getMap('objects').delete(id);
      }, 'remote-peer');
    });

    expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-object')).not.toBeInTheDocument();
    expect(hooks().getObjects()).toHaveLength(0);
  });

  it('TC-25: typing + box remeasure are one undo step: Ctrl+Z reverts both together', async () => {
    await renderApp();
    const id = addText(0, 0);
    const el = theTextEl();
    click(el);
    dblclick(el);
    const ta = editor();

    typeIntoEditor(ta, 'abc');
    // The box was re-measured locally (estimate fallback: 3 × 20 × 0.6).
    const mid = textObj(id)!;
    expect(textContent(id)).toBe('abc');
    expect(mid.width).toBeCloseTo(3 * TEXT_SIZES.M * 0.6, 5);

    // One Ctrl+Z reverts the text AND the box in the same step.
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    expect(textContent(id)).toBe('');
    const after = textObj(id)!;
    expect(after.width).toBe(40); // initial estimate restored
    expect(after.height).toBe(26);
    expect(screen.getByTestId('text-editor')).toBeInTheDocument(); // still editing
  });
});
