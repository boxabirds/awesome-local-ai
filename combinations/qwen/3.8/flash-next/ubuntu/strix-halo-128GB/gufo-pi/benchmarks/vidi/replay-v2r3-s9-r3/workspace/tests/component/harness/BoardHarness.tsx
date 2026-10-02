import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../../src/client/board/undo';
import { useUndo } from '../../../src/client/board/useUndo';
import { useTool, type Tool } from '../../../src/client/board/useTool';
import { createSticky, deleteObjects, snapshot, LOCAL_ORIGIN } from '../../../src/shared/board-model';
import { createText } from '../../../src/shared/objects/text';
import type { ObjectSnapshot } from '../../../src/shared/board-model';
import { TextObject } from '../../../src/client/objects/TextObject';
import { useTextBoxSync } from '../../../src/client/objects/useTextBoxSync';
import { createCanvasMeasurer } from '../../../src/client/objects/textLayout';
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
  tool: Tool;
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
}

/**
 * The story 2-9 wiring (document, selection, viewport, toolbar, notes, text) with the
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);
  const editable = !readOnly;
  const toolState = useTool(editable);

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
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

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

  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    tool: toolState.tool,
    setTool: toolState.setTool,
    onCreateSticky: () => {
      createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
    },
  });

  const live = useRef({ camera, selection, tool: toolState });
  live.current = { camera, selection, tool: toolState };

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
      get tool() { return live.current.tool.tool; },
      set tool(_v: Tool) { /* noop - use setTool */ },
      setTool: (t: Tool) => live.current.tool.setTool(t),
    } as any;
  }

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => createAtScreenPoint(point),
    [createAtScreenPoint],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, 'local');
      undoController.boundary();
      toolState.setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController, toolState],
  );

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

  // Enter edits the selected object (single sticky or text)
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

  // Measurer for text layout
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const editingTextId = selection.editingId;
  const editingBoxSync = useTextBoxSync(doc, editingTextId ?? '', measure);

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
        textToolActive={toolState.tool === 'text'}
        onTextToolClick={handleTextToolClick}
      >
        {notes.map((obj) => {
          if (obj.type === 'sticky') {
            return (
              <StickyNote
                key={obj.id}
                note={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === selection.editingId}
                dragging={gesture.draggingIds.has(obj.id)}
                onSelect={(id) => {
                  if (selection.ids.has(id) && selection.ids.size === 1) return;
                  selection.click(id);
                }}
                onStartEdit={selection.startEdit}
                onEndEdit={(next) => {
                  if (next === 'unselected') selection.clear();
                  else selection.endEdit();
                }}
                onObjectPointerDown={handleObjectPointerDown}
                editable={!readOnly}
                undoController={undoController}
              />
            );
          }
          if (obj.type === 'text') {
            return (
              <TextObject
                key={obj.id}
                note={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === selection.editingId}
                dragging={gesture.draggingIds.has(obj.id)}
                onSelect={(id) => {
                  if (selection.ids.has(id) && selection.ids.size === 1) return;
                  selection.click(id);
                }}
                onStartEdit={selection.startEdit}
                onEndEdit={(next) => {
                  if (next === 'unselected') selection.clear();
                  else selection.endEdit();
                }}
                onObjectPointerDown={handleObjectPointerDown}
                editable={!readOnly}
                undoController={undoController}
                measure={measure}
                onRemeasure={obj.id === selection.editingId ? editingBoxSync.remeasureAfterLocalChange : undefined}
              />
            );
          }
          return null;
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
      />
      <Toolbar
        onCreateSticky={handleToolbarCreate}
        disabled={readOnly}
        undo={undoState}
        tool={toolState.tool}
        onToolChange={toolState.setTool}
      />
    </>
  );
}
