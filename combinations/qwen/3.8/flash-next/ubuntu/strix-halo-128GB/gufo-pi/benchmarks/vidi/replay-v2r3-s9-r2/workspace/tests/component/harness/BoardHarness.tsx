import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTool, type Tool } from '../../../src/client/board/useTool';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { TextObject, getSharedMeasurer } from '../../../src/client/objects/TextObject';
import type { Measurer } from '../../../src/client/objects/textLayout';
import { writeTextBox } from '../../../src/client/objects/useTextBoxSync';
import { createText, setTextWidthFixed } from '../../../src/shared/objects/text';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../../src/client/board/undo';
import { useUndo } from '../../../src/client/board/useUndo';
import { createSticky, deleteObjects, moveObjects } from '../../../src/shared/board-model';
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
  /** Active creation tool (story 9). */
  getTool(): Tool;
  setTool(t: Tool): void;
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
  /** Text measurer of the text objects; tests pass a deterministic fake. */
  measure?: Measurer;
}

/**
 * The story 2-7 wiring (document, selection, viewport, toolbar, notes) with the
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({
  handleRef,
  viewport = { width: 1280, height: 800 },
  readOnly = false,
  measure,
}: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, objects } = useBoardDoc(null);
  const selection = useSelection(objects);
  const editable = !readOnly;
  const tool = useTool(editable);
  const measurer = measure ?? getSharedMeasurer();

  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // Undo controller
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undoController = undoRef.current;
  useEffect(() => () => { undoController.destroy(); }, [undoController]);
  const undoState = useUndo(undoController, editable);

  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
    onHorizontalResize: (id, width, x) => {
      const obj = objectsRef.current.find((o) => o.id === id);
      if (!obj) return;
      setTextWidthFixed(doc, id, width);
      moveObjects(doc, new Map([[id, { x, y: obj.y }]]));
      writeTextBox(doc, id, measurer);
    },
    remeasure: (ids) => {
      for (const id of ids) writeTextBox(doc, id, measurer);
    },
  });

  const live = useRef({ camera, selection, tool });
  live.current = { camera, selection, tool };

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
      getTool: () => live.current.tool.tool,
      setTool: (t: Tool) => live.current.tool.setTool(t),
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

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undoController,
    tool,
    onCreateSticky: handleToolbarCreate,
  });

  // Story 9: click with the Text tool places text and hands the tool back.
  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      undoController.boundary();
      const id = createText(doc, point, 'harness');
      if (id) writeTextBox(doc, id, measurer);
      undoController.boundary();
      if (!id) return;
      tool.setTool('select');
      selection.startEdit(id);
    },
    [doc, measurer, readOnly, selection, tool, undoController],
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

  // Enter edits the selected note (single sticky only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const [id] = selection.ids;
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
        textToolActive={tool.tool === 'text'}
        onTextToolClick={handleTextToolClick}
      >
        {objects.map((obj) => {
          const shared = {
            doc,
            zoom: camera.zoom,
            selected: selection.ids.has(obj.id),
            editing: obj.id === selection.editingId,
            dragging: gesture.draggingIds.has(obj.id),
            onSelect: (id: string) => {
              if (selection.ids.has(id) && selection.ids.size === 1) return;
              selection.click(id);
            },
            onStartEdit: selection.startEdit,
            onEndEdit: (next: 'selected' | 'unselected') => {
              if (next === 'unselected') selection.clear();
              else selection.endEdit();
            },
            onObjectPointerDown: handleObjectPointerDown,
            editable: !readOnly,
            undoController,
          };
          return obj.type === 'text' ? (
            <TextObject key={obj.id} note={obj} measure={measurer} {...shared} />
          ) : (
            <StickyNote key={obj.id} note={obj} {...shared} />
          );
        })}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={handleHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        onDelete={handleDeleteSelection}
      />
      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={readOnly}
        undo={undoState}
        tool={tool.tool}
        onSelectTool={tool.setTool}
      />
    </>
  );
}
