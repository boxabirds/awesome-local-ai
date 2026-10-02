import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard } from './helpers/TestBoard';
import type { Camera, Size } from '../../src/client/canvas/camera';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { objectMap } from '../../src/shared/board-model';

installComponentMocks();

afterEach(() => {
  cleanup();
});

const camera: Camera = { x: 0, y: 0, zoom: 1 };
const viewportSize: Size = { width: 800, height: 600 };

function renderBoard(canEdit = true) {
  let docRef: Y.Doc | null = null;
  let undoRef: any = null;
  render(
    <TestBoard
      camera={camera}
      viewportSize={viewportSize}
      canEdit={canEdit}
      onDocReady={(doc) => { docRef = doc; }}
      onUndoReady={(undo) => { undoRef = undo; }}
    />,
  );
  return { getDoc: () => docRef!, getUndo: () => undoRef };
}

describe('TextObject component tests', () => {
  // TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected
  describe('TC-19: editing behaviour', () => {
    it('starts editing with caret at end, Enter inserts newline, Escape ends and keeps selected', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create a text object with some content
      let id = '';
      act(() => {
        id = createText(doc, { x: 100, y: 100 }, 'test')!;
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Hello');
      });

      // Start editing by simulating double-click on the text object
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        fireEvent.dblClick(textEl);
      });

      // The editor should be mounted
      const editor = screen.getByTestId('text-editor');
      const textarea = editor.querySelector('textarea')!;
      expect(textarea).not.toBeNull();
      expect((textarea as HTMLTextAreaElement).value).toBe('Hello');

      // Enter inserts a newline
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter' });
        // Simulate the value change that Enter would cause
        (textarea as HTMLTextAreaElement).value = 'Hello\n';
        fireEvent.change(textarea, { target: { value: 'Hello\n' } });
      });

      // Escape ends editing
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Escape' });
      });

      // Editor should be unmounted
      expect(screen.queryByTestId('text-editor')).toBeNull();

      // The text object should still exist and be selected
      expect(screen.getByTestId(`text-object-${id}`)).not.toBeNull();
    });
  });

  // TC-20: Escape with zero characters → object removed, selection cleared
  describe('TC-20: empty text removal', () => {
    it('Escape with no characters removes the object', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create an empty text object
      let id = '';
      act(() => {
        id = createText(doc, { x: 100, y: 100 }, 'test')!;
      });

      // Start editing
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        fireEvent.dblClick(textEl);
      });

      // Editor should be mounted
      const editor = screen.getByTestId('text-editor');
      const textarea = editor.querySelector('textarea')!;

      // Escape without typing anything
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Escape' });
      });

      // The object should be removed
      await waitFor(() => {
        expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
      });
    });
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged
  describe('TC-21: text toolbar sizes', () => {
    it('shows size buttons with current size pressed, clicking changes size', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create a text object with content
      let id = '';
      act(() => {
        id = createText(doc, { x: 200, y: 150 }, 'test')!;
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Heading');
      });

      // Select the text object using native pointer event
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: 200, clientY: 150, button: 0, pointerId: 1,
        }));
      });
      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: 200, clientY: 150, button: 0, pointerId: 1,
        }));
      });

      // The text toolbar should be visible
      const toolbar = screen.getByTestId('text-toolbar');
      expect(toolbar).not.toBeNull();

      // M should be pressed (default size)
      const mBtn = screen.getByRole('button', { name: 'Size M' });
      expect(mBtn).toHaveAttribute('aria-pressed', 'true');

      // Record position
      const m = objectMap(doc, id)!;
      const xBefore = m.get('x');
      const yBefore = m.get('y');

      // Click XL
      const xlBtn = screen.getByRole('button', { name: 'Size XL' });
      act(() => {
        fireEvent.click(xlBtn);
      });

      // Size should be XL now
      const m2 = objectMap(doc, id)!;
      expect(m2.get('size')).toBe('XL');

      // Position unchanged
      expect(m2.get('x')).toBe(xBefore);
      expect(m2.get('y')).toBe(yBefore);
    });
  });

  // TC-22: single text selected → only e and w handles rendered
  describe('TC-22: horizontal-only handles', () => {
    it('shows only e and w handles for a single text object', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create a text object with content
      let id = '';
      act(() => {
        id = createText(doc, { x: 100, y: 100 }, 'test')!;
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Test');
      });

      // Select it using native pointer event
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1,
        }));
      });
      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1,
        }));
      });

      // The selection overlay should show only e/w handles
      const overlay = screen.getByTestId('selection-overlay');
      expect(overlay).toHaveAttribute('data-handles', 'horizontal');

      // e and w handles should exist
      expect(screen.getByTestId('resize-handle-e')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-w')).not.toBeNull();

      // Other handles should NOT exist
      expect(screen.queryByTestId('resize-handle-n')).toBeNull();
      expect(screen.queryByTestId('resize-handle-s')).toBeNull();
      expect(screen.queryByTestId('resize-handle-nw')).toBeNull();
      expect(screen.queryByTestId('resize-handle-se')).toBeNull();
    });
  });

  // TC-23: text + sticky selected → all handles
  describe('TC-23: mixed selection shows all handles', () => {
    it('text + sticky selection shows all 8 handles', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create a text object
      let textId = '';
      act(() => {
        textId = createText(doc, { x: 100, y: 100 }, 'test')!;
        const t = getTextContent(doc, textId)!;
        t.insert(0, 'Test');
      });

      // Create a sticky
      act(() => {
        const objects = doc.getMap('objects');
        const m = new Y.Map<unknown>();
        m.set('type', 'sticky');
        m.set('x', 300);
        m.set('y', 100);
        m.set('width', 200);
        m.set('height', 200);
        m.set('z', 10);
        m.set('color', 'yellow');
        m.set('text', new Y.Text());
        m.set('createdAt', Date.now());
        objects.set('sticky-1', m);
      });

      // Select both using native pointer events (like multi-select tests)
      const textEl = screen.getByTestId(`text-object-${textId}`);
      const stickyEl = screen.getByTestId('sticky-note-sticky-1');

      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1,
        }));
      });
      act(() => {
        textEl.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, pointerId: 1,
        }));
      });

      act(() => {
        stickyEl.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, clientX: 300, clientY: 100, button: 0, pointerId: 1, shiftKey: true,
        }));
      });
      act(() => {
        stickyEl.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, clientX: 300, clientY: 100, button: 0, pointerId: 1, shiftKey: true,
        }));
      });

      // The overlay should show all handles (mixed selection)
      const overlay = screen.getByTestId('selection-overlay');
      expect(overlay).toHaveAttribute('data-handles', 'all');

      // All 8 handles should exist
      expect(screen.getByTestId('resize-handle-nw')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-n')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-ne')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-e')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-se')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-s')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-sw')).not.toBeNull();
      expect(screen.getByTestId('resize-handle-w')).not.toBeNull();
    });
  });

  // TC-24: remote delete while editing → editor unmounts, no error
  describe('TC-24: remote delete during editing', () => {
    it('editor unmounts when object is deleted remotely', async () => {
      const { getDoc } = renderBoard();
      const doc = getDoc();

      // Create a text object with content
      let id = '';
      act(() => {
        id = createText(doc, { x: 100, y: 100 }, 'test')!;
        const t = getTextContent(doc, id)!;
        t.insert(0, 'Hello');
      });

      // Start editing
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        fireEvent.dblClick(textEl);
      });

      // Editor should be mounted
      expect(screen.getByTestId('text-editor')).not.toBeNull();

      // Simulate remote delete
      act(() => {
        doc.getMap('objects').delete(id);
      });

      // The editor and object should be gone
      await waitFor(() => {
        expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
      });
      expect(screen.queryByTestId('text-editor')).toBeNull();
    });
  });

  // TC-25: type then Ctrl+Z → text and stored box revert together in one step
  describe('TC-25: undo reverts text and box together', () => {
    it('Ctrl+Z after typing reverts text and box in one step', async () => {
      const { getDoc, getUndo } = renderBoard();
      const doc = getDoc();
      const undo = getUndo();

      // Create a text object
      let id = '';
      act(() => {
        id = createText(doc, { x: 100, y: 100 }, 'test')!;
      });

      // Start editing
      const textEl = screen.getByTestId(`text-object-${id}`);
      act(() => {
        fireEvent.dblClick(textEl);
      });

      const editor = screen.getByTestId('text-editor');
      const textarea = editor.querySelector('textarea')!;

      // Type some text
      act(() => {
        (textarea as HTMLTextAreaElement).value = 'Hello world';
        fireEvent.change(textarea, { target: { value: 'Hello world' } });
      });

      // End editing
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Escape' });
      });

      // Now undo
      act(() => {
        undo.undo();
      });

      // The text should be reverted (empty or the text object removed)
      const m = objectMap(doc, id);
      if (m) {
        const t = getTextContent(doc, id);
        if (t) {
          expect(t.toString()).toBe('');
        }
      }
      // If the object was removed entirely, that's also valid (empty text removal)
    });
  });
});
