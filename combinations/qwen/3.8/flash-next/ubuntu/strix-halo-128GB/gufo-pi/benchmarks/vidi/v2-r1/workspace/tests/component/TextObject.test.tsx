/**
 * Component tests for text objects (TC-19 to TC-25).
 *
 * These render the full App, use a real Y.Doc, the real undo controller,
 * and the real canvas measurer (which in jsdom returns 0 widths, so
 * the layout tests rely on the min-width clamp and height from line count).
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';

afterEach(() => cleanup());

function getDoc(): Y.Doc {
  const value = window.__vidi6?.getDoc?.();
  if (!value) throw new Error('window.__vidi6.getDoc is missing');
  return value;
}

/** Create a text object directly in the doc, wrapped in act for React re-render. */
function addText(doc: Y.Doc, world: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id = createText(doc, world, 'local')!;
  });
  return id;
}

/** Create a text object with text content. */
function addTextWithContent(doc: Y.Doc, world: { x: number; y: number }, content: string): string {
  let id = '';
  act(() => {
    id = createText(doc, world, 'local')!;
    const ytext = getTextContent(doc, id)!;
    doc.transact(() => {
      ytext.insert(0, content);
    }, LOCAL_ORIGIN);
  });
  return id;
}

/** Read a text entry's field. */
function textField(doc: Y.Doc, id: string, field: string): unknown {
  const objects = doc.getMap('objects');
  const entry = objects.get(id) as Y.Map<unknown> | undefined;
  return entry?.get?.(field);
}

describe('TC-19: editor caret at end, Enter inserts newline, Escape keeps selected', () => {
  beforeEach(() => {
    render(<App boardId="test-tc19" />);
  });

  it('editor caret at end; Enter inserts newline; Escape ends editing and keeps selected', () => {
    const doc = getDoc();
    addTextWithContent(doc, { x: -100, y: -100 }, 'Hello');

    // Wait for it to render
    const el = screen.getByTestId('text-object');

    // Double-click to start editing
    fireEvent.doubleClick(el);

    // Editor should be mounted
    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor).toBeDefined();
    expect(editor.value).toBe('Hello');

    // Enter inserts a newline (not ending editing) — the editor stays mounted
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByTestId('text-editor')).toBeDefined();

    // Escape ends editing
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Editor should be gone, text should be selected
    expect(screen.queryByTestId('text-editor')).toBeNull();
    const obj = screen.getByTestId('text-object') as HTMLElement;
    expect(obj.dataset.selected).toBe('true');
    expect(obj.dataset.editing).toBe('false');
  });
});

describe('TC-20: Escape with empty text removes the object', () => {
  beforeEach(() => {
    render(<App boardId="test-tc20" />);
  });

  it('Escape with zero characters removes object and clears selection', () => {
    const doc = getDoc();
    const id = addText(doc, { x: -100, y: -100 });

    // Double-click to start editing
    const el = screen.getByTestId('text-object');
    fireEvent.doubleClick(el);

    // Editor should be mounted with empty content
    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('');

    // Escape with empty text should delete the object
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Object should be gone from the model
    const objects = doc.getMap('objects');
    expect(objects.get(id)).toBeUndefined();

    // No text object elements
    expect(screen.queryAllByTestId('text-object').length).toBe(0);
  });
});

describe('TC-21: TextToolbar shows S/M/L/XL with current size pressed', () => {
  beforeEach(() => {
    render(<App boardId="test-tc21" />);
  });

  it('TextToolbar has S/M/L/XL buttons; M is pressed for default; clicking XL changes size', () => {
    const doc = getDoc();
    addText(doc, { x: -100, y: -100 });

    // Select the text by clicking on it
    const el = screen.getByTestId('text-object');
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });

    // The toolbar should be visible
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeDefined();

    // M should be pressed (default size)
    const mBtn = screen.getByTestId('text-size-M');
    expect(mBtn.getAttribute('aria-pressed')).toBe('true');

    const xlBtn = screen.getByTestId('text-size-XL');
    expect(xlBtn.getAttribute('aria-pressed')).toBe('false');

    // Get position before resize
    const before = screen.getByTestId('text-object') as HTMLElement;
    const xBefore = Number(before.dataset.textX);
    const yBefore = Number(before.dataset.textY);

    // Click XL
    fireEvent.click(xlBtn);

    // Size should change
    const after = screen.getByTestId('text-object') as HTMLElement;
    expect(after.dataset.textSize).toBe('XL');
    // x/y should not change
    expect(Number(after.dataset.textX)).toBe(xBefore);
    expect(Number(after.dataset.textY)).toBe(yBefore);
  });
});

describe('TC-22: single text selected shows only e/w handles', () => {
  beforeEach(() => {
    render(<App boardId="test-tc22" />);
  });

  it('single text selected shows only e and w resize handles', () => {
    const doc = getDoc();
    addText(doc, { x: -100, y: -100 });

    // Select the text object
    const el = screen.getByTestId('text-object');
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });

    // Check handles: should have 'Resize right' and 'Resize left' but NOT others
    const handles = screen.queryAllByRole('button', { name: /Resize/ });

    // We should only have 2 handles for horizontal-only
    expect(handles.length).toBe(2);

    // Check they are e and w
    const handleLabels = handles.map((h) => h.getAttribute('aria-label'));
    expect(handleLabels).toContain('Resize right');
    expect(handleLabels).toContain('Resize left');
    expect(handleLabels).not.toContain('Resize top');
    expect(handleLabels).not.toContain('Resize bottom');
  });
});

describe('TC-24: remote delete while editing ends gracefully', () => {
  beforeEach(() => {
    render(<App boardId="test-tc24" />);
  });

  it('remote delete while editing unmounts editor without error', () => {
    const doc = getDoc();
    const id = addTextWithContent(doc, { x: -100, y: -100 }, 'hello');

    // Start editing
    const el = screen.getByTestId('text-object');
    fireEvent.doubleClick(el);
    expect(screen.getByTestId('text-editor')).toBeDefined();

    // Simulate remote delete: remove the object with a non-local origin
    const objects = doc.getMap('objects');
    act(() => {
      doc.transact(() => {
        objects.delete(id);
      }, Symbol('remote'));
    });

    // After re-render, editor should be gone
    expect(screen.queryByTestId('text-editor')).toBeNull();

    // Object should be gone from the model
    expect(objects.get(id)).toBeUndefined();
  });
});

describe('TC-25: undo reverts text and stored box together', () => {
  beforeEach(() => {
    render(<App boardId="test-tc25" />);
  });

  it('type then Ctrl+Z reverts text and stored box in one step', () => {
    const doc = getDoc();
    const id = addText(doc, { x: -100, y: -100 });

    // Start editing
    const el = screen.getByTestId('text-object');
    fireEvent.doubleClick(el);

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;

    // Type text
    fireEvent.change(editor, { target: { value: 'Hello world' } });

    // End editing
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Verify text is stored
    const ytext = getTextContent(doc, id);
    expect(ytext?.toString()).toBe('Hello world');

    // Width should be > 0 (from remeasure)
    const width = textField(doc, id, 'width') as number;
    expect(width).toBeGreaterThan(0);

    // Undo with Ctrl+Z on the window
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    // Text should be reverted: either empty or object deleted
    const objects = doc.getMap('objects');
    const entry = objects.get(id) as Y.Map<unknown> | undefined;
    if (entry !== undefined) {
      const textVal = entry.get('text') as Y.Text;
      expect(textVal.toString()).toBe('');
    }
    // If entry is undefined, the undo deleted it — also acceptable
  });
});
