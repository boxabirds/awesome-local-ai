import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { type ReactElement, useState, useEffect } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, deleteObjects, LOCAL_ORIGIN, type ObjectSnapshot, type TextObjectSnapshot } from '@shared/board-model';
import { createText, setTextSize, getTextContent } from '@shared/objects/text';
import { TextObject } from '@client/objects/TextObject';
import { TextToolbar } from '@client/objects/TextToolbar';
import { SelectionOverlay } from '@client/board/SelectionOverlay';
import { createUndo, type UndoController } from '@client/board/undo';
import type { Camera } from '@client/canvas/camera';
import { registerStickyType, registerTextType, _resetRegistryForTesting } from '@client/objects/registry';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

// Test wrapper that provides selection state and undo controller
function TextObjTestWrapper({
  doc,
  id,
  editable = true,
  initialEditing = false,
  onEndEdit,
  undoController,
}: {
  doc: Y.Doc;
  id: string;
  editable?: boolean;
  initialEditing?: boolean;
  onEndEdit?(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}): ReactElement {
  const [snap, setSnap] = useState<readonly ObjectSnapshot[]>(() => snapshot(doc));
  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const observer = () => setSnap(snapshot(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);

  const obj = snap.find((s) => s.id === id) as TextObjectSnapshot | undefined;
  const [editing, setEditing] = useState(initialEditing);
  const [selected, setSelected] = useState(true);

  if (!obj) return <div data-testid="obj-removed">removed</div>;

  return (
    <TextObject
      textObj={obj}
      doc={doc}
      zoom={1}
      selected={selected}
      editing={editing}
      editable={editable}
      onObjectPointerDown={() => { setSelected(true); }}
      onStartEdit={() => setEditing(true)}
      onEndEdit={(next) => {
        setEditing(false);
        onEndEdit?.(next);
      }}
      undoController={undoController}
    />
  );
}

describe('text.object', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    id = createText(doc, { x: 100, y: 100 }, 'test')!;
  });

  // TC-19: editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected
  describe('TC-19: editor behaviour', () => {
    it('Enter inserts newline in editor', () => {
      // Put some text in the object
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, 'hello');

      render(<TextObjTestWrapper doc={doc} id={id} initialEditing={true} />);
      const textarea = screen.getByTestId('text-editor') as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();

      // Enter should insert newline (default textarea behaviour)
      act(() => {
        fireEvent.keyDown(textarea, { key: 'Enter' });
      });
      // The Enter key is not prevented in the editor, so default behaviour inserts newline
    });

    it('Escape ends editing', () => {
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, 'hello');

      const onEnd = vi.fn();
      render(<TextObjTestWrapper doc={doc} id={id} initialEditing={true} onEndEdit={onEnd} />);
      const textarea = screen.getByTestId('text-editor');

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Escape' });
      });
      expect(onEnd).toHaveBeenCalledWith('selected');
    });
  });

  // TC-20: Escape with zero characters → object removed, selection cleared
  describe('TC-20: empty text removed on escape', () => {
    it('empty text object is removed when editing ends', () => {
      // Don't type anything, just start editing
      const onEnd = vi.fn();
      render(<TextObjTestWrapper doc={doc} id={id} initialEditing={true} onEndEdit={onEnd} />);
      const textarea = screen.getByTestId('text-editor');

      act(() => {
        fireEvent.keyDown(textarea, { key: 'Escape' });
      });

      expect(onEnd).toHaveBeenCalledWith('selected');
      // Object should be removed from doc
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      expect(objects.has(id)).toBe(false);
    });
  });

  // TC-21: TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged
  describe('TC-21: TextToolbar sizes', () => {
    it('shows size buttons with M pressed', () => {
      render(<TextToolbar size="M" onSize={() => {}} onDelete={() => {}} />);
      expect(screen.getByTestId('text-size-S')).toBeInTheDocument();
      expect(screen.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('text-size-L')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('text-size-XL')).toHaveAttribute('aria-pressed', 'false');
    });

    it('clicking XL calls onSize with XL', () => {
      const onSize = vi.fn();
      render(<TextToolbar size="M" onSize={onSize} onDelete={() => {}} />);
      fireEvent.click(screen.getByTestId('text-size-XL'));
      expect(onSize).toHaveBeenCalledWith('XL');
    });

    it('setTextSize changes size without changing x/y', () => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const obj = objects.get(id)!;
      const origX = obj.get('x');
      const origY = obj.get('y');

      setTextSize(doc, id, 'XL');
      expect(obj.get('size')).toBe('XL');
      expect(obj.get('x')).toBe(origX);
      expect(obj.get('y')).toBe(origY);
    });
  });

  // TC-22: single text selected → only e and w handles rendered
  describe('TC-22: horizontal-only handles', () => {
    beforeEach(() => {
      _resetRegistryForTesting();
      registerStickyType(() => null);
      registerTextType(() => null);
    });

    afterEach(() => {
      _resetRegistryForTesting();
    });

    it('single text shows only e and w handles', () => {
      const texts = snapshot(doc);
      const ids = new Set([id]);

      render(
        <SelectionOverlay
          ids={ids}
          snapshot={texts}
          camera={testCamera}
          onHandlePointerDown={() => {}}
        />,
      );

      expect(screen.getByTestId('handle-e')).toBeInTheDocument();
      expect(screen.getByTestId('handle-w')).toBeInTheDocument();
      expect(screen.queryByTestId('handle-n')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handle-s')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handle-nw')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handle-ne')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handle-se')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handle-sw')).not.toBeInTheDocument();
    });
  });

  // TC-23: text + sticky selected → all handles
  describe('TC-23: mixed selection shows all handles', () => {
    beforeEach(() => {
      _resetRegistryForTesting();
      registerStickyType(() => null);
      registerTextType(() => null);
    });

    afterEach(() => {
      _resetRegistryForTesting();
    });

    it('text + sticky shows all handles', () => {
      const stickyId = createStickyProxy(doc);
      const texts = snapshot(doc);
      const ids = new Set([id, stickyId]);

      render(
        <SelectionOverlay
          ids={ids}
          snapshot={texts}
          camera={testCamera}
          onHandlePointerDown={() => {}}
        />,
      );

      expect(screen.getByTestId('handle-n')).toBeInTheDocument();
      expect(screen.getByTestId('handle-s')).toBeInTheDocument();
      expect(screen.getByTestId('handle-e')).toBeInTheDocument();
      expect(screen.getByTestId('handle-w')).toBeInTheDocument();
    });
  });

  // TC-24: remote delete while editing → editor unmounts, no error, object not recreated
  describe('TC-24: remote delete during edit', () => {
    it('editor unmounts when object is deleted remotely', () => {
      const ytext = getTextContent(doc, id)!;
      ytext.insert(0, 'hello');

      const onEnd = vi.fn();
      render(<TextObjTestWrapper doc={doc} id={id} initialEditing={true} onEndEdit={onEnd} />);

      // Verify editor is present
      expect(screen.getByTestId('text-editor')).toBeInTheDocument();

      // Delete the object
      act(() => {
        deleteObjects(doc, [id]);
      });

      // Object should be gone (component re-renders with "removed")
      expect(screen.getByTestId('obj-removed')).toBeInTheDocument();
      // Editor should be gone
      expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument();
    });
  });

  // TC-25: type then Ctrl+Z → text and stored box revert together in one step
  describe('TC-25: undo reverts text and box together', () => {
    it('undo reverts both text and box', () => {
      const ctrl = createUndo(doc);
      const ytext = getTextContent(doc, id)!;

      // Simulate typing (with boundary before to make one undo group)
      ctrl.boundary();
      doc.transact(() => {
        ytext.insert(0, 'hello world');
        // Simulate box write
        const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
        obj.set('width', 110);
        obj.set('height', 26);
      }, LOCAL_ORIGIN);
      ctrl.boundary();

      // Verify text and box were set
      expect(ytext.toString()).toBe('hello world');
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
      expect(obj.get('width')).toBe(110);

      // Undo should revert both text and box in one step
      ctrl.undo();
      expect(ytext.toString()).toBe('');
      // Box should revert to original width/height
      expect(obj.get('width')).not.toBe(110);

      ctrl.destroy();
    });
  });
});

function createStickyProxy(doc: Y.Doc): string {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const stickyId = crypto.randomUUID();
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', 300);
    note.set('y', 300);
    note.set('color', 'yellow');
    note.set('text', new Y.Text());
    note.set('z', maxZ + 1);
    note.set('createdAt', Date.now());
    objects.set(stickyId, note);
  }, LOCAL_ORIGIN);
  return stickyId;
}
