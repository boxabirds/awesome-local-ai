import { describe, expect, it } from 'vitest';
import { fireEvent, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { renderBoard } from './boardHarness';

describe('TextObject', () => {
  it('TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, id)!;
    ytext.doc?.transact(() => { ytext.insert(0, 'hello'); }, LOCAL_ORIGIN);

    renderBoard(<App doc={doc} />);

    // Double-click the text object to start editing
    const textEl = screen.getByTestId('text-object');
    fireEvent.doubleClick(textEl);

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    // Caret should be at end
    expect(editor.selectionStart).toBe(5);
    expect(editor.selectionEnd).toBe(5);

    // Enter inserts a newline (textarea handles it natively)
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.input(editor, { target: { value: 'hello\n' } });

    // Escape ends editing, keeps text selected
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Editor should be gone
    expect(screen.queryByTestId('text-editor')).toBeNull();

    // The object should still exist and be selected
    const textEl2 = screen.queryByTestId('text-object');
    expect(textEl2).toBeTruthy();
    expect(textEl2!.getAttribute('data-selected')).toBe('true');
  });

  it('TC-20: Escape with zero characters → object removed, selection cleared', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;

    renderBoard(<App doc={doc} />);

    // Double-click to start editing
    const textEl = screen.getByTestId('text-object');
    fireEvent.doubleClick(textEl);

    const editor = screen.getByTestId('text-editor');
    expect(editor).toBeTruthy();

    // Escape without typing
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Object should be removed from doc
    const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objectsMap.has(id)).toBe(false);

    // No text-object element should remain
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  it('TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 100, y: 200 }, 'u1')!;
    const ytext = getTextContent(doc, id)!;
    ytext.doc?.transact(() => { ytext.insert(0, 'test'); }, LOCAL_ORIGIN);

    renderBoard(<App doc={doc} />);

    // Select the text object (click on it)
    const textEl = screen.getByTestId('text-object');
    fireEvent.pointerDown(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 200, clientY: 300 });

    // Text toolbar should be visible
    const toolbar = screen.queryByTestId('text-toolbar');
    expect(toolbar).toBeTruthy();

    // Check M is pressed
    const sizeM = screen.getByTestId('text-size-M');
    expect(sizeM.getAttribute('aria-pressed')).toBe('true');
    const sizeXL = screen.getByTestId('text-size-XL');
    expect(sizeXL.getAttribute('aria-pressed')).toBe('false');

    // Click XL
    fireEvent.click(sizeXL);

    // Verify size changed in doc
    const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const map = objectsMap.get(id)!;
    expect(map.get('size')).toBe('XL');
    expect(map.get('x')).toBe(100);
    expect(map.get('y')).toBe(200);
  });

  it('TC-22: single text selected → only e and w handles rendered', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, id)!;
    ytext.doc?.transact(() => { ytext.insert(0, 'hi'); }, LOCAL_ORIGIN);

    renderBoard(<App doc={doc} />);

    // Select the text object
    const textEl = screen.getByTestId('text-object');
    fireEvent.pointerDown(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 200, clientY: 300 });

    // Check handles: e and w should be present, n/s/ne/nw/se/sw should NOT
    expect(screen.queryByTestId('handle-e')).toBeTruthy();
    expect(screen.queryByTestId('handle-w')).toBeTruthy();
    expect(screen.queryByTestId('handle-n')).toBeNull();
    expect(screen.queryByTestId('handle-s')).toBeNull();
    expect(screen.queryByTestId('handle-ne')).toBeNull();
    expect(screen.queryByTestId('handle-nw')).toBeNull();
    expect(screen.queryByTestId('handle-se')).toBeNull();
    expect(screen.queryByTestId('handle-sw')).toBeNull();
  });

  it('TC-23: text + sticky selected → all 8 handles', () => {
    const doc = new Y.Doc();
    const textId = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, textId)!;
    ytext.doc?.transact(() => { ytext.insert(0, 'hi'); }, LOCAL_ORIGIN);
    createSticky(doc, { x: 200, y: 200 });

    renderBoard(<App doc={doc} />);

    // Select text first
    const textEl = screen.getByTestId('text-object');
    fireEvent.pointerDown(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(textEl, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 200, clientY: 300 });

    // Shift-click the sticky to add to selection
    const noteEl = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(noteEl, { pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 500, clientY: 500, shiftKey: true });
    fireEvent.pointerUp(noteEl, { pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: 500, clientY: 500, shiftKey: true });

    // All handles should be present (mixed selection)
    expect(screen.queryByTestId('handle-n')).toBeTruthy();
    expect(screen.queryByTestId('handle-s')).toBeTruthy();
    expect(screen.queryByTestId('handle-e')).toBeTruthy();
    expect(screen.queryByTestId('handle-w')).toBeTruthy();
    expect(screen.queryByTestId('handle-ne')).toBeTruthy();
    expect(screen.queryByTestId('handle-nw')).toBeTruthy();
    expect(screen.queryByTestId('handle-se')).toBeTruthy();
    expect(screen.queryByTestId('handle-sw')).toBeTruthy();
  });

  it('TC-24: remote delete while editing → editor unmounts, no error', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;
    const ytext = getTextContent(doc, id)!;
    ytext.doc?.transact(() => { ytext.insert(0, 'editing'); }, LOCAL_ORIGIN);

    renderBoard(<App doc={doc} />);

    // Start editing
    const textEl = screen.getByTestId('text-object');
    fireEvent.doubleClick(textEl);
    expect(screen.getByTestId('text-editor')).toBeTruthy();

    // Simulate remote delete
    const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    act(() => {
      doc.transact(() => { objectsMap.delete(id); }, 'remote');
    });

    // Editor should unmount (text-object gone)
    expect(screen.queryByTestId('text-editor')).toBeNull();
    expect(screen.queryByTestId('text-object')).toBeNull();
  });

  it('TC-25: type then Ctrl+Z → text reverts', () => {
    const doc = new Y.Doc();
    const id = createText(doc, { x: 0, y: 0 }, 'u1')!;

    renderBoard(<App doc={doc} />);

    // Start editing
    const textEl = screen.getByTestId('text-object');
    fireEvent.doubleClick(textEl);

    const editor = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();

    // Type some text
    fireEvent.input(editor, { target: { value: 'hello' } });

    // End editing
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Ctrl+Z to undo
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    // After undo, the text should be empty or the object may be removed (deleteIfEmpty not called on undo)
    const ytext2 = getTextContent(doc, id);
    if (ytext2) {
      expect(ytext2.toString()).toBe('');
    }
  });
});
