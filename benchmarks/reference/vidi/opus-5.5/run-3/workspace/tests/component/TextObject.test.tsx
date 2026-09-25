import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { createSticky, deleteObjects, initDoc, objectSnapshot, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, readText, setTextWidthFixed } from '../../src/shared/objects/text';
import { defaultMeasurer } from '../../src/client/objects/textLayout';
import { remeasureText } from '../../src/client/objects/useTextBoxSync';
import { dispatchPrevented, key, nextFrame, pointer, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A measured text object with `content`, its top-left at (x, y). */
function textAt(doc: Y.Doc, x: number, y: number, content: string): string {
  const id = createText(doc, { x, y }, 'g_test')!;
  getTextContent(doc, id)!.insert(0, content);
  remeasureText(doc, id, defaultMeasurer());
  return id;
}

function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (!el) throw new Error(`text ${id} not rendered`);
  return el;
}

function renderAt(doc: Y.Doc) {
  const utils = renderApp(doc);
  setCamera({ x: 0, y: 0, zoom: 1 });
  return utils;
}

const selected = () => window.__vidi6!.selection!();
const editor = () => screen.queryByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement | null;
const user = () => userEvent.setup({ advanceTimers: () => {} });

function mod(k: string, target: EventTarget, init: KeyboardEventInit = {}) {
  return dispatchPrevented(
    target,
    new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...init }),
  );
}

function handleNames(): string[] {
  return screen.queryAllByRole('button', { name: /^Resize / }).map((h) => h.getAttribute('aria-label')!);
}

/** Press on text without moving: selects it. */
function select(id: string) {
  pointer(textEl(id), 'down', 5, 5);
  pointer(textEl(id), 'up', 5, 5);
}

