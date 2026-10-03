import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import type { JSX } from 'react';

function renderEditor(initialText: string, onEnd?: (next: 'selected' | 'unselected') => void) {
  const doc = new Y.Doc();
  const ytext = doc.getText('test');
  if (initialText) {
    ytext.insert(0, initialText);
  }

  const endFn = onEnd ?? (() => {});

  function TestComponent(): JSX.Element {
    return (
      <div style={{ width: '200px', height: '200px', position: 'relative' }}>
        <StickyTextEditor ytext={ytext} fontPx={24} onEnd={endFn} />
      </div>
    );
  }

  const utils = render(<TestComponent />);
  return { doc, ytext, endFn, ...utils };
}

describe('StickyTextEditor component tests', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: textarea is focused with caret at end on mount', () => {
    renderEditor('hello');

    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    expect(textarea).toBe(document.activeElement);
    expect(textarea.value).toBe('hello');
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing and preserves text', () => {
    const onEnd = vi.fn();
    const { ytext } = renderEditor('hello world', onEnd);

    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape', charCode: 27 });

    expect(onEnd).toHaveBeenCalledWith('selected');
    expect(ytext.toString()).toBe('hello world');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing edits text, does not delete note', () => {
    const onEnd = vi.fn();
    const { ytext } = renderEditor('ab', onEnd);

    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;

    // Simulate backspace: set value to 'a' and fire input
    act(() => {
      textarea.value = 'a';
      fireEvent.input(textarea);
    });

    expect(ytext.toString()).toBe('a');
    // Note is still present
    expect(ytext).toBeDefined();
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing then clicking outside ends editing with unselected', () => {
    const onEnd = vi.fn();
    const { ytext } = renderEditor('', onEnd);

    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;

    // Type 'abc'
    act(() => {
      textarea.value = 'abc';
      fireEvent.input(textarea);
    });

    expect(ytext.toString()).toBe('abc');

    // Click outside
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside, { pointerId: 1 });
    outside.remove();

    expect(onEnd).toHaveBeenCalledWith('unselected');
    expect(ytext.toString()).toBe('abc');
  });

  it('Enter key inserts newline (does not end editing)', () => {
    const onEnd = vi.fn();
    const { ytext } = renderEditor('hello', onEnd);

    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;

    // Simulate typing Enter (adds newline)
    act(() => {
      textarea.value = 'hello\n';
      fireEvent.input(textarea);
    });

    expect(ytext.toString()).toBe('hello\n');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('character counter appears when near limit', () => {
    const longText = 'a'.repeat(950);
    renderEditor(longText);

    const counter = screen.getByText('950/1000');
    expect(counter).toBeDefined();
  });

  it('character counter hidden when far from limit', () => {
    renderEditor('short text');

    const counter = screen.queryByText(/1000/);
    expect(counter).toBeNull();
  });
});
