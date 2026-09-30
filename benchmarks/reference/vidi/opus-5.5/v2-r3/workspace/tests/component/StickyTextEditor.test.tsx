import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_FONT_MAX_PX, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { LONG_PARAGRAPH_1000, LONG_PARAGRAPH_1200, RETRO_ITEM, SHORT_PHRASE, proseOfLength } from '../fixtures/texts';
import { keyDown, model, noteEl, noteToolbar, press, renderApp } from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;

function setupWithText(text: string) {
  const utils = renderApp();
  const id = model((doc) => {
    const newId = createSticky(doc, { x: HALF, y: HALF });
    getStickyText(doc, newId)!.insert(0, text);
    return newId;
  });
  return { ...utils, id, el: noteEl(id), ytext: getStickyText(window.__vidi6!.doc, id)! };
}

function textbox(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
}

describe('StickyTextEditor in the app (sticky.text)', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    const { el } = setupWithText(SHORT_PHRASE);
    press(el);
    const ev = keyDown(el, 'Enter');
    expect(ev.defaultPrevented).toBe(true);
    const ta = textbox();
    expect(ta).toHaveFocus();
    expect(ta.value).toBe(SHORT_PHRASE);
    expect(ta.selectionStart).toBe(SHORT_PHRASE.length);
    expect(ta.selectionEnd).toBe(SHORT_PHRASE.length);
    expect(el.dataset.editing).toBe('true');
    expect(noteToolbar()).toBeNull(); // hidden while editing
  });

  it('TC-24 Escape ends editing, keeps the text and leaves the note selected', async () => {
    const user = userEvent.setup();
    const { el, ytext } = setupWithText('Faster');
    fireEvent.doubleClick(el);
    await user.type(textbox(), ' onboarding');
    expect(ytext.toString()).toBe(SHORT_PHRASE);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext.toString()).toBe(SHORT_PHRASE);
    expect(el.dataset.selected).toBe('true');
    expect(el.dataset.editing).toBe('false');
    expect(el).toHaveFocus();
    expect(noteToolbar()).toBeInTheDocument();
    expect(screen.getByTestId('sticky-text')).toHaveTextContent(SHORT_PHRASE);
  });

  it('TC-26 Backspace while editing edits text and never deletes the note', async () => {
    const user = userEvent.setup();
    const { el, ytext } = setupWithText('ab');
    press(el);
    keyDown(el, 'Enter');
    await user.keyboard('{Backspace}');
    expect(ytext.toString()).toBe('a');
    expect(el).toBeInTheDocument();
    await user.keyboard('{Delete}');
    expect(el).toBeInTheDocument();
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(1);
  });

  it('TC-38 type then click outside: editor unmounted, text kept, note unselected', async () => {
    const user = userEvent.setup();
    const { el, ytext, viewport } = setupWithText('');
    fireEvent.doubleClick(el);
    await user.type(textbox(), 'abc');
    press(viewport, { clientX: 800, clientY: 600 });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext.toString()).toBe('abc');
    expect(el.dataset.selected).toBe('false');
    expect(el.dataset.editing).toBe('false');
  });

  it('Enter inside the note adds a new line', async () => {
    const user = userEvent.setup();
    const { el, ytext } = setupWithText('Went well');
    fireEvent.doubleClick(el);
    await user.keyboard('{Enter}Try: demos');
    expect(ytext.toString()).toBe('Went well\nTry: demos');
    expect(textbox()).toBeInTheDocument();
  });

  it('an empty note shows no placeholder when not editing', () => {
    const { el } = setupWithText('');
    expect(el).toHaveTextContent(/^$/);
    expect(screen.getByTestId('sticky-text')).toHaveTextContent('');
  });

  it('display text keeps line breaks of a multi-line note', () => {
    setupWithText(RETRO_ITEM);
    expect(screen.getByTestId('sticky-text').textContent).toBe(RETRO_ITEM);
    // jsdom has no layout, so every text fits at the largest size.
    expect(screen.getByTestId('sticky-text').style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);
  });
});

describe('StickyTextEditor standalone (length limit and counter)', () => {
  function mountEditor(initial: string) {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, initial);
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={STICKY_FONT_MAX_PX} onEnd={onEnd} />);
    return { ytext, onEnd, ta: textbox() };
  }

  it('pasting 1,200 characters into an empty note keeps 1,000 and shows 1000/1000', async () => {
    const user = userEvent.setup();
    const { ytext, ta } = mountEditor('');
    await user.click(ta);
    await user.paste(LONG_PARAGRAPH_1200);
    expect(ytext.toString()).toBe(LONG_PARAGRAPH_1000);
    expect(ta.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(ta.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByText('1000/1000')).toBeInTheDocument();
  });

  it('counter hidden at 949 characters, shown from 950', async () => {
    const user = userEvent.setup();
    const { ta } = mountEditor(proseOfLength(949));
    expect(screen.queryByText(/\/1000$/)).toBeNull();
    await user.click(ta);
    await user.keyboard('x');
    expect(screen.getByText('950/1000')).toBeInTheDocument();
  });

  it('typing at 1,000 characters adds nothing', async () => {
    const user = userEvent.setup();
    const { ytext } = mountEditor(LONG_PARAGRAPH_1000);
    await user.keyboard('xyz');
    expect(ytext.toString()).toBe(LONG_PARAGRAPH_1000);
  });

  it('Escape calls onEnd("selected") without writing', async () => {
    const user = userEvent.setup();
    const { ytext, onEnd } = mountEditor('Keep me');
    let updates = 0;
    ytext.doc!.on('update', () => updates++);
    await user.keyboard('{Escape}');
    expect(onEnd).toHaveBeenCalledWith('selected');
    expect(updates).toBe(0);
  });

  it('a pointerdown outside calls onEnd("unselected")', () => {
    const { onEnd } = mountEditor('Keep me');
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onEnd).toHaveBeenCalledWith('unselected');
  });

  it('input during IME composition is written once, on compositionend', () => {
    const { ytext, ta } = mountEditor('');
    fireEvent.compositionStart(ta);
    fireEvent.input(ta, { target: { value: 'に' } });
    expect(ytext.toString()).toBe('');
    fireEvent.input(ta, { target: { value: '日本' } });
    fireEvent.compositionEnd(ta);
    expect(ytext.toString()).toBe('日本');
  });
});
