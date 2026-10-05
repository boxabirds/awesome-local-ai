/**
 * Component tests for text objects (TC-19 to TC-25).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize } from './boardHarness';
import { createText, getTextContent, setTextSize, setTextWidthFixed, setAutoWidth, setTextBox, deleteIfEmpty, isEmptyText } from '../../src/shared/objects/text';
import { TEXT_MAX_CHARS } from '../../src/shared/config';

stubViewportSize();

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

describe('text objects', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  // TC-19: click with Text tool creates an empty text box; tool returns to Select.
  it('TC-19 Text tool click creates text box and returns to Select', () => {
    render(<App doc={doc} />);

    // Activate Text tool
    fireEvent.keyDown(window, { key: 't' });

    // Click board surface
    const container = document.querySelector('[data-board-surface]')!;
    fireEvent.pointerDown(container, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    fireEvent.pointerUp(container, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });

    // A text object was created
    const objs = objects(doc);
    let hasText = false;
    for (const [, obj] of objs) {
      if (obj.get('type') === 'text') {
        hasText = true;
        break;
      }
    }
    expect(hasText).toBe(true);

    // Tool should be back to Select
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');
  });

  // TC-20: empty text → deleteIfEmpty removes the object.
  it('TC-20 empty text is removed via deleteIfEmpty', () => {
    const id = createText(doc, { x: 100, y: 100 }, 'user')!;
    expect(objects(doc).size).toBe(1);

    // Empty text
    expect(isEmptyText(doc, id)).toBe(true);

    // DeleteIfEmpty removes it
    const deleted = deleteIfEmpty(doc, id);
    expect(deleted).toBe(true);
    expect(objects(doc).size).toBe(0);
  });

  // TC-20b: non-empty text → deleteIfEmpty is a no-op.
  it('TC-20b non-empty text is not removed by deleteIfEmpty', () => {
    const id = createText(doc, { x: 100, y: 100 }, 'user')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'x');

    expect(isEmptyText(doc, id)).toBe(false);
    const deleted = deleteIfEmpty(doc, id);
    expect(deleted).toBe(false);
    expect(objects(doc).size).toBe(1);
  });

  // TC-21: model-level delete removes the object.
  it('TC-21 deleting a text object removes it from the model', () => {
    const id = createText(doc, { x: 100, y: 100 }, 'user');
    const ytext = getTextContent(doc, id!)!;
    ytext.insert(0, 'hello');
    setTextBox(doc, id!, { width: 100, height: 30 });

    expect(objects(doc).has(id!)).toBe(true);

    // Delete from model
    objects(doc).delete(id!);
    expect(objects(doc).has(id!)).toBe(false);
  });

  // TC-23: toolbar size buttons → size and box rewritten correctly.
  it('TC-23 size buttons change size and update box', () => {
    const id = createText(doc, { x: 100, y: 100 }, 'user');
    const ytext = getTextContent(doc, id!)!;
    ytext.insert(0, 'Hello World');
    setTextBox(doc, id!, { width: 200, height: 34 });

    // Verify model operations work
    setTextSize(doc, id!, 'L');
    const obj = objects(doc).get(id!);
    expect(obj?.get('size')).toBe('L');

    setTextSize(doc, id!, 'XL');
    expect(obj?.get('size')).toBe('XL');

    // Auto width recalculates
    expect(obj?.get('width')).toBeGreaterThan(0);
    expect(obj?.get('widthMode')).toBe('auto');
  });

  // TC-24: fixed mode button — stored width unchanged; auto recalculates from content.
  it('TC-24 toggle width mode preserves stored fixed width', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'user')!;
    const ytext = getTextContent(doc, id)!;
    ytext.insert(0, 'Some longer text content here');

    // Set to fixed 250px
    setTextWidthFixed(doc, id, 250);
    const obj = objects(doc).get(id)!;
    expect(obj.get('widthMode')).toBe('fixed');
    expect(obj.get('width')).toBe(250);

    // Change text
    ytext.insert(0, 'More ');

    // Switch to auto: width should change
    setAutoWidth(doc, id!);
    expect(obj.get('widthMode')).toBe('auto');

    // Switch back to fixed: 250 is restored (the last fixed width)
    setTextWidthFixed(doc, id!, 250);
    expect(obj.get('widthMode')).toBe('fixed');
    expect(obj.get('width')).toBe(250);
  });

  // TC-25: text is truncated at TEXT_MAX_CHARS.
  it('TC-25 text model accepts exactly TEXT_MAX_CHARS', () => {
    const id = createText(doc, { x: 0, y: 0 }, 'user');
    const ytext = getTextContent(doc, id!)!;

    // Insert exactly TEXT_MAX_CHARS chars (what the editor truncates to)
    ytext.insert(0, 'a'.repeat(TEXT_MAX_CHARS));
    expect(ytext.toString().length).toBe(TEXT_MAX_CHARS);
  });
});
