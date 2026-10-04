import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, getStickyText } from '../../src/shared/board-model';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

function setupWithText(initialText = '') {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const ytext = getStickyText(doc, id)!;
  if (initialText) {
    ytext.insert(0, initialText);
  }

  const onEndMock = vi.fn();

  return {
    doc,
    id,
    ytext,
    onEndMock,
    render: () => render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEndMock} />
    ),
  };
}

describe('StickyTextEditor', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: textarea is focused with caret at end on mount', () => {
    const { render: renderEditor } = setupWithText('hello');
    renderEditor();

    const textarea = screen.getByTestId('sticky-textarea');
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue('hello');
    // Caret at end
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(5);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing as selected, text preserved', () => {
    const { render: renderEditor, ytext, onEndMock } = setupWithText('hello world');
    renderEditor();

    const textarea = screen.getByTestId('sticky-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(onEndMock).toHaveBeenCalledWith('selected');
    // Text is preserved in Y.Text
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing deletes a character, not the note', () => {
    const { render: renderEditor, ytext } = setupWithText('ab');
    renderEditor();

    const textarea = screen.getByTestId('sticky-textarea');
    // Simulate backspace: set value to 'a' and trigger input
    act(() => {
      (textarea as HTMLTextAreaElement).value = 'a';
      fireEvent.input(textarea);
    });

    // Note is still present (text is 'a', not deleted)
    expect(ytext.toString()).toBe('a');
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing then clicking outside saves text and ends editing', () => {
    const { render: renderEditor, ytext, onEndMock } = setupWithText('');
    renderEditor();

    const textarea = screen.getByTestId('sticky-textarea');

    // Type 'abc'
    act(() => {
      (textarea as HTMLTextAreaElement).value = 'abc';
      fireEvent.input(textarea);
    });

    // Click outside (simulated via pointerdown on document)
    act(() => {
      const outsideEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 0,
        clientY: 0,
      });
      document.body.dispatchEvent(outsideEvent);
    });

    expect(ytext.toString()).toBe('abc');
    expect(onEndMock).toHaveBeenCalledWith('unselected');
  });

  // Additional: typing updates Y.Text
  it('typing characters updates Y.Text', () => {
    const { render: renderEditor, ytext } = setupWithText('');
    renderEditor();

    const textarea = screen.getByTestId('sticky-textarea');
    act(() => {
      (textarea as HTMLTextAreaElement).value = 'Hello';
      fireEvent.input(textarea);
    });

    expect(ytext.toString()).toBe('Hello');
  });

  // Additional: character counter appears near limit
  it('shows character counter when near limit', () => {
    const longText = 'a'.repeat(960); // 40 chars remaining
    const { render: renderEditor } = setupWithText(longText);
    renderEditor();

    const counter = screen.getByTestId('char-counter');
    expect(counter).toBeInTheDocument();
    expect(counter).toHaveTextContent('960/1000');
  });

  // Additional: character counter hidden when well below limit
  it('hides character counter when well below limit', () => {
    const { render: renderEditor } = setupWithText('short text');
    renderEditor();

    expect(screen.queryByTestId('char-counter')).not.toBeInTheDocument();
  });
});
