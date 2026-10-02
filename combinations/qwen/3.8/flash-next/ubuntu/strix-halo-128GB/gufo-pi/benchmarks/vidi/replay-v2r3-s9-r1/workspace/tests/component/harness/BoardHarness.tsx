import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTool, type Tool } from '../../../src/client/board/useTool';
import { getObjectType } from '../../../src/client/objects/registry';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../../src/client/board/undo';
import { useUndo } from '../../../src/client/board/useUndo';
import { createSticky, deleteObjects } from '../../../src/shared/board-model';
import { createText, setTextSize } from '../../../src/shared/objects/text';
import { remeasureTextBox } from '../../../src/client/objects/useTextBoxSync';
import { getSharedMeasurer, type Measurer } from '../../../src/client/objects/textLayout';
import type { TextSize } from '../../../src/shared/config';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  getSelectedIds(): ReadonlySet<string>;
  /** Backward-compat: returns the single selected id or null. */
  getSelectedId(): string | null;
  getEditingId(): string | null;
  selection: ReturnType<typeof useSelection>;
  undoController: UndoController;
  /** Current tool (story 9). */
  getTool(): Tool;
  setTool(tool: Tool): void;
}

/** True when the key press belongs to a text field rather than to the board. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface BoardHarnessProps {
  handleRef: React.MutableRefObject<HarnessHandle | null>;
  viewport?: Size;
  /** When true, editing (create / drag / colour / delete / text) is disabled. */
  readOnly?: boolean;
  /** Text measurer for the box sync and the width handle (fake in tests). */
  measure?: Measurer;
}

/**
 * The story 2-7 wiring (document, selection, viewport, toolbar, notes) with the
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false, measure }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);
  const editable = !readOnly;
  const { tool, setTool } = useTool(editable);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;

  const marquee = useMarquee(camera, notes, (ids) => selection.setMany(ids, true));

  // Undo controller
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undoController = undoRef.current;
  useEffect(() => () => { undoController.destroy(); }, [undoController]);
  const undoState = useUndo(undoController, editable);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    measure,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  const createStickyRef = useRef<() => void>(() => {});
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    onCreateSticky: () => createStickyRef.current(),
  });

  const live = useRef({ camera, selection });
  live.current = { camera, selection };
  const notesRef = useRef(notes);
  notesRef.current = notes;

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedIds: () => live.current.selection.ids,
      getSelectedId: () => {
        const ids = live.current.selection.ids;
        return ids.size === 1 ? [...ids][0] : null;
      },
      getEditingId: () => live.current.selection.editingId,
      selection: live.current.selection,
      undoController,
      getTool: () => toolRef.current,
      setTool: (t: Tool) => setToolRef.current(t),
    };
  }

  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      undoController.boundary();
      const id = createSticky(doc, screenToWorld(camera, point));
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, readOnly, undoController],
  );

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => createAtScreenPoint(point),
    [createAtScreenPoint],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);
  createStickyRef.current = handleToolbarCreate;

  // Text tool: a board click creates text at that point, then reverts to Select.
  const handleToolPointerUp = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, 'harness');
      undoController.boundary();
      setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, readOnly, setTool, undoController],
  );

  const handleTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (readOnly) return;
      undoController.boundary();
      if (setTextSize(doc, id, size)) {
        remeasureTextBox(doc, id, measure ?? getSharedMeasurer());
      }
      undoController.boundary();
    },
    [doc, readOnly, undoController, measure],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, selection, editable, undoController]);

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: any) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  // Enter edits the single selected object, when its type has editable text.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        const [id] = selection.ids;
        const obj = notesRef.current.find((o) => o.id === id);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, readOnly]);

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={(p) => marquee.begin(p)}
        onMarqueeMove={(p) => marquee.move(p)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
        tool={tool}
        onToolPointerUp={handleToolPointerUp}
      >
        {notes.map((obj) => {
          const Component = getObjectType(obj.type)?.Component;
          if (!Component) return null;
          return (
            <Component
              key={obj.id}
              note={obj}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={obj.id === selection.editingId}
              dragging={gesture.draggingIds.has(obj.id)}
              onSelect={(id: string) => {
                if (selection.ids.has(id) && selection.ids.size === 1) return;
                selection.click(id);
              }}
              onStartEdit={selection.startEdit}
              onEndEdit={(next: 'selected' | 'unselected') => {
                if (next === 'unselected') selection.clear();
                else selection.endEdit();
              }}
              onObjectPointerDown={handleObjectPointerDown}
              editable={!readOnly}
              undoController={undoController}
              measure={measure}
            />
          );
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={handleHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        onDelete={handleDeleteSelection}
        camera={camera}
        onTextSize={handleTextSize}
      />
      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={readOnly}
        undo={undoState}
        tool={tool}
        onSelectTool={setTool}
      />
    </>
  );
}
