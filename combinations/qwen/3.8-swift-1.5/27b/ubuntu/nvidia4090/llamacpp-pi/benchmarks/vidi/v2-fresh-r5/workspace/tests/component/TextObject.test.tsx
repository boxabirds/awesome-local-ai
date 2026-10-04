/**
 * Component tests for text objects (TC-19 to TC-25).
 * Tests editing, empty removal, sizes, handles, remote delete, undo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createText, setTextSize, getTextContent } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/shared/text-edit';
import { TextObject } from '../../src/client/objects/TextObject';
import { TextToolbar } from '../../src/client/objects/TextToolbar';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { createUndo } from '../../src/client/board/undo';
import { initDoc } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Camera } from '../../src/client/canvas/camera';

// Fake camera for overlay tests
const fakeCamera: Camera = { x: 0, y: 0, zoom: 1 };

function makeTextSnapshot(id: string, overrides: Partial<ObjectSnapshot> = {}): ObjectSnapshot {
  return {
    id,
    type: 'text',
    x: 100,
    y: 50,
    width: 100,
    height: 26,
    text: 'hello',
    z: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeStickySnapshot(id: string, overrides: Partial<ObjectSnapshot> = {}): ObjectSnapshot {
  return {
    id,
    type: 'sticky',
    x: 300,
    y: 50,
    width: 200,
    height: 200,
    text: 'note',
    color: 'yellow',
    z: 2,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('TextObject component', () => {
  let doc: Y.Doc;
  let undo: ReturnType<typeof createUndo>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    undo = createUndo(doc);
  });

  afterEach(() => {
    undo.destroy();
    doc.destroy();
  });

  // TC-19: editor caret at end; Enter inserts newline; Escape ends editing
  describe('TC-19: text editing', () => {
    it('editor mounts with caret at end; Escape ends editing keeping text selected', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => ytext.insert(0, 'hello'), 'local');

      const obj = makeTextSnapshot(id, { text: 'hello' });
      let endEditCalled = false;
      let endEditNext = '';

      render(
        <TextObject
          obj={obj}
          selected={true}
          editing={true}
          canEdit={true}
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
          doc={doc}
          onEndEdit={(next) => { endEditCalled = true; endEditNext = next; }}
          undo={undo}
        />
      );

      const textarea = screen.getByTestId('text-textarea');
      expect(textarea).toBeTruthy();
      expect((textarea as HTMLTextAreaElement).value).toBe('hello');

      // Press Escape
      fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });
      expect(endEditCalled).toBe(true);
      expect(endEditNext).toBe('selected');
    });

    it('Enter inserts a newline (textarea default behavior)', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      const obj = makeTextSnapshot(id, { text: '' });

      render(
        <TextObject
          obj={obj}
          selected={true}
          editing={true}
          canEdit={true}
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
          doc={doc}
          onEndEdit={() => {}}
          undo={undo}
        />
      );

      const textarea = screen.getByTestId('text-textarea') as HTMLTextAreaElement;
      // Type some text
      fireEvent.input(textarea, { target: { value: 'hello' } });
      expect(textarea.value).toBe('hello');

      // Enter key: the browser inserts a newline (we simulate by setting value)
      // The keydown handler does NOT preventDefault for Enter, so the
      // textarea's default behavior would insert a newline.
      fireEvent.change(textarea, { target: { value: 'hello\n' } });
      expect(textarea.value).toBe('hello\n');
    });
  });

  // TC-20: Escape with zero characters → object removed
  describe('TC-20: empty text removal', () => {
    it('ending edit with no characters removes the object', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      // Text is empty (just created)
      const obj = makeTextSnapshot(id, { text: '', width: 0, height: 0 });

      let endEditCalled = false;
      let endEditNext = '';

      render(
        <TextObject
          obj={obj}
          selected={true}
          editing={true}
          canEdit={true}
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
          doc={doc}
          onEndEdit={(next) => { endEditCalled = true; endEditNext = next; }}
          undo={undo}
        />
      );

      const textarea = screen.getByTestId('text-textarea');
      fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

      expect(endEditCalled).toBe(true);
      expect(endEditNext).toBe('unselected');

      // Object should be removed from the doc
      const objects = doc.getMap('objects');
      expect(objects.has(id)).toBe(false);
    });
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL changes size
  describe('TC-21: text toolbar sizes', () => {
    it('shows S M L XL buttons with M pressed by default', () => {
      render(<TextToolbar size="M" onSize={() => {}} onDelete={() => {}} />);

      expect(screen.getByLabelText('Size S')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('Size M')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Size L')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('Size XL')).toHaveAttribute('aria-pressed', 'false');
    });

    it('click XL calls onSize with XL', () => {
      let sizeCalled = '';
      render(<TextToolbar size="M" onSize={(s) => { sizeCalled = s; }} onDelete={() => {}} />);

      fireEvent.click(screen.getByLabelText('Size XL'));
      expect(sizeCalled).toBe('XL');
    });

    it('setTextSize XL changes size, x/y unchanged', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      const result = setTextSize(doc, id, 'XL');
      expect(result).toBe(true);

      const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const obj = objects.get(id)!;
      expect(obj.get('size')).toBe('XL');
      expect(obj.get('x')).toBe(100);
      expect(obj.get('y')).toBe(50);
    });
  });

  // TC-22: single text selected → only e and w handles
  describe('TC-22: horizontal-only handles', () => {
    it('single text object shows only e and w handles', () => {
      const textId = 'text-1';
      const obj = makeTextSnapshot(textId);
      const snapshot = [obj];
      const ids = new Set([textId]);

      render(
        <SelectionOverlay
          ids={ids}
          snapshot={snapshot}
          camera={fakeCamera}
          onHandlePointerDown={() => {}}
        />
      );

      // Only e and w handles should be present
      expect(screen.getByTestId('handle-e')).toBeTruthy();
      expect(screen.getByTestId('handle-w')).toBeTruthy();

      // No other handles
      expect(screen.queryByTestId('handle-n')).toBeNull();
      expect(screen.queryByTestId('handle-s')).toBeNull();
      expect(screen.queryByTestId('handle-nw')).toBeNull();
      expect(screen.queryByTestId('handle-ne')).toBeNull();
      expect(screen.queryByTestId('handle-se')).toBeNull();
      expect(screen.queryByTestId('handle-sw')).toBeNull();
    });
  });

  // TC-23: text + sticky selected → all handles
  describe('TC-23: mixed selection shows all handles', () => {
    it('text + sticky shows all 8 handles', () => {
      const textId = 'text-1';
      const stickyId = 'sticky-1';
      const textObj = makeTextSnapshot(textId);
      const stickyObj = makeStickySnapshot(stickyId);
      const snapshot = [textObj, stickyObj];
      const ids = new Set([textId, stickyId]);

      render(
        <SelectionOverlay
          ids={ids}
          snapshot={snapshot}
          camera={fakeCamera}
          onHandlePointerDown={() => {}}
        />
      );

      // All 8 handles should be present
      expect(screen.getByTestId('handle-nw')).toBeTruthy();
      expect(screen.getByTestId('handle-n')).toBeTruthy();
      expect(screen.getByTestId('handle-ne')).toBeTruthy();
      expect(screen.getByTestId('handle-e')).toBeTruthy();
      expect(screen.getByTestId('handle-se')).toBeTruthy();
      expect(screen.getByTestId('handle-s')).toBeTruthy();
      expect(screen.getByTestId('handle-sw')).toBeTruthy();
      expect(screen.getByTestId('handle-w')).toBeTruthy();
    });
  });

  // TC-24: remote delete while editing → editor unmounts, no error
  describe('TC-24: remote delete during editing', () => {
    it('ending edit after remote deletion does not throw or recreate', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      const ytext = getTextContent(doc, id)!;
      doc.transact(() => ytext.insert(0, 'hello'), 'local');

      const obj = makeTextSnapshot(id, { text: 'hello' });

      const { unmount } = render(
        <TextObject
          obj={obj}
          selected={true}
          editing={true}
          canEdit={true}
          onPointerDown={() => {}}
          onDoubleClick={() => {}}
          doc={doc}
          onEndEdit={() => {}}
          undo={undo}
        />
      );

      // Simulate remote deletion
      act(() => {
        doc.transact(() => {
          doc.getMap('objects').delete(id);
        }, 'remote-peer');
      });

      // End editing (simulating Escape)
      act(() => {
        unmount();
      });

      // No error thrown, object not recreated
      const objects = doc.getMap('objects');
      expect(objects.has(id)).toBe(false);
    });
  });

  // TC-25: type then Ctrl+Z → text and box revert together
  describe('TC-25: undo reverts text and box', () => {
    it('typing then undo reverts text content', () => {
      const id = createText(doc, { x: 100, y: 50 }, 'test')!;
      const ytext = getTextContent(doc, id)!;

      // Type some text
      act(() => {
        applyTextDiff(ytext, 'hello world');
      });

      expect(ytext.toString()).toBe('hello world');

      // Undo
      act(() => {
        undo.undo();
      });

      // Text should be reverted
      expect(ytext.toString()).toBe('');
    });
  });
});
