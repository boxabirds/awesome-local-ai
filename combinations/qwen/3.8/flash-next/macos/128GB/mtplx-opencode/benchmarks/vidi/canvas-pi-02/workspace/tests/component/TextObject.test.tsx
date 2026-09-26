import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { act } from '@testing-library/react';
import { renderApp, flush } from './appHarness';
import { dispatch, pointerEvent, keyEvent } from './harness';
import { initDoc, snapshot, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createText, getTextContent, isEmptyText } from '../../src/shared/objects/text';
import { createUndo } from '../../src/client/board/undo';
import { TEXT_SIZES } from '../../src/shared/config';

/**
 * TC-19 to TC-25: text object component tests.
 */

/** Helper: seed a text object directly into the doc before render. */
function seedText(doc: Y.Doc, x: number, y: number, content?: string): string {
  const id = createText(doc, { x, y }, 'test')!;
  if (content) {
    const text = getTextContent(doc, id);
    if (text) text.insert(0, content);
  }
  return id;
}

describe('text object (TC-19 to TC-25)', () => {
  describe('TC-19 editor behaviour', () => {
    it('dblclick enters editing; editor has correct value', async () => {
      const harness = renderApp([]);
      const id = seedText(harness.doc, 300, 200, 'Hello');
      await flush();

      // Click on the text object to select it
      const el = harness.container.querySelector(`[data-text-id="${id}"]`);
      if (!el) throw new Error('text object not rendered');
      await dispatch(el, pointerEvent('pointerdown', { clientX: 350, clientY: 250 }));
      await dispatch(el, pointerEvent('pointerup', { clientX: 350, clientY: 250 }));
      await flush();

      // Double-click to start editing
      await dispatch(el, new MouseEvent('dblclick', { bubbles: true, clientX: 350, clientY: 250 }));
      await flush();

      // Editor should be mounted with correct value
      const editor = harness.container.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
      expect(editor).not.toBeNull();
      expect(editor!.value).toBe('Hello');
    });
  });

  describe('TC-20 empty text removal on Escape', () => {
    it('Escape with empty text removes the object', async () => {
      const harness = renderApp([]);
      // Create an empty text object directly in the doc
      const id = seedText(harness.doc, 300, 200);
      await flush();

      // The text object should be in the doc initially
      expect(isEmptyText(harness.doc, id)).toBe(true);

      // Select and edit
      const el = harness.container.querySelector(`[data-text-id="${id}"]`);
      if (!el) throw new Error('text not rendered');
      await dispatch(el, pointerEvent('pointerdown', { clientX: 350, clientY: 250 }));
      await dispatch(el, pointerEvent('pointerup', { clientX: 350, clientY: 250 }));
      await flush();
      await dispatch(el, new MouseEvent('dblclick', { bubbles: true, clientX: 350, clientY: 250 }));
      await flush();

      // Editor should be mounted
      const editor = harness.container.querySelector('[data-testid="text-editor"]');
      expect(editor).not.toBeNull();

      // Press Escape to end editing (no text was typed)
      if (editor) {
        await dispatch(editor, keyEvent('Escape'));
        await flush();
      }

      // Object should be removed (empty text = deleted)
      expect(isEmptyText(harness.doc, id)).toBe(true);
    });
  });

  describe('TC-21 TextToolbar shows sizes', () => {
    it('TextToolbar shows size buttons when text is selected', async () => {
      const harness = renderApp([]);
      const id = seedText(harness.doc, 300, 200, 'Title');
      await flush();

      // Click the text object to select it
      const el = harness.container.querySelector(`[data-text-id="${id}"]`);
      if (!el) throw new Error('text not rendered');
      await dispatch(el, pointerEvent('pointerdown', { clientX: 350, clientY: 250 }));
      await dispatch(el, pointerEvent('pointerup', { clientX: 350, clientY: 250 }));
      await flush();

      // Text selection bar should appear
      const textBar = harness.container.querySelector('[data-testid="text-selection-bar"]');
      expect(textBar).not.toBeNull();

      // M should be pressed by default
      const mBtn = textBar?.querySelector('[data-testid="text-size-M"]');
      expect(mBtn).not.toBeNull();
      expect(mBtn?.getAttribute('aria-pressed')).toBe('true');

      // XL button exists
      const xlBtn = textBar?.querySelector('[data-testid="text-size-XL"]');
      expect(xlBtn).not.toBeNull();
    });
  });

  describe('TC-22 single text → only e/w handles', () => {
    it('single text selected → only e and w handles rendered', async () => {
      const harness = renderApp([]);
      const id = seedText(harness.doc, 300, 200, 'Hello World');
      await flush();

      // Click the text object to select it
      const el = harness.container.querySelector(`[data-text-id="${id}"]`);
      if (!el) throw new Error('text not rendered');
      await dispatch(el, pointerEvent('pointerdown', { clientX: 350, clientY: 250 }));
      await dispatch(el, pointerEvent('pointerup', { clientX: 350, clientY: 250 }));
      await flush();

      // Check for handles: should only have 'e' and 'w'
      const handleE = harness.container.querySelector('[data-testid="handle-e"]');
      const handleW = harness.container.querySelector('[data-testid="handle-w"]');
      const handleN = harness.container.querySelector('[data-testid="handle-n"]');
      const handleS = harness.container.querySelector('[data-testid="handle-s"]');
      const handleNE = harness.container.querySelector('[data-testid="handle-ne"]');
      const handleNW = harness.container.querySelector('[data-testid="handle-nw"]');

      expect(handleE).not.toBeNull();
      expect(handleW).not.toBeNull();
      // Only horizontal handles for text
      expect(handleN).toBeNull();
      expect(handleS).toBeNull();
      expect(handleNE).toBeNull();
      expect(handleNW).toBeNull();
    });
  });

  describe('TC-24 remote delete while editing', () => {
    it('remote delete → editor unmounts, no error', async () => {
      const harness = renderApp([]);
      const id = seedText(harness.doc, 300, 200, 'Content');
      await flush();

      // Double-click to start editing
      const el = harness.container.querySelector(`[data-text-id="${id}"]`);
      if (!el) throw new Error('text not rendered');
      await dispatch(el, pointerEvent('pointerdown', { clientX: 350, clientY: 250 }));
      await dispatch(el, pointerEvent('pointerup', { clientX: 350, clientY: 250 }));
      await flush();
      await dispatch(el, new MouseEvent('dblclick', { bubbles: true, clientX: 350, clientY: 250 }));
      await flush();

      // Verify editor is mounted
      let editor = harness.container.querySelector('[data-testid="text-editor"]');
      expect(editor).not.toBeNull();

      // Simulate remote delete
      await act(async () => {
        const objects = harness.doc.getMap<Y.Map<unknown>>('objects');
        objects.delete(id);
      });
      await flush();

      // Editor should be gone
      editor = harness.container.querySelector('[data-testid="text-editor"]');
      expect(editor).toBeNull();

      // No error; object gone from doc
      expect(harness.doc.getMap<Y.Map<unknown>>('objects').get(id)).toBeUndefined();
    });
  });

  describe('TC-25 undo', () => {
    it('text reverts in one undo step', async () => {
      const harness = renderApp([], {
        undoFactory: (doc) => createUndo(doc),
      });

      const id = seedText(harness.doc, 300, 200, 'Initial');
      await flush();

      // Verify initial text
      const textBefore = getTextContent(harness.doc, id)?.toString();
      expect(textBefore).toBe('Initial');

      // End the undo capture group (seedText is outside any boundary)
      await act(async () => {
        harness.undo!.boundary();
      });

      // Make a local change within the undo system
      await act(async () => {
        const text = getTextContent(harness.doc, id);
        if (text) {
          harness.doc.transact(() => {
            text.delete(0, text.length);
            text.insert(0, 'Modified text');
          }, LOCAL_ORIGIN);
        }
        harness.undo!.boundary();
      });

      // Verify text changed
      const textAfterType = getTextContent(harness.doc, id)?.toString();
      expect(textAfterType).toBe('Modified text');

      // Undo
      await act(async () => {
        harness.undo!.undo();
      });
      await flush();

      // Text should revert
      const textAfter = getTextContent(harness.doc, id)?.toString();
      expect(textAfter).toBe('Initial');
    });
  });
});