import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import {
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createText, getTextContent, setTextBox } from '../../src/shared/objects/text';
import { HANDLE_NAMES } from '../../src/client/board/SelectionOverlay';
import { flushFrame, pointer, renderApp } from './helpers';

// jsdom has no layout: the camera starts centred on world (0, 0) at 100%.
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const screenOf = (world: { x: number; y: number }) => ({ x: CENTRE.x + world.x, y: CENTRE.y + world.y });
const REMOTE = Symbol('remote provider');

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A text object with content, made before the board opens (not in anyone's history). */
function seedText(doc: Y.Doc, at: { x: number; y: number }, content: string, box = { width: 120, height: 26 }): string {
  const id = createText(doc, at, 'g_seed')!;
  getTextContent(doc, id)!.insert(0, content);
  setTextBox(doc, id, box);
  return id;
}

const textEl = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const editor = () => screen.queryByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement | null;
const textOf = (doc: Y.Doc, id: string) => objectsSnapshot(doc).find((o) => o.id === id);
const textToolbar = () => screen.queryByRole('toolbar', { name: 'Text' });
const handles = () =>
  [...document.querySelectorAll<HTMLElement>('.selection-handle')].map((h) => h.dataset.handle).sort();

function select(el: HTMLElement, at: { x: number; y: number }) {
  const p = screenOf(at);
  pointer(el, 'down', p.x, p.y);
  pointer(el, 'up', p.x, p.y);
  flushFrame();
}

describe('text.object editing', () => {
  it('TC-19 caret at the end; Enter inserts a newline; Escape ends editing and keeps the text selected', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'Went well');
    renderApp(doc);
    expect(textEl(id).getAttribute('aria-label')).toBe('Went well');
    expect(textEl(id).textContent).toBe('Went well');
    fireEvent.doubleClick(textEl(id));
    const ed = editor()!;
    expect(document.activeElement).toBe(ed);
    expect(ed.value).toBe('Went well');
    expect(ed.selectionStart).toBe(9);
    expect(ed.selectionEnd).toBe(9);
    // Enter is left to the textarea (a newline), not taken as "end editing".
    expect(fireEvent.keyDown(ed, { key: 'Enter' })).toBe(true);
    fireEvent.input(ed, { target: { value: 'Went well\n' } });
    fireEvent.input(ed, { target: { value: 'Went well\nsprint' } });
    expect(textOf(doc, id)!.text).toBe('Went well\nsprint');
    expect(textOf(doc, id)!.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(editor()).toBeNull();
    expect(textEl(id).dataset.selected).toBe('true');
    expect(textEl(id).dataset.editing).toBe('false');
    expect(textOf(doc, id)!.text).toBe('Went well\nsprint');
  });

  it('Enter on a selected text starts editing; typing is limited to TEXT_MAX_CHARS', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'abc');
    renderApp(doc);
    select(textEl(id), { x: 5, y: 5 });
    fireEvent.keyDown(window, { key: 'Enter' });
    const ed = editor()!;
    expect(ed.selectionStart).toBe(3);
    fireEvent.input(ed, { target: { value: 'abc' + 'x'.repeat(6000) } });
    expect(textOf(doc, id)!.text).toHaveLength(5000);
    expect(ed.value).toHaveLength(5000);
  });

  it('a press elsewhere ends editing and keeps the text', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'Label');
    renderApp(doc);
    fireEvent.doubleClick(textEl(id));
    fireEvent.pointerDown(screen.getByTestId('board-viewport'), { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    expect(editor()).toBeNull();
    expect(textOf(doc, id)!.text).toBe('Label');
  });

  it('TC-20 Escape with no characters removes the object and clears the selection', () => {
    const doc = newDoc();
    const { viewport } = renderApp(doc);
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.pointerDown(viewport(), { clientX: 300, clientY: 200, button: 0, pointerId: 1 });
    expect(objectsSnapshot(doc)).toHaveLength(1);
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(objectsSnapshot(doc)).toHaveLength(0);
    expect(objectsMap(doc).size).toBe(0);
    expect(window.__vidi6?.getSelection?.()).toEqual([]);
    expect(document.querySelector('[data-text-object]')).toBeNull();
  });

  it('typing then deleting every character removes the text on edit end; one undo brings it back', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'abc');
    renderApp(doc);
    fireEvent.doubleClick(textEl(id));
    fireEvent.input(editor()!, { target: { value: '' } });
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(objectsMap(doc).has(id)).toBe(false);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(textOf(doc, id)?.text).toBe('abc');
  });
});

