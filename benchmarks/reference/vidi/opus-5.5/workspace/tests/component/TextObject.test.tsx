/**
 * text.object (story 9) on the real board with a real Y.Doc and real undo controller: editing,
 * empty removal, sizes, horizontal handles, remote delete and undo (TC-19 to TC-25).
 * Text is measured with the no-canvas estimate (jsdom has no canvas).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { estimateMeasurer, layoutText, linesHeight } from '../../src/client/objects/textLayout';
import { newBoardId } from '../../src/shared/board-id';
import { objectSnapshot } from '../../src/shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_MAX_CHARS, TEXT_SIZES, type TextSize } from '../../src/shared/config';
import { PROSE_1000, RETRO_ITEM } from '../fixtures/texts';
import { createSelectedNote, doc, flushFrame, notes, renderBoard, user } from './stickyHelpers';
import {
  createSelectedText,
  createTextAt,
  onlyText,
  POINTER_ID,
  pressKey,
  remote,
  selectedIds,
  textEditor,
  textEl,
  texts,
  typeInto,
} from './textHelpers';

const PRIMARY_BUTTON = 0;
const START_TIME = new Date('2026-09-25T10:00:00Z');
const HANDLE_DRAG_PX = 100;
const CLOSE = 6;

/** Real board with fake animation frames and a fake clock (undo grouping reads Date.now). */
function renderRealBoard(): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
  vi.setSystemTime(START_TIME);
  render(<Board boardId={newBoardId()} />);
  flushFrame();
}

function ctrlZ(target: Element | Window = window): void {
  fireEvent.keyDown(target, { key: 'z', ctrlKey: true });
}

function handleNames(): string[] {
  return screen.queryAllByRole('button', { name: /^Resize / }).map((h) => h.getAttribute('aria-label') ?? '');
}

function dragHandle(name: string, dx: number, dy: number): void {
  const handle = screen.getByRole('button', { name });
  const r = { x: 500, y: 500 };
  fireEvent.pointerDown(handle, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: r.x, clientY: r.y });
  fireEvent.pointerMove(handle, { pointerId: POINTER_ID, clientX: r.x + dx / 2, clientY: r.y + dy / 2 });
  flushFrame();
  fireEvent.pointerMove(handle, { pointerId: POINTER_ID, clientX: r.x + dx, clientY: r.y + dy });
  flushFrame();
  fireEvent.pointerUp(handle, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: r.x + dx, clientY: r.y + dy });
}

function expectedBox(text: string, size: TextSize) {
  return layoutText(text, size, 'auto', null, estimateMeasurer);
}

