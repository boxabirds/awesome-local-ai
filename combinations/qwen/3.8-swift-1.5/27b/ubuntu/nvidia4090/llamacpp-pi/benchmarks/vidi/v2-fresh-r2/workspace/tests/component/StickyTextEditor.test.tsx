/**
 * Component tests for sticky text editor (sticky.text).
 * TC-23, TC-24, TC-26, TC-38.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

function makeDocWithNote(text = ''): { doc: Y.Doc; id: string; ytext: Y.Text } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  const ytext = getStickyText(doc, id)!;
  if (text) {
    ytext.insert(0, text);
  }
  return { doc, id, ytext };
}

describe('sticky.text (StickyTextEditor)', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: editor mounts with textarea focused and caret at end', () => {
    const { ytext } = makeDocWithNote('hello');

    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={vi.fn()} />);

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveFocus();
    expect(textarea.value).toBe('hello');
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing, text preserved', () => {
    const { ytext } = makeDocWithNote('hello world');
    const onEnd = vi.fn();

    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);

    const textarea = screen.getByTestId('sticky-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(onEnd).toHaveBeenCalledWith('selected');
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing deletes character, not note', () => {
    const { doc, id, ytext } = makeDocWithNote('ab');
    const onEnd = vi.fn();

    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    // Simulate backspace: change value and fire input
    textarea.value = 'a';
    fireEvent.input(textarea);

    expect(ytext.toString()).toBe('a');
    // Note still exists
    expect(snapshot(doc).find((n) => n.id === id)).toBeDefined();
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: type text then click outside → text saved, editor ends', () => {
    const { ytext } = makeDocWithNote('');
    const onEnd = vi.fn();

    const { unmount } = render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    // Type 'abc'
    textarea.value = 'abc';
    fireEvent.input(textarea);

    expect(ytext.toString()).toBe('abc');

    // Click outside → onEnd('unselected')
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside);

    expect(onEnd).toHaveBeenCalledWith('unselected');
    unmount();
    outside.remove();
  });
});
