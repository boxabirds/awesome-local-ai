import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, fireEvent, act } from '@testing-library/react';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';

function createYText(initialText: string = ''): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText('test');
  if (initialText) {
    text.insert(0, initialText);
  }
  return text;
}

describe('StickyTextEditor', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: textarea is focused on mount with caret at end', () => {
    const ytext = createYText('hello');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea')!;
    expect(textarea).toBe(document.activeElement);
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing with "selected" and preserves text', () => {
    const ytext = createYText('hello');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea')!;
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onEnd).toHaveBeenCalledWith('selected');
    // Text is preserved
    expect(ytext.toString()).toBe('hello');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing deletes a character, not the note', () => {
    const ytext = createYText('ab');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea')!;
    // Simulate backspace: set value to 'a' and trigger input
    fireEvent.input(textarea, { target: { value: 'a' } });

    expect(ytext.toString()).toBe('a');
    // onEnd should NOT have been called (note is not deleted)
    expect(onEnd).not.toHaveBeenCalled();
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing updates Y.Text and outside click ends editing', () => {
    const ytext = createYText('');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea')!;

    // Type 'abc'
    act(() => {
      fireEvent.input(textarea, { target: { value: 'abc' } });
    });

    expect(ytext.toString()).toBe('abc');

    // Click outside (simulated by pointerdown on document)
    act(() => {
      const outsideEvent = new Event('pointerdown', { bubbles: true });
      document.body.dispatchEvent(outsideEvent);
    });

    expect(onEnd).toHaveBeenCalledWith('unselected');
  });

  // Additional: text limit
  it('clamps text to 1000 characters on input', () => {
    const ytext = createYText('');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea')!;
    const longText = 'a'.repeat(1200);

    act(() => {
      fireEvent.input(textarea, { target: { value: longText } });
    });

    expect(ytext.toString()).toHaveLength(1000);
  });

  // Additional: counter visible
  it('shows character counter when within 50 chars of limit', () => {
    const ytext = createYText('a'.repeat(960));
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const counter = container.querySelector('[data-testid="sticky-char-counter"]');
    expect(counter).toBeTruthy();
    expect(counter!.textContent).toBe('960/1000');
  });

  it('does not show character counter when well below limit', () => {
    const ytext = createYText('hello');
    const onEnd = vi.fn();

    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const counter = container.querySelector('[data-testid="sticky-char-counter"]');
    expect(counter).toBeNull();
  });
});