describe('text.object toolbar and handles', () => {
  it('TC-21 TextToolbar shows S M L XL with M pressed; XL changes size, x/y unchanged', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 30, y: 40 }, 'Went well');
    renderApp(doc);
    select(textEl(id), { x: 35, y: 45 });
    const bar = textToolbar()!;
    expect(bar).not.toBeNull();
    const sizes = ['S', 'M', 'L', 'XL'].map((s) => screen.getByRole('button', { name: `Size ${s}` }));
    expect(sizes.map((b) => b.textContent)).toEqual(['S', 'M', 'L', 'XL']);
    expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'Delete text' })).toBeTruthy();
    const before = textOf(doc, id)!;
    fireEvent.click(sizes[3]!);
    const after = textOf(doc, id)!;
    expect(after).toMatchObject({ size: 'XL', x: 30, y: 40 });
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(after.width).toBeGreaterThan(before.width);
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(screen.getByRole('button', { name: 'Size XL' }).getAttribute('aria-pressed')).toBe('true');
    // Delete from the toolbar.
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(objectsMap(doc).has(id)).toBe(false);
  });

  it('TC-22 one selected text shows only the left and right handles', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'Went well');
    renderApp(doc);
    select(textEl(id), { x: 5, y: 5 });
    expect(handles()).toEqual(['e', 'w']);
    expect(screen.queryByRole('button', { name: `Resize ${HANDLE_NAMES.n}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `Resize ${HANDLE_NAMES.s}` })).toBeNull();
  });

  it('dragging the right handle narrower sets a fixed width (min TEXT_MIN_WIDTH_WORLD) and rewraps the height', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'ab cd ef', { width: 200, height: 26 });
    renderApp(doc);
    select(textEl(id), { x: 5, y: 5 });
    const right = screen.getByRole('button', { name: 'Resize right' });
    pointer(right, 'down', CENTRE.x + 200, CENTRE.y + 13);
    pointer(right, 'move', CENTRE.x + 100, CENTRE.y + 13);
    flushFrame();
    pointer(right, 'move', CENTRE.x - 300, CENTRE.y + 13);
    pointer(right, 'up', CENTRE.x - 300, CENTRE.y + 13);
    flushFrame();
    const t = textOf(doc, id)!;
    expect(t).toMatchObject({ x: 0, y: 0, widthMode: 'fixed', width: TEXT_MIN_WIDTH_WORLD, size: 'M' });
    // Estimate measurer (no canvas in jsdom): 11 units per character at M → one word per line.
    expect(t.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-23 text + sticky: all handles; a resize moves the text proportionally, font size unchanged', () => {
    const doc = newDoc();
    const sticky = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 }) as string;
    const id = seedText(doc, { x: 300, y: 100 }, 'Went well', { width: 100, height: 26 });
    renderApp(doc);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    flushFrame();
    expect(handles()).toHaveLength(8);
    // Group box: (0,0) – (400,200). Drag the bottom-right corner to double it (sticky keeps its aspect).
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    pointer(se, 'down', CENTRE.x + 400, CENTRE.y + 200);
    pointer(se, 'move', CENTRE.x + 800, CENTRE.y + 400);
    pointer(se, 'up', CENTRE.x + 800, CENTRE.y + 400);
    flushFrame();
    expect(textOf(doc, sticky)).toMatchObject({ x: 0, y: 0, width: 400, height: 400 });
    const t = textOf(doc, id)!;
    expect(t).toMatchObject({ x: 600, y: 200, size: 'M', widthMode: 'auto', text: 'Went well' });
    expect(t.width).toBeLessThan(200);
    expect(textEl(id).style.fontSize).toBe(`${TEXT_SIZES.M}px`);
  });

  it('text is selected by select-all and moved by arrow keys like notes', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'Went well');
    renderApp(doc);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    expect(textOf(doc, id)).toMatchObject({ x: 10, y: 0 });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(objectsMap(doc).has(id)).toBe(false);
  });
});

describe('text.object collaboration and undo', () => {
  it('TC-24 deleted by someone else while editing → editor closes, no error, not recreated', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'Went well');
    renderApp(doc);
    fireEvent.doubleClick(textEl(id));
    const ed = editor()!;
    act(() => doc.transact(() => deleteObjects(doc, [id]), REMOTE));
    expect(editor()).toBeNull();
    expect(document.querySelector('[data-text-object]')).toBeNull();
    // Late events from the removed textarea write nothing.
    fireEvent.input(ed, { target: { value: 'Went well!' } });
    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(objectsMap(doc).has(id)).toBe(false);
    expect(objectsMap(doc).size).toBe(0);
  });

  it('TC-25 type then Ctrl+Z → text and stored box revert together in one step', () => {
    const doc = newDoc();
    const id = seedText(doc, { x: 0, y: 0 }, 'abc', { width: 40, height: 26 });
    renderApp(doc);
    fireEvent.doubleClick(textEl(id));
    const ed = editor()!;
    fireEvent.input(ed, { target: { value: 'abc and a much longer line' } });
    const typed = textOf(doc, id)!;
    expect(typed.width).toBeGreaterThan(40);
    fireEvent.keyDown(ed, { key: 'z', ctrlKey: true });
    const undone = textOf(doc, id)!;
    expect(undone).toMatchObject({ text: 'abc', width: 40, height: 26 });
    expect(ed.value).toBe('abc');
  });
});
