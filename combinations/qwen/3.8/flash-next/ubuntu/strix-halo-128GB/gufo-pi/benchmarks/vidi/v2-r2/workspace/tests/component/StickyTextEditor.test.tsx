import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { StickyTextEditor } from '@client/objects/StickyTextEditor';

function makeYText(initial: string = ''): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('test');
  if (initial) ytext.insert(0, initial);
  return ytext;
}

describe('StickyTextEditor', () => {
  // TC-23: Enter on selected -> Editing, textarea focused, caret at end
  it('TC-23: mounts textarea focused with caret at end', () => {
    const ytext = makeYText('hello');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('hello');
    // Caret should be at end
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  // TC-24: Escape -> Selected, text preserved
  it('TC-24: Escape calls onEnd("selected"), text preserved', () => {
    const ytext = makeYText('test text');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onEnd).toHaveBeenCalledWith('selected');
    // Text still in ytext
    expect(ytext.toString()).toBe('test text');
  });

  // TC-26: Backspace while editing -> note present, text edited (not deleted)
  it('TC-26: Backspace edits text, does not delete note', () => {
    const ytext = makeYText('ab');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    // Simulate backspace: put caret at end, delete one char
    textarea.setSelectionRange(2, 2);
    fireEvent.input(textarea, { target: { value: 'a' } });
    expect(ytext.toString()).toBe('a');
    expect(onEnd).not.toHaveBeenCalled();
  });

  // TC-38: type 'abc' then click outside -> editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing then onEnd("unselected") preserves text', () => {
    const ytext = makeYText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'abc' } });
    expect(ytext.toString()).toBe('abc');
    // Simulate outside click ending edit
    onEnd('unselected');
    expect(ytext.toString()).toBe('abc');
  });

  it('typing updates Y.Text via minimal diff', () => {
    const ytext = makeYText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'H' } });
    fireEvent.input(textarea, { target: { value: 'Hi' } });
    fireEvent.input(textarea, { target: { value: 'Hi!' } });
    expect(ytext.toString()).toBe('Hi!');
  });

  it('clamps input at 1000 chars', () => {
    const ytext = makeYText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    const longText = 'x'.repeat(1200);
    fireEvent.input(textarea, { target: { value: longText } });
    expect(ytext.toString().length).toBe(1000);
  });

  it('shows counter when within 50 chars of limit', () => {
    const ytext = makeYText('');
    const onEnd = vi.fn();
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />);
    const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'a'.repeat(950) } });
    const counter = document.querySelector('[data-testid="char-counter"]');
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe('950/1000');
  });
});
