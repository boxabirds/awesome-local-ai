// Text object component tests (story 9, TC-19 to TC-25): editing semantics
// (caret, newline, escape), empty-text removal, the TextToolbar sizes, the
// e/w-only handles, mixed-selection resize, remote delete during edit, and
// one-step undo of typing.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  createText,
  getTextContent,
  setTextWidthFixed,
  type TextSnapshot,
} from '../../src/shared/objects/text';
import { TEXT_MIN_WIDTH_WORLD } from '../../src/shared/config';
import {
  dispatch,
  flushRaf,
  installResizeObserverMock,
  inputValue,
  keyOn,
  viewportEl,
  windowKey,
  pointerEvent,
} from './helpers';
import {
  board,
  dispatchOn,
  handleEl,
  keyedPointerEvent,
  screenX,
  screenY,
  setConnection,
} from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => cleanup());

function textEls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="text-object"]'));
}

function textEditor(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"] textarea');
  if (el === null) throw new Error('text editor not mounted');
  return el;
}

function textOf(doc: Y.Doc, id: string): string {
  const t = getTextContent(doc, id);
  return t === undefined ? '' : t.toString();
}

/** T tool, then a board click at (screen) (sx, sy). */
function createTextAt(sx: number, sy: number): void {
  const container = document.body;
  windowKey('t');
  const vp = viewportEl(container as HTMLElement);
  dispatch(vp, pointerEvent('pointerdown', sx, sy));
  dispatch(vp, pointerEvent('pointerup', sx, sy));
}

