import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';

/** A board id for the component under test; the fake provider never reaches a server. */
const BOARD_ID = 'component-board-under-test';
import { STICKY_FONT_MAX_PX, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { dispatchPointer, VIEWPORT } from './helpers/events';

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const vp = (): HTMLElement => screen.getByTestId('board-viewport');
const editor = (): HTMLTextAreaElement =>
  screen.getByTestId('sticky-note-text') as HTMLTextAreaElement;
const centreX = VIEWPORT.width / 2;
const centreY = VIEWPORT.height / 2;

function doubleClick(el: Element, x: number, y: number): void {
  dispatchPointer(el, 'pointerdown', x, y);
  dispatchPointer(el, 'pointerup', x, y);
  dispatchPointer(el, 'pointerdown', x, y);
  dispatchPointer(el, 'pointerup', x, y);
  fireEvent.dblClick(el, { clientX: x, clientY: y });
  flush();
}

/** Create a note and return with its editor open. */
function openEditor(): void {
  doubleClick(vp(), centreX, centreY);
}

function typeInto(text: string): void {
  fireEvent.input(editor(), { target: { value: text } });
  flush();
}

function pressEscape(): void {
  fireEvent.keyDown(editor(), { key: 'Escape' });
  flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('sticky text editing (sticky.text)', () => {
  // TC-25: typing inserts text at the caret and the note shows the new string.
  it('TC-25 stores typed text and shows it after editing', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('Ship the demo');
    expect(editor().value).toBe('Ship the demo');
    pressEscape();
    expect(screen.getByTestId('sticky-note-text').textContent).toBe('Ship the demo');
  });

  // TC-26: exactly 1000 characters accepted; one more is not applied.
  it('TC-26 clamps input to 1000 characters', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('a'.repeat(1000));
    expect(editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    // A further character is dropped; the value is still exactly 1000 a's.
    fireEvent.input(editor(), { target: { value: 'a'.repeat(999) + 'ab' } });
    flush();
    expect(editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editor().value.endsWith('a')).toBe(true);
  });

  // TC-27: at 100% a short label renders at the maximum font size (it fits).
  it('TC-27 renders short text at the maximum font size', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('Idea');
    expect(editor().style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
    expect(editor().dataset.overflow).toBe('false');
  });

  // TC-28: a completed IME composition writes once and honours the limit.
  it('TC-28 writes a finished IME composition once, clamped to the limit', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    const composed = '日本語のアイデア';
    fireEvent.compositionStart(editor());
    editor().value = composed;
    fireEvent.compositionEnd(editor());
    flush();
    pressEscape();
    expect(screen.getByTestId('sticky-note-text').textContent).toBe(composed);
  });

  it('TC-28b clamps a long IME composition to the limit', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    fireEvent.compositionStart(editor());
    editor().value = 'あ'.repeat(STICKY_TEXT_MAX_CHARS + 50);
    fireEvent.compositionEnd(editor());
    flush();
    expect(editor().value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  // TC-29: Escape ends editing and keeps the text; outside pointerdown ends too.
  it('TC-29 Escape ends editing and keeps the text', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('persisted');
    pressEscape();
    // Editing ended: a display text (div) is shown, the toolbar is visible.
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');
    expect(screen.getByTestId('sticky-note-text').textContent).toBe('persisted');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-29b an outside pointerdown ends editing and keeps the text', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('kept');
    // Press on empty board space (outside the note) ends editing.
    dispatchPointer(vp(), 'pointerdown', 30, 30);
    dispatchPointer(vp(), 'pointerup', 30, 30);
    flush();
    const note = screen.getByTestId('sticky-note');
    expect(note.dataset.selected).toBe('false');
    expect(screen.getByTestId('sticky-note-text').textContent).toBe('kept');
  });

  // Character counter appears when 50 or fewer characters remain (at 950).
  it('shows a character counter once 50 or fewer characters remain', () => {
    render(<Board boardId={BOARD_ID} />);
    openEditor();
    typeInto('a'.repeat(949));
    expect(screen.queryByTestId('sticky-note-counter')).toBeNull();
    typeInto('a'.repeat(950));
    expect(screen.getByTestId('sticky-note-counter').textContent).toBe(
      '950/1000',
    );
  });

  // The create button tooltip matches the PRD wording exactly.
  it('documents the double-click shortcut in the create button tooltip', () => {
    render(<Board boardId={BOARD_ID} />);
    expect(screen.getByTestId('create-sticky').getAttribute('title')).toBe(
      'Sticky note \u2013 or double-click the board',
    );
  });
});