describe('text.object editing', () => {
  it('TC-19 caret at the end; Enter inserts a newline; Escape ends editing and keeps the text selected', async () => {
    renderBoard();
    const u = user();
    const id = createSelectedText('Went well');
    expect(textEditor()).toBeNull();
    expect(selectedIds()).toEqual([id]);

    // Double-click edits with the caret at the end.
    fireEvent.doubleClick(textEl(id));
    let textarea = textEditor()!;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe('Went well'.length);
    expect(textarea.selectionEnd).toBe('Went well'.length);

    await u.keyboard('{Enter}');
    expect(textEditor()).not.toBeNull();
    expect(onlyText().text).toBe('Went well\n');
    expect(onlyText().height).toBeCloseTo(linesHeight(2, 'M'), CLOSE);
    await u.keyboard('Retro');
    expect(onlyText().text).toBe('Went well\nRetro');

    fireEvent.keyDown(textEditor()!, { key: 'Escape' });
    expect(textEditor()).toBeNull();
    expect(selectedIds()).toEqual([id]);
    expect(onlyText().text).toBe('Went well\nRetro');

    // Enter with exactly one text selected edits it, caret at the end.
    pressKey('Enter');
    textarea = textEditor()!;
    expect(textarea).not.toBeNull();
    expect(textarea.selectionStart).toBe('Went well\nRetro'.length);
  });

  it('renders plain text at the stored box in the board font, announced by its content', () => {
    renderBoard();
    const id = createSelectedText(RETRO_ITEM);
    const el = textEl(id);
    const t = onlyText();
    expect(el.getAttribute('aria-label')).toBe(RETRO_ITEM);
    expect(el.tabIndex).toBe(0);
    expect(el.style.width).toBe(`${t.width}px`);
    expect(el.style.height).toBe(`${t.height}px`);
    expect(el.style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(el.style.fontFamily).toBe(TEXT_FONT_FAMILY);
    expect(el.style.backgroundColor).toBe('');
    expect(t.width).toBeCloseTo(expectedBox(RETRO_ITEM, 'M').width, CLOSE);
    expect(t.height).toBeCloseTo(linesHeight(RETRO_ITEM.split('\n').length, 'M'), CLOSE);
  });

  it('clicking empty board ends editing and keeps the typed text', () => {
    renderBoard();
    const textarea = createTextAt(300, 200);
    typeInto(textarea, 'To improve');
    fireEvent.pointerDown(screen.getByTestId('board-viewport'), {
      pointerId: POINTER_ID,
      button: PRIMARY_BUTTON,
      clientX: 1000,
      clientY: 700,
    });
    expect(textEditor()).toBeNull();
    expect(onlyText().text).toBe('To improve');
  });

  it('typing or pasting beyond TEXT_MAX_CHARS keeps only the first 5,000 characters', () => {
    renderBoard();
    const textarea = createTextAt(300, 200);
    let paragraph = '';
    while (paragraph.length <= TEXT_MAX_CHARS) paragraph += `${PROSE_1000} `;
    const pasted = paragraph.slice(0, TEXT_MAX_CHARS + 1);
    typeInto(textarea, pasted);
    expect(onlyText().text).toBe(pasted.slice(0, TEXT_MAX_CHARS));
    expect(textarea.value).toHaveLength(TEXT_MAX_CHARS);
    expect(textarea.maxLength).toBe(TEXT_MAX_CHARS);
  });
});

describe('text.object empty removal', () => {
  it('TC-20 Escape with no characters removes the object and clears the selection (negative)', () => {
    renderBoard();
    const textarea = createTextAt(300, 200);
    expect(texts()).toHaveLength(1);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(texts()).toHaveLength(0);
    expect(objectSnapshot(doc())).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    expect(textEditor()).toBeNull();
  });

  it('TC-20 an abandoned new text leaves nothing behind that undo could bring back invisibly', () => {
    renderRealBoard();
    fireEvent.keyDown(createTextAt(300, 200), { key: 'Escape' });
    ctrlZ();
    expect(texts()).toHaveLength(0);
  });

  it('erasing all characters removes the text; one undo brings it back with its text', () => {
    renderRealBoard();
    const id = createSelectedText('Went well');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.doubleClick(textEl(id));
    typeInto(textEditor()!, '');
    fireEvent.keyDown(textEditor()!, { key: 'Escape' });
    expect(texts()).toHaveLength(0);
    ctrlZ();
    expect(texts()).toHaveLength(1);
    expect(onlyText()).toMatchObject({ id, text: 'Went well' });
  });

  it('whitespace-only text is kept', () => {
    renderBoard();
    createSelectedText('   ');
    expect(onlyText().text).toBe('   ');
  });
});

describe('text.object toolbar and handles', () => {
  it('TC-21 the text toolbar shows S M L XL with M pressed; XL resizes the text, top-left unchanged', () => {
    renderBoard();
    createSelectedText('Went well');
    const toolbar = screen.getByRole('toolbar', { name: 'Text' });
    const sizes = ['S', 'M', 'L', 'XL'].map((name) => screen.getByRole('button', { name }));
    expect(sizes.map((b) => toolbar.contains(b))).toEqual([true, true, true, true]);
    expect(sizes.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(screen.getByRole('button', { name: 'Delete text' })).toBeDefined();
    const before = onlyText();

    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    const after = onlyText();
    expect(after).toMatchObject({ size: 'XL', x: before.x, y: before.y });
    const box = expectedBox('Went well', 'XL');
    expect(after.width).toBeCloseTo(box.width, CLOSE);
    expect(after.height).toBeCloseTo(box.height, CLOSE);
    expect(after.width).toBeGreaterThan(before.width);
    expect(screen.getByRole('button', { name: 'XL' }).getAttribute('aria-pressed')).toBe('true');
    expect(textEl(after.id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
  });

  it('Delete text in the toolbar removes it', () => {
    renderBoard();
    createSelectedText('Went well');
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(texts()).toHaveLength(0);
  });

  it('TC-22 selecting one text shows only the left and right handles; dragging right fixes and rewraps', () => {
    renderBoard();
    createSelectedText('Went well today');
    expect(handleNames().sort()).toEqual(['Resize left', 'Resize right']);
    const before = onlyText();
    dragHandle('Resize right', -(before.width - 40), 0);
    const after = onlyText();
    expect(after).toMatchObject({ widthMode: 'fixed', x: before.x, y: before.y, size: 'M' });
    expect(after.width).toBeCloseTo(40, CLOSE);
    const wrapped = layoutText('Went well today', 'M', 'fixed', after.width, estimateMeasurer);
    expect(after.height).toBeCloseTo(wrapped.height, CLOSE);
    expect(after.height).toBeGreaterThan(before.height);
    expect(handleNames().sort()).toEqual(['Resize left', 'Resize right']);
  });

  it('TC-22 the left handle cannot make text narrower than TEXT_MIN_WIDTH_WORLD; the right edge stays', () => {
    renderBoard();
    createSelectedText('Went well today');
    const before = onlyText();
    dragHandle('Resize left', before.width * 3, 0);
    const after = onlyText();
    expect(after.width).toBeCloseTo(40, CLOSE);
    expect(after.x + after.width).toBeCloseTo(before.x + before.width, CLOSE);
    expect(after.y).toBe(before.y);
  });

  it('TC-23 text + sticky: all 8 handles; a resize repositions the text proportionally, font size unchanged', () => {
    renderBoard();
    createSelectedNote(300, 250);
    pressKey('Escape');
    createTextAt(700, 550);
    typeInto(textEditor()!, 'To improve');
    fireEvent.keyDown(textEditor()!, { key: 'Escape' });
    pressKey('a', { ctrlKey: true });
    expect(selectedIds()).toHaveLength(2);
    expect(handleNames()).toHaveLength(8);

    const note0 = notes()[0]!;
    const text0 = onlyText();
    const boxX = Math.min(note0.x, text0.x);
    const boxY = Math.min(note0.y, text0.y);
    dragHandle('Resize bottom-right', HANDLE_DRAG_PX, HANDLE_DRAG_PX);
    const note1 = notes()[0]!;
    const text1 = onlyText();
    const scale = note1.width! / note0.width!;
    expect(scale).toBeGreaterThan(1);
    expect(text1.x - boxX).toBeCloseTo((text0.x - boxX) * scale, CLOSE);
    expect(text1.y - boxY).toBeCloseTo((text0.y - boxY) * scale, CLOSE);
    expect(text1).toMatchObject({ size: 'M', width: text0.width, height: text0.height, widthMode: 'auto' });
  });
});

describe('text.object remote delete and undo', () => {
  it('TC-24 a remote delete while editing ends editing silently; the text is not recreated (error path)', () => {
    renderBoard();
    const errors = vi.spyOn(console, 'error');
    const textarea = createTextAt(300, 200);
    typeInto(textarea, 'Went');
    const { id } = onlyText();
    remote((d) => d.getMap('objects').delete(id));
    expect(textEditor()).toBeNull();
    expect(texts()).toHaveLength(0);
    expect(selectedIds()).toEqual([]);
    fireEvent.blur(textarea);
    fireEvent.change(textarea, { target: { value: 'Went well' } });
    expect(objectSnapshot(doc())).toHaveLength(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it('TC-25 type then Ctrl+Z: text and stored box revert together in one step', () => {
    renderRealBoard();
    const textarea = createTextAt(300, 200);
    const created = onlyText();
    typeInto(textarea, 'Went well');
    const typed = onlyText();
    expect(typed.width).toBeGreaterThan(created.width);
    ctrlZ(textarea);
    expect(onlyText()).toMatchObject({ text: '', width: created.width, height: created.height });
    expect(textarea.value).toBe('');
    // Redo brings both back.
    fireEvent.keyDown(textarea, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(onlyText()).toMatchObject({ text: 'Went well', width: typed.width, height: typed.height });
  });

  it('TC-25 a size change is one undo step: size and box revert together', () => {
    renderRealBoard();
    createSelectedText('Went well');
    const before = onlyText();
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(onlyText().size).toBe('L');
    ctrlZ();
    expect(onlyText()).toMatchObject({ size: 'M', width: before.width, height: before.height });
  });
});