describe('text.object', () => {
  it('TC-19 caret at end; Enter inserts a newline; Escape ends and keeps text selected', async () => {
    const { container, doc } = await board();

    // A text seeded with content: editing starts with the caret at the end.
    act(() => {
      const id = createText(doc, { x: 0, y: 0 }, 'c1');
      if (id !== null) getTextContent(doc, id)!.insert(0, 'Hi');
    });
    const el = textEls(container).find((n) => n.textContent === 'Hi');
    if (el === undefined) throw new Error('seeded text not rendered');
    dispatchOn(el, keyedPointerEvent('pointerdown', screenX(0), screenY(0)));
    dispatchOn(el, keyedPointerEvent('pointerup', screenX(0), screenY(0)));
    dispatchOn(el, new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const ta = textEditor();
    expect(ta.selectionStart).toBe(2); // caret at end of 'Hi'

    // Enter: not intercepted — the edit continues (editor stays mounted),
    // and the newline lands in the Y.Text.
    keyOn(ta, 'Enter');
    expect(document.querySelector('[data-testid="text-editor"]')).not.toBeNull();
    inputValue(ta, 'Hi\n');
    expect(textOf(doc, el.dataset.id!)).toBe('Hi\n');

    // Escape: ends editing, keeps the text selected, content preserved.
    keyOn(ta, 'Escape');
    expect(document.querySelector('[data-testid="text-editor"]')).toBeNull();
    const after = textEls(container);
    expect(after).toHaveLength(1);
    const selected = after.find((n) => n.dataset.id === el.dataset.id);
    expect(selected?.hasAttribute('data-selected')).toBe(true);
    expect(textOf(doc, el.dataset.id!)).toBe('Hi\n');
  });

  it('TC-20 Escape with zero characters → object removed, selection cleared', async () => {
    const { container, doc } = await board();
    createTextAt(700, 450);
    const ta = textEditor();
    expect(snapshot(doc).filter((o) => o.type === 'text')).toHaveLength(1);

    keyOn(ta, 'Escape');

    expect(snapshot(doc).filter((o) => o.type === 'text')).toHaveLength(0);
    // No invisible text element and no lingering selection.
    expect(textEls(container)).toHaveLength(0);
    expect(container.querySelector<HTMLElement>('[data-selected]')).toBeNull();
  });

  it('TC-21 TextToolbar shows S/M/L/XL with M pressed; XL → size XL, x/y unchanged', async () => {
    const { container, doc } = await board();
    createTextAt(700, 450);
    const ta = textEditor();
    inputValue(ta, 'Hi');
    keyOn(ta, 'Escape');

    const bar = container.querySelector<HTMLElement>('[data-testid="text-toolbar"]');
    if (bar === null) throw new Error('TextToolbar not rendered');
    const sizes = ['S', 'M', 'L', 'XL'].map(
      (s) => bar.querySelector<HTMLElement>(`[data-testid="text-size-${s}"]`),
    );
    for (const s of sizes) expect(s).not.toBeNull();
    expect(sizes[1]?.getAttribute('aria-pressed')).toBe('true'); // M is the default
    expect(sizes[3]?.getAttribute('aria-pressed')).toBe('false');

    const text = snapshot(doc).find((o) => o.type === 'text') as ObjectSnapshot & TextSnapshot;
    const before = { x: text.x, y: text.y };

    clickButton(sizes[3]!);
    const after = snapshot(doc).find((o) => o.type === 'text') as ObjectSnapshot & TextSnapshot;
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-22 single text selected → only e and w handles rendered', async () => {
    const { container, doc } = await board();
    act(() => {
      createText(doc, { x: 100, y: 100 }, 'c1');
    });
    const el = textEls(container)[0];
    if (el === undefined) throw new Error('text not rendered');
    dispatchOn(el, keyedPointerEvent('pointerdown', screenX(120), screenY(120)));
    dispatchOn(el, keyedPointerEvent('pointerup', screenX(120), screenY(120)));
    expect(el.hasAttribute('data-selected')).toBe(true);

    // e and w exist.
    expect(container.querySelector('[data-handle="e"]')).not.toBeNull();
    expect(container.querySelector('[data-handle="w"]')).not.toBeNull();
    // No vertical or corner handles.
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      expect(container.querySelector(`[data-handle="${h}"]`)).toBeNull();
    }
  });

  it('TC-23 text + sticky → all handles; resize moves text proportionally, size unchanged', async () => {
    const { container, doc } = await board();
    act(() => {
      const id = createText(doc, { x: 100, y: 100 }, 'c1');
      if (id !== null) setTextWidthFixed(doc, id, 200);
      createSticky(doc, { x: 400, y: 100 });
    });
    const text = textEls(container)[0];
    if (text === undefined) throw new Error('text not rendered');
    dispatchOn(text, keyedPointerEvent('pointerdown', screenX(120), screenY(120)));
    dispatchOn(text, keyedPointerEvent('pointerup', screenX(120), screenY(120)));
    // Ctrl+A: select the text and the sticky together.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    });

    // All eight handles are rendered for the mixed selection.
    for (const h of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      expect(container.querySelector(`[data-handle="${h}"]`)).not.toBeNull();
    }

    // Drag the east handle +50 world units (union 100..500 → 1.125×).
    const e = handleEl(container, 'e');
    dispatchOn(e, keyedPointerEvent('pointerdown', screenX(500), screenY(150)));
    dispatchOn(e, keyedPointerEvent('pointermove', screenX(500) + 50, screenY(150)));
    dispatchOn(e, keyedPointerEvent('pointerup', screenX(500) + 50, screenY(150)));
    await flushRaf();

    const after = snapshot(doc).find((o) => o.type === 'text') as TextSnapshot | undefined;
    expect(after).toBeDefined();
    // Fixed width scales by the group factor (200 → 225); the text is at the
    // union's left edge so its x stays 100; height and the font size preset
    // are untouched.
    expect(after!.width).toBeCloseTo(225, 0);
    expect(after!.x).toBeCloseTo(100, 0);
    expect(after!.height).toBe(26);
    expect(after!.size).toBe('M');
    // The sticky scales with the group (200 → 225) and repositions.
    const sticky = snapshot(doc).find((o) => o.type === 'sticky') as ObjectSnapshot | undefined;
    expect(sticky).toBeDefined();
    expect(sticky!.width).toBeCloseTo(225, 0);
    expect(sticky!.x).toBeCloseTo(325, 0);
  });

  it('TC-24 remote delete while editing → editor unmounts, no error, no recreation', async () => {
    const { container, doc } = await board();
    createTextAt(700, 450);
    const id = snapshot(doc).find((o) => o.type === 'text')!.id;
    expect(document.querySelector('[data-testid="text-editor"]')).not.toBeNull();

    // A remote client deletes the object mid-edit.
    act(() => {
      doc.transact(() => {
        doc.getMap('objects').delete(id);
      }, 'remote-client');
    });

    expect(document.querySelector('[data-testid="text-editor"]')).toBeNull();
    expect(textEls(container)).toHaveLength(0);

    // Let any timers/raf settle: the object is never recreated.
    await flushRaf();
    vi.advanceTimersByTime(1000);
    await flushRaf();
    expect(snapshot(doc).filter((o) => o.id === id)).toHaveLength(0);
    expect(textEls(container)).toHaveLength(0);
  });

  it('TC-25 type then Ctrl+Z → text and stored box revert together in one step', async () => {
    const { doc } = await board();
    createTextAt(700, 450);
    const id = snapshot(doc).find((o) => o.type === 'text')!.id;
    const ta = textEditor();

    // Type in three bursts within the single editing session.
    inputValue(ta, 'H');
    inputValue(ta, 'He');
    inputValue(ta, 'Hello');
    expect(textOf(doc, id)).toBe('Hello');
    const grown = snapshot(doc).find((o) => o.id === id)!;
    expect(grown.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

    // One Ctrl+Z reverts the WHOLE typing burst: text and box together.
    dispatch(
      ta,
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(textOf(doc, id)).toBe('');
    const reverted = snapshot(doc).find((o) => o.id === id)!;
    expect(reverted.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(reverted.height).toBe(26); // 20 * 1.3 line height (TEXT_LINE_HEIGHT)
  });

  it('TC-19b negative: load_failed board refuses text creation', async () => {
    const { doc } = await board();
    setConnection('load_failed');
    createTextAt(700, 450);
    expect(snapshot(doc).filter((o) => o.type === 'text')).toHaveLength(0);
  });
});

function clickButton(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
