/**
 * Component tests for sticky text editing (TC-23, TC-24, TC-26, TC-38).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Harness, type HarnessResult } from './harness';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import type * as Y from 'yjs';

let harness: HarnessResult | null = null;

const setup = () => {
  harness = null;
  render(<Harness onReady={(result) => (harness = result)} />);
  if (!harness) throw new Error('harness did not report ready');
  return harness;
};

beforeEach(() => {
  cleanup();
});

const press = (el: Element, x: number, y: number): void => {
  fireEvent(
    el,
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 }),
  );
};
const release = (el: Element, x: number, y: number): void => {
  fireEvent(
    el,
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 }),
  );
};

const note = (): HTMLElement => screen.getAllByTestId('sticky-note')[0] as HTMLElement;
const editor = (): HTMLTextAreaElement =>
  screen.getByLabelText('Sticky note text') as HTMLTextAreaElement;

/** Type `text` into the mounted textarea through the React input path. */
const typeInto = (el: HTMLTextAreaElement, text: string): void => {
  fireEvent.change(el, { target: { value: text } });
};

/** Create a note with initial `text`, then click it once to select it. */
const createAndSelect = (text: string): string => {
  const { doc } = harness!;
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
    const ytext: Y.Text | undefined = getStickyText(doc, id);
    if (ytext && text.length > 0) doc.transact(() => ytext.insert(0, text));
  });
  press(note(), 400, 300);
  release(note(), 400, 300);
  return id;
};

describe('edit start and end (TC-23, TC-24)', () => {
  it('TC-23: Enter on a selected note starts editing with the caret at the end', () => {
    setup();
    createAndSelect('hello');
    expect(screen.queryByLabelText('Sticky note text')).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Enter' });

    const textarea = editor();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('hello');
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  it('TC-24: Escape ends editing and keeps all text typed so far', () => {
    setup();
    const id = createAndSelect('');
    fireEvent.doubleClick(note());
    typeInto(editor(), 'kept text');

    fireEvent.keyDown(editor(), { key: 'Escape' });

    expect(screen.queryByLabelText('Sticky note text')).not.toBeInTheDocument();
    expect(getStickyText(harness!.doc, id)?.toString()).toBe('kept text');
    expect(note().dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });
});

describe('typing and deleting text (TC-26, TC-38)', () => {
  it('TC-26: Backspace while editing edits the text and never deletes the note', () => {
    setup();
    const id = createAndSelect('ab');
    fireEvent.doubleClick(note());
    const textarea = editor();

    // The browser applies backspace, then React sees the shortened value.
    typeInto(textarea, 'a');
    fireEvent.keyDown(textarea, { key: 'Backspace' });

    expect(snapshot(harness!.doc)).toHaveLength(1);
    expect(getStickyText(harness!.doc, id)?.toString()).toBe('a');
  });

  it('TC-38: typing then clicking outside unmounts the editor and keeps the text', () => {
    setup();
    const id = createAndSelect('');
    fireEvent.doubleClick(note());
    typeInto(editor(), 'abc');

    // A pointerdown on the bare board ends editing and clears the selection.
    press(screen.getByTestId('board-grid'), 700, 700);
    release(screen.getByTestId('board-grid'), 700, 700);

    expect(screen.queryByLabelText('Sticky note text')).not.toBeInTheDocument();
    expect(getStickyText(harness!.doc, id)?.toString()).toBe('abc');
    expect(note().dataset.selected).toBe('false');
  });

  it('Enter inside the note inserts a newline instead of ending editing', () => {
    setup();
    const id = createAndSelect('');
    fireEvent.doubleClick(note());
    const textarea = editor();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    typeInto(textarea, 'line one\nline two');

    expect(getStickyText(harness!.doc, id)?.toString()).toBe('line one\nline two');
    expect(screen.getByLabelText('Sticky note text')).toBeInTheDocument();
  });
});
