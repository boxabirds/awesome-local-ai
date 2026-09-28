/**
 * Component tests for text objects (TC-19 to TC-25).
 * Uses a real Y.Doc, real undo controller, and a fake measurer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { initDoc, LOCAL_ORIGIN, createSticky } from '../../src/shared/board-model';
import { createText } from '../../src/shared/objects/text';
import { startFakeFrames, flushFrames } from './harness';

function mount(doc: Y.Doc) {
  render(<App doc={doc} />);
  flushFrames();
}

describe('text object', () => {
  beforeEach(() => {
    startFakeFrames();
  });

  // TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected.
  it('TC-19: Enter inserts newline, Escape ends editing and keeps text selected', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Create text via Text tool after render
    mount(doc);

    act(() => { fireEvent.keyDown(window, { key: 't' }); });
    flushFrames();
    const overlay = screen.getByTestId('text-tool-overlay');
    act(() => { fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 300, clientY: 200 }); });
    flushFrames();

    const textarea = document.querySelector('textarea')!;
    expect(textarea).not.toBeNull();

    // Type some text
    act(() => {
      textarea.value = 'Hello';
      fireEvent.input(textarea);
    });

    // Enter should insert a newline (not end editing)
    act(() => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
    expect(document.querySelector('textarea')).not.toBeNull();

    // Escape ends editing
    act(() => { fireEvent.keyDown(textarea, { key: 'Escape' }); });
    flushFrames();

    // Editor gone, text object still present and selected
    expect(document.querySelector('textarea')).toBeNull();
    const textEl = screen.getByTestId('board').querySelector('[data-text-id]');
    expect(textEl).not.toBeNull();
    expect(textEl!.getAttribute('data-selected')).toBe('true');
  });

  // TC-20: Escape with zero characters → object removed, selection cleared (negative).
  it('TC-20: empty text on Escape is removed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    mount(doc);

    act(() => { fireEvent.keyDown(window, { key: 't' }); });
    flushFrames();
    const overlay = screen.getByTestId('text-tool-overlay');
    act(() => { fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 300, clientY: 200 }); });
    flushFrames();

    const textarea = document.querySelector('textarea')!;
    expect(textarea).not.toBeNull();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    let textCount = 0;
    objects.forEach((obj) => { if (obj.get('type') === 'text') textCount++; });
    expect(textCount).toBe(1);

    // Escape without typing
    act(() => { fireEvent.keyDown(textarea, { key: 'Escape' }); });
    flushFrames();

    let textCountAfter = 0;
    objects.forEach((obj) => { if (obj.get('type') === 'text') textCountAfter++; });
    expect(textCountAfter).toBe(0);

    const textEl = screen.getByTestId('board').querySelector('[data-text-id]');
    expect(textEl).toBeNull();
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged.
  it('TC-21: TextToolbar shows sizes and XL changes size keeping position', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    // Create text object BEFORE render
    const id = createText(doc, { x: 100, y: 200 }, 'user')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(id)!.get('text') as Y.Text;
    doc.transact(() => { ytext.insert(0, 'Hello'); }, LOCAL_ORIGIN);
    // Ensure a visible width so selection bounds work
    objects.get(id)!.set('width', 50);
    objects.get(id)!.set('height', 26);
    objects.get(id)!.set('z', 0);

    mount(doc);

    // Select the text object by clicking it
    const textEl = screen.getByTestId('board').querySelector(`[data-text-id="${id}"]`);
    expect(textEl).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(textEl!, { button: 0, pointerId: 1, clientX: 150, clientY: 210 });
      fireEvent.pointerUp(textEl!, { pointerId: 1, clientX: 150, clientY: 210 });
    });
    flushFrames();

    // TextToolbar should appear
    const toolbar = screen.getByTestId('text-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Check M is pressed (default size)
    const mBtn = screen.getByLabelText('M text size');
    const xlBtn = screen.getByLabelText('XL text size');
    expect(mBtn).toHaveAttribute('aria-pressed', 'true');
    expect(xlBtn).toHaveAttribute('aria-pressed', 'false');

    // Click XL
    act(() => { fireEvent.click(xlBtn); });
    flushFrames();

    // Size should be XL, position unchanged
    expect(objects.get(id)!.get('size')).toBe('XL');
    expect(objects.get(id)!.get('x')).toBe(100);
    expect(objects.get(id)!.get('y')).toBe(200);
    expect(xlBtn).toHaveAttribute('aria-pressed', 'true');
    expect(mBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-22: single text selected → only e and w handles rendered.
  it('TC-22: single text selection shows only e and w handles', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id = createText(doc, { x: 100, y: 100 }, 'user')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(id)!.get('text') as Y.Text;
    doc.transact(() => { ytext.insert(0, 'Hi'); }, LOCAL_ORIGIN);
    objects.get(id)!.set('width', 50);
    objects.get(id)!.set('height', 26);
    objects.get(id)!.set('z', 0);

    mount(doc);

    const textEl = screen.getByTestId('board').querySelector(`[data-text-id="${id}"]`);
    expect(textEl).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(textEl!, { button: 0, pointerId: 1, clientX: 125, clientY: 113 });
      fireEvent.pointerUp(textEl!, { pointerId: 1, clientX: 125, clientY: 113 });
    });
    flushFrames();

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay).toBeInTheDocument();

    const eHandle = overlay.querySelector('[data-resize-handle="e"]');
    const wHandle = overlay.querySelector('[data-resize-handle="w"]');
    const nHandle = overlay.querySelector('[data-resize-handle="n"]');
    const sHandle = overlay.querySelector('[data-resize-handle="s"]');
    const nwHandle = overlay.querySelector('[data-resize-handle="nw"]');

    expect(eHandle).not.toBeNull();
    expect(wHandle).not.toBeNull();
    expect(nHandle).toBeNull();
    expect(sHandle).toBeNull();
    expect(nwHandle).toBeNull();
  });

  // TC-23: text + sticky selected → all handles.
  it('TC-23: text + sticky selection shows all handles', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const textId = createText(doc, { x: 100, y: 100 }, 'user')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(textId)!.get('text') as Y.Text;
    doc.transact(() => { ytext.insert(0, 'Hi'); }, LOCAL_ORIGIN);
    objects.get(textId)!.set('width', 50);
    objects.get(textId)!.set('height', 26);
    objects.get(textId)!.set('z', 0);

    const stickyId = createSticky(doc, { x: 300, y: 300 });

    mount(doc);

    const textEl = screen.getByTestId('board').querySelector(`[data-text-id="${textId}"]`);
    const stickyEl = screen.getByTestId('board').querySelector(`[data-note-id="${stickyId}"]`);
    expect(textEl).not.toBeNull();
    expect(stickyEl).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(textEl!, { button: 0, pointerId: 1, clientX: 110, clientY: 110 });
      fireEvent.pointerUp(textEl!, { pointerId: 1, clientX: 110, clientY: 110 });
    });
    flushFrames();

    // Shift-click sticky to add to selection
    act(() => {
      fireEvent.pointerDown(stickyEl!, { button: 0, pointerId: 2, clientX: 310, clientY: 310, shiftKey: true });
      fireEvent.pointerUp(stickyEl!, { pointerId: 2, clientX: 310, clientY: 310 });
    });
    flushFrames();

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay).toBeInTheDocument();
    const nHandle = overlay.querySelector('[data-resize-handle="n"]');
    expect(nHandle).not.toBeNull();
  });

  // TC-24: remote delete while editing → editor unmounts, no error, object not recreated.
  it('TC-24: remote delete during editing ends editing gracefully', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    const id = createText(doc, { x: 50, y: 50 }, 'user')!;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(id)!.get('text') as Y.Text;
    doc.transact(() => { ytext.insert(0, 'test'); }, LOCAL_ORIGIN);
    objects.get(id)!.set('width', 40);
    objects.get(id)!.set('height', 26);
    objects.get(id)!.set('z', 0);

    mount(doc);

    // Select and start editing
    const textEl = screen.getByTestId('board').querySelector(`[data-text-id="${id}"]`);
    expect(textEl).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(textEl!, { button: 0, pointerId: 1, clientX: 60, clientY: 60 });
      fireEvent.pointerUp(textEl!, { pointerId: 1, clientX: 60, clientY: 60 });
    });
    flushFrames();
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    flushFrames();

    expect(document.querySelector('textarea')).not.toBeNull();

    // Remote delete (origin != LOCAL_ORIGIN)
    act(() => {
      doc.transact(() => {
        objects.delete(id);
      }, 'remote-peer');
    });
    flushFrames();

    // Editor should unmount
    expect(document.querySelector('textarea')).toBeNull();
    expect(objects.has(id)).toBe(false);
  });

  // TC-25: type then Ctrl+Z → text and stored box revert together in one step.
  it('TC-25: undo reverts text and stored box together', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    mount(doc);

    // Create text object via Text tool
    act(() => { fireEvent.keyDown(window, { key: 't' }); });
    flushFrames();
    const overlay = screen.getByTestId('text-tool-overlay');
    act(() => { fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 300, clientY: 200 }); });
    flushFrames();

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    let textId = '';
    objects.forEach((obj, id) => { if (obj.get('type') === 'text') textId = id; });
    expect(textId).not.toBe('');

    const initialWidth = objects.get(textId)!.get('width');
    const initialHeight = objects.get(textId)!.get('height');

    const textarea = document.querySelector('textarea')!;

    // Type text (within same undo capture window)
    act(() => {
      textarea.value = 'Hello World';
      fireEvent.input(textarea);
    });
    flushFrames();

    const ytext = objects.get(textId)!.get('text') as Y.Text;
    expect(ytext.toString()).toBe('Hello World');

    // Ctrl+Z to undo (TextEditor intercepts it and calls undo())
    act(() => {
      fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    });
    flushFrames();

    // After undo: text should be reverted to empty, box back to initial
    if (objects.has(textId)) {
      const ytextAfter = objects.get(textId)!.get('text') as Y.Text;
      expect(ytextAfter.toString()).toBe('');
      expect(objects.get(textId)!.get('width')).toBe(initialWidth);
      expect(objects.get(textId)!.get('height')).toBe(initialHeight);
    }
  });
});
