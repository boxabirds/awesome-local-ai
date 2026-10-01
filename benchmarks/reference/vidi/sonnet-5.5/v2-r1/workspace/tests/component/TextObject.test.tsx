import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { setDefaultMeasurer } from '../../src/client/objects/textLayout';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';
import { createText, getTextContent } from '../../src/shared/objects/text';
import type { TextSnapshot } from '../../src/shared/objects/text';
import { Harness, addNote, flush, newProbe, press, release } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
  setDefaultMeasurer((t) => t.length * 10);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setDefaultMeasurer(null);
});

const textbox = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const textEls = () => [...document.querySelectorAll<HTMLElement>('[data-text-object]')];
const typeText = (value: string) => fireEvent.input(textbox(), { target: { value } });

function placeTextInApp() {
  render(<App />);
  fireEvent.keyDown(window, { key: 't' });
  fireEvent.pointerDown(screen.getByTestId('board-viewport'), { clientX: 300, clientY: 200, pointerId: 1, button: 0 });
}

function harnessWithText(text = 'Went well') {
  const probe = newProbe();
  render(<Harness probe={probe} />);
  let id = '';
  act(() => {
    id = createText(probe.doc, { x: 50, y: 60 }, 'u') as string;
    if (text) getTextContent(probe.doc, id)?.insert(0, text);
  });
  return { probe, id };
}

describe('text objects', () => {
  it('TC-19 caret at the end, Enter inserts a newline, Escape keeps the text selected', () => {
    placeTextInApp();
    typeText('Went well');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    const box = textbox();
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(9);
    typeText('Went well\nTwo');
    expect(textEls()[0].textContent).toBe('Went well\nTwo');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(textEls()).toHaveLength(1);
    expect(textEls()[0].dataset.selected).toBe('true');
    expect(textEls()[0].getAttribute('aria-label')).toBe('Went well\nTwo');
  });

  it('double-click edits existing text', () => {
    placeTextInApp();
    typeText('Hi');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    fireEvent.doubleClick(textEls()[0]);
    expect(textbox().value).toBe('Hi');
  });

  it('TC-20 Escape with no characters removes the object and clears the selection', () => {
    placeTextInApp();
    expect(textEls()).toHaveLength(1);
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(textEls()).toHaveLength(0);
    expect(screen.queryByRole('toolbar', { name: 'Text tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('whitespace-only text is kept', () => {
    placeTextInApp();
    typeText('  ');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(textEls()).toHaveLength(1);
  });

  it('typing is limited to 5,000 characters', () => {
    placeTextInApp();
    typeText('x'.repeat(5001));
    expect(textbox().value).toHaveLength(5000);
  });

  it('TC-21 text toolbar shows sizes with M pressed; XL keeps the top-left and re-measures', () => {
    placeTextInApp();
    typeText('abc');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
    for (const s of ['S', 'M', 'L', 'XL']) expect(screen.getByRole('button', { name: s })).toBeTruthy();
    expect(pressed('M')).toBe('true');
    const before = { left: textEls()[0].style.left, top: textEls()[0].style.top };
    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    expect(pressed('XL')).toBe('true');
    expect(pressed('M')).toBe('false');
    expect(textEls()[0].style.left).toBe(before.left);
    expect(textEls()[0].style.top).toBe(before.top);
    expect(textEls()[0].style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(parseFloat(textEls()[0].style.height)).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(textEls()).toHaveLength(0);
  });

  it('TC-22 a single selected text shows only the left and right handles', () => {
    harnessWithText();
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    const handles = [...document.querySelectorAll('[data-handle]')].map((h) => h.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'w']);
  });

  it('dragging the right handle fixes the width and rewraps', () => {
    const { probe, id } = harnessWithText('aaa bbb ccc');
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    const right = screen.getByRole('button', { name: 'Resize right' });
    const w = (snapshot(probe.doc)[0] as TextSnapshot).width as number;
    fireEvent.pointerDown(right, { clientX: 50 + w, clientY: 70, pointerId: 1, button: 0 });
    fireEvent.pointerMove(right, { clientX: 50 + 45, clientY: 70, pointerId: 1 });
    flush();
    fireEvent.pointerUp(right, { clientX: 50 + 45, clientY: 70, pointerId: 1 });
    const t = snapshot(probe.doc).find((o) => o.id === id) as TextSnapshot;
    expect(t.widthMode).toBe('fixed');
    expect(t.width).toBe(45);
    expect(t.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-23 text with a sticky shows all handles; resize repositions text, font size unchanged', () => {
    const { probe, id } = harnessWithText('abc');
    addNote(probe, 'n', { x: 0, y: 0 });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(8);
    const before = snapshot(probe.doc).find((o) => o.id === id) as TextSnapshot;
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(se, { clientX: 250, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerMove(se, { clientX: 500, clientY: 400, pointerId: 1 });
    flush();
    fireEvent.pointerUp(se, { clientX: 500, clientY: 400, pointerId: 1 });
    const after = snapshot(probe.doc).find((o) => o.id === id) as TextSnapshot;
    expect(after.size).toBe(before.size);
    expect(after.widthMode).toBe('auto');
    expect(after.height).toBe(before.height);
    expect(after.x).not.toBe(before.x);
  });

  it('TC-24 remote delete during editing ends editing silently', () => {
    const { probe, id } = harnessWithText('abc');
    fireEvent.doubleClick(textEls()[0]);
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => {
      deleteObjects(probe.doc, [id]);
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(snapshot(probe.doc)).toHaveLength(0);
    expect(probe.editingId).toBeNull();
  });

  it('TC-25 type then Ctrl+Z reverts text and stored box together in one step', () => {
    placeTextInApp();
    typeText('ab');
    act(() => {
      vi.advanceTimersByTime(10);
    });
    typeText('abcdef');
    const widthBefore = textEls()[0].style.width;
    expect(widthBefore).toBe('62px');
    fireEvent.keyDown(textbox(), { key: 'z', ctrlKey: true });
    // Create + typing share one undo window, so one undo removes the whole text.
    expect(textEls()).toHaveLength(0);
  });

  it('move and delete come from the generic selection code', () => {
    const { probe } = harnessWithText('abc');
    const el = textEls()[0];
    press(el, 60, 70);
    release(el, 60, 70);
    expect(el.dataset.selected).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(snapshot(probe.doc)[0].x).toBe(51);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(probe.doc)).toHaveLength(0);
    act(() => {
      probe.undo.undo();
    });
    expect(snapshot(probe.doc)).toHaveLength(1);
  });
});
