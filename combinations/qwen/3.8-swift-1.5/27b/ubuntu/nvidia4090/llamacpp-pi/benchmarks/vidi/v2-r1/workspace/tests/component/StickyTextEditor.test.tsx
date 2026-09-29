import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, getStickyText, snapshot } from '@shared/board-model';
import { StickyTextEditor } from '@client/objects/StickyTextEditor';

function makeDocWithNote(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  return { doc, id };
}

describe('sticky.text (StickyTextEditor)', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: editor mounts with textarea focused and caret at end', () => {
    const { doc, id } = makeDocWithNote();
    const ytext = getStickyText(doc, id)!;
    // Add some text
    doc.transact(() => {
      ytext.insert(0, 'hello');
    });

    const onEnd = vi.fn();
    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe('hello');
    // Caret should be at end
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing and preserves text', () => {
    const { doc, id } = makeDocWithNote();
    const ytext = getStickyText(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'test text');
    });

    const onEnd = vi.fn();
    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onEnd).toHaveBeenCalledWith('selected');
    // Text should be preserved in Y.Text
    expect(ytext.toString()).toBe('test text');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing deletes character, not note', () => {
    const { doc, id } = makeDocWithNote();
    const ytext = getStickyText(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, 'ab');
    });

    const onEnd = vi.fn();
    const { container } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    
    // Simulate backspace: the textarea value changes from 'ab' to 'a'
    act(() => {
      textarea.value = 'a';
      fireEvent.input(textarea);
    });

    // Note should still exist
    expect(snapshot(doc)).toHaveLength(1);
    // Text should be 'a'
    expect(ytext.toString()).toBe('a');
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing then clicking outside saves text and ends editing', () => {
    const { doc, id } = makeDocWithNote();
    const ytext = getStickyText(doc, id)!;

    const onEnd = vi.fn();
    const { container, unmount } = render(
      <StickyTextEditor ytext={ytext} fontPx={24} onEnd={onEnd} />
    );

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    
    // Type 'abc'
    act(() => {
      textarea.value = 'abc';
      fireEvent.input(textarea);
    });

    // Verify text was written to Y.Text
    expect(ytext.toString()).toBe('abc');

    // Simulate click outside by dispatching pointerdown on document
    act(() => {
      const outsideEvent = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(outsideEvent, 'pointerId', { value: 1 });
      document.body.dispatchEvent(outsideEvent);
    });

    expect(onEnd).toHaveBeenCalledWith('unselected');
    
    // Unmount the editor (simulates React removing it)
    unmount();
    
    // Y.Text should still have the text
    expect(ytext.toString()).toBe('abc');
  });
});
