import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { StickyNote } from '../../src/client/objects/StickyNote';

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StickyTextEditor component tests', () => {
  // TC-23: Enter on selected → Editing, textarea focused, caret at end
  it('TC-23: starting edit shows textarea focused with caret at end', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={true}
        onSelect={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const textarea = container.querySelector('textarea[data-testid="sticky-text-editor"]') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea === document.activeElement).toBe(true);
    // Caret at end (empty text, so position 0)
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });

  // TC-24: Escape → Selected, text preserved
  it('TC-24: Escape ends editing and preserves text', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    let endedWith: string | null = null;

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={true}
        onSelect={() => {}}
        onStartEdit={() => {}}
        onEndEdit={(next) => { endedWith = next; }}
      />
    );

    const textarea = container.querySelector('textarea[data-testid="sticky-text-editor"]') as HTMLTextAreaElement;

    // Type some text
    act(() => {
      textarea.value = 'Hello';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Press Escape
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(endedWith).toBe('selected');
    // Text is preserved in the Y.Text
    const ytext = getStickyText(doc, id)!;
    expect(ytext.toString()).toBe('Hello');
  });

  // TC-26: Backspace while editing 'ab' → note present, text 'a'
  it('TC-26: Backspace while editing does not delete the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={true}
        onSelect={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
      />
    );

    const textarea = container.querySelector('textarea[data-testid="sticky-text-editor"]') as HTMLTextAreaElement;

    // Set text to 'ab'
    act(() => {
      textarea.value = 'ab';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Simulate Backspace (in a real browser this would delete 'b')
    act(() => {
      textarea.value = 'a';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Note should still exist
    expect(snapshot(doc)).toHaveLength(1);
    // Text should be 'a'
    const ytext = getStickyText(doc, id)!;
    expect(ytext.toString()).toBe('a');
  });

  // TC-38: type 'abc' then click outside → editor unmounted, Y.Text 'abc', Unselected
  it('TC-38: typing then clicking outside ends editing with text preserved', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const note = snapshot(doc)[0];

    let endedWith: string | null = null;

    const { container } = render(
      <StickyNote
        note={note}
        doc={doc}
        zoom={1}
        selected={true}
        editing={true}
        onSelect={() => {}}
        onStartEdit={() => {}}
        onEndEdit={(next) => { endedWith = next; }}
      />
    );

    const textarea = container.querySelector('textarea[data-testid="sticky-text-editor"]') as HTMLTextAreaElement;

    // Type 'abc'
    act(() => {
      textarea.value = 'abc';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Simulate click outside (pointerdown on document body)
    const outsideEvent = new MouseEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 500 });
    Object.defineProperty(outsideEvent, 'pointerId', { value: 1 });
    act(() => {
      document.body.dispatchEvent(outsideEvent);
    });

    expect(endedWith).toBe('unselected');
    // Text is preserved
    const ytext = getStickyText(doc, id)!;
    expect(ytext.toString()).toBe('abc');
    // Note still exists
    expect(snapshot(doc)).toHaveLength(1);
  });
});