describe('text objects (text.object)', () => {
  it('renders plain text at its stored box, announced by its content and reachable with Tab', () => {
    const doc = freshDoc();
    const id = textAt(doc, 40, 60, 'Went well');
    renderAt(doc);
    const el = textEl(id);
    const t = readText(doc, id)!;
    expect(el).toHaveAttribute('role', 'group');
    expect(el).toHaveAccessibleName('Went well');
    expect(el).toHaveAttribute('tabindex', '0');
    expect(el).toHaveTextContent('Went well');
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('60px');
    expect(el.style.width).toBe(`${t.width}px`);
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    act(() => el.focus());
    expect(selected()).toEqual([id]);
  });

  it('TC-19 editing puts the caret at the end, Enter inserts a new line, Escape ends and keeps it selected', async () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'Went');
    renderAt(doc);
    const heightBefore = readText(doc, id)!.height;
    const widthBefore = readText(doc, id)!.width;
    act(() => textEl(id).focus());
    expect(key('Enter', textEl(id))).toBe(true);
    const ta = editor()!;
    expect(ta).toHaveFocus();
    expect(ta.value).toBe('Went');
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
    await user().keyboard(' well');
    expect(getTextContent(doc, id)!.toString()).toBe('Went well');
    expect(readText(doc, id)!.width).toBeGreaterThan(widthBefore); // grows as you type
    await user().keyboard('{Enter}ok');
    expect(getTextContent(doc, id)!.toString()).toBe('Went well\nok');
    expect(readText(doc, id)!.height).toBeCloseTo(2 * heightBefore);
    expect(key('Escape', ta)).toBe(true);
    expect(editor()).toBeNull();
    expect(selected()).toEqual([id]);
    expect(textEl(id)).toHaveFocus();
    expect(textEl(id)).toHaveTextContent('Went well ok');
  });

  it('double-click edits; typing is limited to TEXT_MAX_CHARS', async () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'x'.repeat(TEXT_MAX_CHARS - 1));
    renderAt(doc);
    act(() => {
      textEl(id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(editor()).toHaveFocus();
    await user().keyboard('ab');
    expect(getTextContent(doc, id)!.length).toBe(TEXT_MAX_CHARS);
    expect(getTextContent(doc, id)!.toString().endsWith('xa')).toBe(true);
  });

  it('TC-20 Escape with no characters removes a new text, clears the selection, and undo does not bring it back', () => {
    const doc = freshDoc();
    const other = createSticky(doc, { x: 500, y: 500 });
    const { viewport } = renderAt(doc);
    key('t', document.body);
    pointer(viewport, 'down', 100, 100);
    pointer(viewport, 'up', 100, 100);
    expect(objectSnapshot(doc)).toHaveLength(2);
    expect(key('Escape', editor()!)).toBe(true);
    expect(objectSnapshot(doc).map((o) => o.id)).toEqual([other]);
    expect(selected()).toEqual([]);
    expect(editor()).toBeNull();
    // Nothing to undo: the abandoned text never happened.
    expect(mod('z', document.body)).toBe(true);
    expect(objectSnapshot(doc).map((o) => o.id)).toEqual([other]);
  });

  it('a text emptied by typing is removed on an outside click; one undo brings back its text', async () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'Hi');
    const { viewport } = renderAt(doc);
    act(() => textEl(id).focus());
    key('Enter', textEl(id));
    await user().keyboard('{Backspace}{Backspace}');
    expect(getTextContent(doc, id)!.length).toBe(0);
    pointer(viewport, 'down', 700, 700);
    pointer(viewport, 'up', 700, 700);
    expect(readText(doc, id)).toBeUndefined();
    expect(selected()).toEqual([]);
    mod('z', document.body);
    expect(readText(doc, id)?.text).toBe('Hi');
  });

  it('a new text that was typed in and cleared again leaves nothing behind, even for undo', async () => {
    const doc = freshDoc();
    const { viewport } = renderAt(doc);
    key('t', document.body);
    pointer(viewport, 'down', 100, 100);
    pointer(viewport, 'up', 100, 100);
    await user().keyboard('ab{Backspace}{Backspace}');
    key('Escape', editor()!);
    expect(objectSnapshot(doc)).toHaveLength(0);
    mod('z', document.body);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('TC-21 the text toolbar shows S M L XL with M pressed; XL changes the size and keeps the top-left', () => {
    const doc = freshDoc();
    const id = textAt(doc, 30, 40, 'Went well');
    renderAt(doc);
    select(id);
    const bar = screen.getByRole('toolbar', { name: 'Text' });
    const sizes = ['S', 'M', 'L', 'XL'].map((s) => screen.getByRole('button', { name: `Size ${s}` }));
    expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Delete text' }));
    const before = readText(doc, id)!;
    act(() => screen.getByRole('button', { name: 'Size XL' }).click());
    const after = readText(doc, id)!;
    expect(after).toMatchObject({ size: 'XL', x: 30, y: 40 });
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(after.width).toBeGreaterThan(before.width); // auto width re-measured
    expect(screen.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'true');
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    // Size and box are one undo step.
    mod('z', document.body);
    expect(readText(doc, id)).toMatchObject({ size: 'M', width: before.width, height: before.height });
    act(() => screen.getByRole('button', { name: 'Delete text' }).click());
    expect(readText(doc, id)).toBeUndefined();
  });

  it('TC-22 one selected text shows only the left and right handles; dragging one sets a fixed width', () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'abc def ghi');
    renderAt(doc);
    select(id);
    expect(handleNames().sort()).toEqual(['Resize left', 'Resize right']);
    const before = readText(doc, id)!;
    const right = screen.getByRole('button', { name: 'Resize right' });
    pointer(right, 'down', before.width, 10);
    pointer(right, 'move', 50, 10);
    nextFrame();
    pointer(right, 'up', 50, 10);
    const after = readText(doc, id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(50);
    expect(after).toMatchObject({ x: 0, y: 0, size: 'M' });
    expect(after.height).toBeGreaterThan(before.height); // rewrapped
    // Below the minimum width it stops at the minimum; the left handle moves the left edge.
    const left = screen.getByRole('button', { name: 'Resize left' });
    pointer(left, 'down', 0, 10);
    pointer(left, 'move', -30, 10);
    nextFrame();
    pointer(left, 'up', -30, 10);
    expect(readText(doc, id)).toMatchObject({ x: -30, width: 80, widthMode: 'fixed' });
  });

  it('TC-23 text with a note shows all handles; a resize moves the text proportionally and keeps its size', () => {
    const doc = freshDoc();
    const note = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 }); // (0,0)-(200,200)
    const auto = textAt(doc, 0, 300, 'abc');
    const fixed = textAt(doc, 100, 400, 'abc def');
    setTextWidthFixed(doc, fixed, 100);
    remeasureText(doc, fixed, defaultMeasurer());
    renderAt(doc);
    key('a', document.body); // no-op without Ctrl
    mod('a', document.body);
    expect(selected()).toHaveLength(3);
    expect(handleNames()).toHaveLength(8);
    const a0 = readText(doc, auto)!;
    const f0 = readText(doc, fixed)!;
    const boxBottom = Math.max(a0.y + a0.height, f0.y + f0.height);
    const boxRight = Math.max(200, a0.x + a0.width, f0.x + f0.width);
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    // The note keeps its proportions, so the whole group scales uniformly by 1.5.
    pointer(se, 'down', boxRight, boxBottom);
    pointer(se, 'move', boxRight * 1.5, boxBottom * 1.5);
    nextFrame();
    pointer(se, 'up', boxRight * 1.5, boxBottom * 1.5);
    const n = snapshot(doc).find((o) => o.id === note)!;
    const s = n.width / 200;
    expect(s).toBeGreaterThan(1.2);
    const a1 = readText(doc, auto)!;
    const f1 = readText(doc, fixed)!;
    expect(a1.y).toBeCloseTo(300 * s);
    expect(a1).toMatchObject({ size: 'M', widthMode: 'auto', width: a0.width, height: a0.height });
    expect(f1.x).toBeCloseTo(100 * s);
    expect(f1.y).toBeCloseTo(400 * s);
    expect(f1).toMatchObject({ size: 'M', widthMode: 'fixed' });
    expect(f1.width).toBeCloseTo(100 * s);
  });

  it('TC-24 a remote delete while editing ends editing without error and nothing comes back', async () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'Hi');
    renderAt(doc);
    act(() => textEl(id).focus());
    key('Enter', textEl(id));
    expect(editor()).toHaveFocus();
    const remote = Symbol('remote');
    act(() => {
      doc.transact(() => doc.getMap('objects').delete(id), remote);
    });
    expect(editor()).toBeNull();
    expect(document.querySelector(`[data-text-id="${id}"]`)).toBeNull();
    await user().keyboard('more');
    key('Escape', document.body);
    expect(readText(doc, id)).toBeUndefined();
    expect(objectSnapshot(doc)).toHaveLength(0);
    expect(deleteObjects(doc, [id])).toBe(0);
  });

  it('TC-25 typing then Ctrl+Z reverts the text and its stored box together in one step', async () => {
    const doc = freshDoc();
    const id = textAt(doc, 0, 0, 'Hi');
    renderAt(doc);
    const before = readText(doc, id)!;
    act(() => textEl(id).focus());
    key('Enter', textEl(id));
    await user().keyboard(' there, everyone');
    const typed = readText(doc, id)!;
    expect(typed.width).toBeGreaterThan(before.width);
    expect(mod('z', editor()!)).toBe(true);
    const after = readText(doc, id)!;
    expect(after.text).toBe('Hi');
    expect({ width: after.width, height: after.height }).toEqual({ width: before.width, height: before.height });
    expect(editor()!.value).toBe('Hi');
  });
});
