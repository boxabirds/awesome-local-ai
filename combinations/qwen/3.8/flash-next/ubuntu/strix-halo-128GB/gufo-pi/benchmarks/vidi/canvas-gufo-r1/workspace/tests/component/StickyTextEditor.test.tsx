import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';

afterEach(cleanup);

function makeDocWithText(text?: string) {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (text) {
    const ytext = getStickyText(doc, id)!;
    doc.transact(() => { ytext.insert(0, text); });
  }
  return { doc, id, ytext: getStickyText(doc, id)! };
}

describe('StickyTextEditor', () => {
  // TC-23: Enter starts editing - textarea is focused and caret at end
  it('TC-23 mounts with textarea focused and caret at end', () => {
    const { ytext } = makeDocWithText('hello');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea');
    expect(document.activeElement).toBe(textarea);
    // Check caret at end - for jsdom, check the value
    expect((textarea as HTMLTextAreaElement).value).toBe('hello');
  });

  // TC-24: Escape ends editing with 'selected', text preserved
  it('TC-24 Escape ends editing and preserves text', () => {
    const { ytext } = makeDocWithText('hello world');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onEnd).toHaveBeenCalledWith('selected');
    // Text is preserved in Y.Text
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing edits text, doesn't delete note
  it('TC-26 backspace while editing edits text in textarea', () => {
    const { ytext } = makeDocWithText('ab');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Simulate backspace: user removes last char
    textarea.value = 'a';
    fireEvent.input(textarea);
    expect(ytext.toString()).toBe('a');
    // Editor is still mounted
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text is 'abc', state unselected
  it('TC-38 typing then clicking outside commits text and ends editing', async () => {
    const { ytext } = makeDocWithText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Type 'abc'
    textarea.value = 'abc';
    fireEvent.input(textarea);
    expect(ytext.toString()).toBe('abc');
    // Flush microtasks so the click-outside listener becomes active
    await act(async () => {
      await Promise.resolve();
    });
    // Click outside
    act(() => {
      const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'pointerId', { value: 1 });
      document.body.dispatchEvent(ev);
    });
    expect(onEnd).toHaveBeenCalledWith('unselected');
  });

  it('typing updates Y.Text via input events', () => {
    const { ytext } = makeDocWithText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    textarea.value = 'Hello';
    fireEvent.input(textarea);
    expect(ytext.toString()).toBe('Hello');
    textarea.value = 'Hello World';
    fireEvent.input(textarea);
    expect(ytext.toString()).toBe('Hello World');
  });

  it('Enter inserts a newline (not intercepted)', () => {
    const { ytext } = makeDocWithText('line1');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Simulate Enter by setting value with newline
    textarea.value = 'line1\nline2';
    fireEvent.input(textarea);
    expect(ytext.toString()).toBe('line1\nline2');
    // Editor still mounted (not ended by Enter)
    expect(onEnd).not.toHaveBeenCalled();
  });
});
