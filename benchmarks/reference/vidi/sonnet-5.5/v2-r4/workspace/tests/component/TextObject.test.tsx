import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, setTextBox, type TextSnapshot } from '../../src/shared/objects/text';
import { click, frame, viewport } from './helpers';

afterEach(cleanup);

const textEls = () => screen.queryAllByRole('group', { name: /^Text/ });
const textEl = () => textEls()[0];
const obj = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id) as TextSnapshot;

/** A text object with content, created before the app (and its undo history) exists. */
function setupText(content = 'Went well', at = { x: 0, y: 0 }, extra: { x: number; y: number }[] = []) {
  const doc = new Y.Doc();
  const id = createText(doc, at, 'g_test')!;
  getTextContent(doc, id)!.insert(0, content);
  setTextBox(doc, id, { width: 100, height: 26 });
  const stickies = extra.map((p) => createSticky(doc, p));
  render(<App doc={doc} />);
  return { doc, id, stickies };
}

describe('text.object', () => {
  it('TC-19 Enter on a selected text edits with the caret at the end; Enter adds a line; Escape keeps it selected', async () => {
    const { doc, id } = setupText('hello');
    click(textEl());
    fireEvent.keyDown(document.body, { key: 'Enter' });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(5);
    await userEvent.keyboard('{Enter}world');
    expect(getTextContent(doc, id)!.toString()).toBe('hello\nworld');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getTextContent(doc, id)!.toString()).toBe('hello\nworld');
    expect(textEl().getAttribute('data-selected')).toBe('true');
  });

  it('double-click edits; the box follows typing (local write)', async () => {
    const { doc, id } = setupText('a');
    fireEvent.doubleClick(textEl());
    await userEvent.keyboard('bcd');
    expect(obj(doc, id).text).toBe('abcd');
    const m = TEXT_SIZES.M;
    expect(obj(doc, id).width).toBeCloseTo(4 * m * 0.55 + 4);
    expect(obj(doc, id).height).toBeCloseTo(m * 1.3);
  });

  it('TC-20 Escape with no characters removes the object and clears the selection', async () => {
    const doc = new Y.Doc();
    render(<App doc={doc} />);
    fireEvent.keyDown(document.body, { key: 't' });
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    expect(snapshot(doc)).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(snapshot(doc)).toHaveLength(0);
    expect(textEls()).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Text tools' })).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('clicking elsewhere with no characters also removes the text; whitespace is kept', async () => {
    const doc = new Y.Doc();
    render(<App doc={doc} />);
    fireEvent.keyDown(document.body, { key: 't' });
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    await userEvent.keyboard(' ');
    fireEvent.pointerDown(viewport(), { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 50, clientY: 50, pointerId: 1 });
    expect(snapshot(doc)).toHaveLength(1);
    fireEvent.doubleClick(textEl());
    await userEvent.keyboard('{Backspace}');
    fireEvent.pointerDown(viewport(), { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('input beyond TEXT_MAX_CHARS is not added', async () => {
    const { doc, id } = setupText('x'.repeat(TEXT_MAX_CHARS - 2));
    fireEvent.doubleClick(textEl());
    await userEvent.keyboard('abcdef');
    expect(getTextContent(doc, id)!.length).toBe(TEXT_MAX_CHARS);
  });

  it('TC-21 the text toolbar shows S M L XL with M pressed; XL changes the size and keeps x and y', () => {
    const { doc, id } = setupText('Went well', { x: 40, y: 60 });
    click(textEl());
    const bar = screen.getByRole('toolbar', { name: 'Text tools' });
    for (const s of ['S', 'M', 'L', 'XL']) expect(bar.querySelector(`button[title="Size ${s}"]`)).toBeTruthy();
    const pressed = (s: string) => screen.getByRole('button', { name: s }).getAttribute('aria-pressed');
    expect(pressed('M')).toBe('true');
    expect(pressed('XL')).toBe('false');
    const before = obj(doc, id);
    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    const after = obj(doc, id);
    expect(after.size).toBe('XL');
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * 1.3);
    expect(after.width).toBeGreaterThan(before.width);
    expect(pressed('XL')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-22 a single text shows only the left and right handles; the right one sets a fixed width', async () => {
    const { doc, id } = setupText('one two three four', { x: 0, y: 0 });
    setTextBox(doc, id, { width: 200, height: 26 });
    click(textEl());
    const handles = [...document.querySelectorAll('[data-handle]')].map((h) => h.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'w']);
    const right = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(right, { clientX: 200, clientY: 10, pointerId: 2, button: 0 });
    fireEvent.pointerMove(right, { clientX: 80, clientY: 90, pointerId: 2 });
    await frame();
    fireEvent.pointerUp(right, { clientX: 80, clientY: 90, pointerId: 2 });
    const t = obj(doc, id);
    expect(t).toMatchObject({ widthMode: 'fixed', width: 80, x: 0, y: 0 });
    expect(t.height).toBeGreaterThan(TEXT_SIZES.M * 1.3 * 1.5); // rewrapped onto several lines
    // dragging far past the minimum stops at 40
    const again = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(again, { clientX: 80, clientY: 10, pointerId: 3, button: 0 });
    fireEvent.pointerMove(again, { clientX: -500, clientY: 10, pointerId: 3 });
    await frame();
    fireEvent.pointerUp(again, { clientX: -500, clientY: 10, pointerId: 3 });
    expect(obj(doc, id).width).toBe(40);
  });

  it('TC-23 text with a sticky shows all handles; resizing repositions the text and keeps its font size', async () => {
    const { doc, id, stickies } = setupText('Hi', { x: 0, y: 0 }, [{ x: 400, y: 100 }]);
    const t0 = obj(doc, id);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(8);
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    const sticky0 = obj(doc, stickies[0]);
    const box = { w: sticky0.x + sticky0.width, h: sticky0.y + sticky0.height };
    fireEvent.pointerDown(se, { clientX: 512 + box.w, clientY: 384 + box.h, pointerId: 2, button: 0 });
    fireEvent.pointerMove(se, { clientX: 512 + box.w * 2, clientY: 384 + box.h * 2, pointerId: 2 });
    await frame();
    fireEvent.pointerUp(se, { clientX: 512 + box.w * 2, clientY: 384 + box.h * 2, pointerId: 2 });
    const t1 = obj(doc, id);
    expect(t1.size).toBe('M');
    expect(t1.widthMode).toBe('auto');
    expect(t1.x).toBeCloseTo(t0.x * 2);
    expect(obj(doc, stickies[0]).width).toBeGreaterThan(sticky0.width);
  });

  it('TC-24 deleting the text remotely while editing ends editing without error or re-creation', () => {
    const { doc, id } = setupText('abc');
    fireEvent.doubleClick(textEl());
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => doc.transact(() => doc.getMap('objects').delete(id), 'remote'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(textEls()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-25 Ctrl+Z after typing reverts the text and the stored box together in one step', async () => {
    const { doc, id } = setupText('hello');
    const before = obj(doc, id);
    fireEvent.doubleClick(textEl());
    await userEvent.keyboard(' world');
    const typed = obj(doc, id);
    expect(typed.text).toBe('hello world');
    expect(typed.width).not.toBe(before.width);
    await userEvent.keyboard('{Control>}z{/Control}');
    const undone = obj(doc, id);
    expect(undone.text).toBe('hello');
    expect([undone.width, undone.height]).toEqual([before.width, before.height]);
  });

  it('undoing a freshly created text removes it entirely (creation and typing are one step)', async () => {
    const doc = new Y.Doc();
    render(<App doc={doc} />);
    fireEvent.keyDown(document.body, { key: 't' });
    fireEvent.click(viewport(), { clientX: 300, clientY: 200, button: 0 });
    await userEvent.keyboard('abc');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('text is selected by select all, moved by the arrow keys and deleted with undo restoring it', () => {
    const { doc, id } = setupText('Hi', { x: 10, y: 10 });
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(obj(doc, id).x).toBe(20);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(obj(doc, id)).toMatchObject({ text: 'Hi', x: 20 });
  });

  it('text objects are reachable with Tab and announced by their content', () => {
    setupText('Went well');
    expect(textEl().getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('group', { name: 'Text: Went well' })).toBeTruthy();
  });
});
