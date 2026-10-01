import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { sharedMeasurer } from '../../src/client/objects/textLayout';
import { remeasureText } from '../../src/client/objects/useTextBoxSync';
import { createSticky, snapshotObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent, setTextWidthFixed, type TextSnapshot } from '../../src/shared/objects/text';
import { Harness, newDoc } from './helpers';

afterEach(cleanup);

const objectsOf = (doc: Y.Doc) => snapshotObjects(doc);
const textOf = (doc: Y.Doc, id: string) => objectsOf(doc).find((o) => o.id === id) as TextSnapshot;
const el = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
const frame = () => new Promise((r) => setTimeout(r, 25));

function addText(doc: Y.Doc, text: string, at = { x: 100, y: 100 }): string {
  const id = createText(doc, at, 'g') as string;
  if (text) getTextContent(doc, id)!.insert(0, text);
  remeasureText(doc, id, sharedMeasurer());
  return id;
}

function select(id: string) {
  fireEvent.pointerDown(el(id), { clientX: 120, clientY: 110, pointerId: 1 });
  fireEvent.pointerUp(el(id), { clientX: 120, clientY: 110, pointerId: 1 });
}

describe('text object', () => {
  it('renders plain text without fill, announced by its content', () => {
    const doc = newDoc();
    addText(doc, 'Went well');
    render(<Harness doc={doc} />);
    const g = screen.getByRole('group', { name: 'Went well' });
    expect(g.style.background).toBe('');
    expect(g.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(g.getAttribute('tabindex')).toBe('0');
  });

  it('TC-19 Enter edits with the caret at the end, Enter adds a line, Escape keeps the text selected', async () => {
    const doc = newDoc();
    const id = addText(doc, 'hi');
    render(<Harness doc={doc} />);
    select(id);
    fireEvent.keyDown(window, { key: 'Enter' });
    const area = screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(2);
    const user = userEvent.setup();
    await user.keyboard('{Enter}yo');
    expect(getTextContent(doc, id)!.toString()).toBe('hi\nyo');
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(el(id).dataset.selected).toBe('true');
    expect(textOf(doc, id).text).toBe('hi\nyo');
    expect(textOf(doc, id).height).toBeCloseTo(2 * TEXT_SIZES.M * 1.3);
  });

  it('double-click edits', () => {
    const doc = newDoc();
    const id = addText(doc, 'abc');
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(el(id));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('abc');
  });

  it('TC-20 Escape with no characters removes the object and clears the selection', () => {
    const doc = newDoc();
    const id = addText(doc, '');
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(el(id));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(objectsOf(doc)).toHaveLength(0);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('whitespace-only text is kept', () => {
    const doc = newDoc();
    const id = addText(doc, '  ');
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(el(id));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(objectsOf(doc)).toHaveLength(1);
  });

  it('text longer than the limit is clamped', () => {
    const doc = newDoc();
    const id = addText(doc, 'x');
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(el(id));
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    area.value = 'y'.repeat(TEXT_MAX_CHARS + 1);
    fireEvent.input(area);
    expect(getTextContent(doc, id)!.length).toBe(TEXT_MAX_CHARS);
    expect(area.value).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-21 text toolbar shows S M L XL with M pressed; XL keeps the top-left', () => {
    const doc = newDoc();
    const id = addText(doc, 'abc');
    render(<Harness doc={doc} />);
    select(id);
    const names = screen.getAllByRole('button', { name: /^(S|M|L|XL)$/ }).map((b) => b.textContent);
    expect(names).toEqual(['S', 'M', 'L', 'XL']);
    expect(screen.getByRole('button', { name: 'M' }).getAttribute('aria-pressed')).toBe('true');
    const before = textOf(doc, id);
    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    const after = textOf(doc, id);
    expect(after.size).toBe('XL');
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(after.height).toBeGreaterThan(before.height!);
    expect(screen.getByRole('button', { name: 'XL' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(objectsOf(doc)).toHaveLength(0);
  });

  it('TC-22 a single selected text shows only the left and right handles', () => {
    const doc = newDoc();
    const id = addText(doc, 'abc');
    render(<Harness doc={doc} />);
    select(id);
    const labels = screen.getAllByRole('button', { name: /^Resize/ }).map((b) => b.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(['Resize left', 'Resize right']);
  });

  it('dragging the right handle sets a fixed width and rewraps', async () => {
    const doc = newDoc();
    const id = addText(doc, 'aaa bbb ccc ddd eee fff', { x: 0, y: 0 });
    render(<Harness doc={doc} />);
    select(id);
    const before = textOf(doc, id);
    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: before.width!, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10, pointerId: 2 });
    await act(frame);
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10, pointerId: 2 });
    const after = textOf(doc, id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBe(60);
    expect(after.height).toBeGreaterThan(before.height!);
    expect(after.x).toBe(0);
  });

  it('TC-23 text plus sticky shows all handles; resize repositions text, font size unchanged', async () => {
    const doc = newDoc();
    const t = addText(doc, 'abc', { x: 400, y: 0 });
    createSticky(doc, { x: 100, y: 100 });
    render(<Harness doc={doc} />);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    expect(screen.getAllByRole('button', { name: /^Resize/ })).toHaveLength(8);
    const before = textOf(doc, t);
    const box = (screen.getByTestId('selection-box') as HTMLElement).style;
    const w = parseFloat(box.width);
    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 3 });
    fireEvent.pointerMove(window, { clientX: w, clientY: 0, pointerId: 3 }); // double the selection width
    await act(frame);
    fireEvent.pointerUp(window, { clientX: w, clientY: 0, pointerId: 3 });
    const after = textOf(doc, t);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.size).toBe('M');
    expect(after.widthMode).toBe('auto');
    expect(after.width).toBe(before.width);
  });

  it('TC-24 remote deletion while editing unmounts the editor without recreating anything', () => {
    const doc = newDoc();
    const id = addText(doc, 'abc');
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(el(id));
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => { doc.transact(() => doc.getMap('objects').delete(id), 'remote'); });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(objectsOf(doc)).toHaveLength(0);
  });

  it('TC-25 typing then Ctrl+Z reverts text and stored box together in one step', async () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = addText(doc, 'abc');
    undo.boundary();
    const start: ObjectSnapshot = textOf(doc, id);
    render(<Harness doc={doc} undo={undo} />);
    fireEvent.doubleClick(el(id));
    const user = userEvent.setup();
    await user.keyboard('defghijk');
    expect(textOf(doc, id).width).toBeGreaterThan(start.width!);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'z', ctrlKey: true });
    expect(textOf(doc, id).text).toBe('abc');
    expect(textOf(doc, id).width).toBe(start.width);
    expect(textOf(doc, id).height).toBe(start.height);
  });

  it('fixed width text keeps its width when its size changes', () => {
    const doc = newDoc();
    const id = addText(doc, 'aaa bbb ccc');
    setTextWidthFixed(doc, id, 80);
    remeasureText(doc, id, sharedMeasurer());
    render(<Harness doc={doc} />);
    select(id);
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(textOf(doc, id).width).toBe(80);
    expect(textOf(doc, id).size).toBe('L');
  });

  it('read-only boards do not enter edit mode', () => {
    const doc = newDoc();
    const id = addText(doc, 'abc');
    render(<Harness doc={doc} canEdit={false} />);
    fireEvent.doubleClick(el(id));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
