import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { useTool } from './board/useTool';
import { createSticky, deleteObjects, snapshotAll, LOCAL_ORIGIN } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { TextObject } from './objects/TextObject';
import { useTextBoxSync } from './objects/useTextBoxSync';
import { createCanvasMeasurer } from './objects/textLayout';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/**
 * BoardUI: the board UI with multi-selection support (stories 1-9).
 */
export function BoardUI({ boardId }: { boardId: string }) {
  const [viewport, setViewport] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);
  const tool = useTool(editable);

  // One undo controller per board doc, destroyed on board change/unmount (session-only history)
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoController = undoRef.current;
  useEffect(() => {
    return () => {
      undoController.destroy();
    };
  }, [undoController]);
  const undoState = useUndo(undoController, editable);

  const marquee = useMarquee(camera, notes, (ids) => selection.setMany(ids, true));

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    tool: tool.tool,
    setTool: tool.setTool,
    onCreateSticky: () => {
      const w = { x: viewport.width / 2, y: viewport.height / 2 };
      createStickyAtScreenPoint(w);
    },
  });

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Register test hooks (no-op outside the test build mode)
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshotAll(doc),
      addSticky: (at, text, color) => {
        undoController.boundary();
        const id = createSticky(doc, at, (color as any) ?? undefined);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          doc.transact(() => t.insert(0, text), LOCAL_ORIGIN);
        }
        undoController.boundary();
        return id;
      },
      addText: (at, text) => {
        undoController.boundary();
        const id = createText(doc, at, 'test');
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          doc.transact(() => t.insert(0, text), LOCAL_ORIGIN);
        }
        undoController.boundary();
        return id!;
      },
      getSelectedIds: () => [...selectionRef.current.ids],
    });
  }, [setCamera, doc, undoController]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = (window as any).__vidi6 || {};
      (window as any).__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  // Zoom keyboard shortcuts (Ctrl/Cmd + / - / 0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomStep('in');
        } else if (e.key === '-') {
          e.preventDefault();
          zoomStep('out');
        } else if (e.key === '0') {
          e.preventDefault();
          reset();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  // Enter edits the selected object (single sticky or text)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const [id] = selection.ids;
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, editable]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  // A new note lands centred on the given screen point and opens for typing.
  const createStickyAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController],
  );

  const handleToolbarCreate = useCallback(() => {
    createStickyAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createStickyAtScreenPoint, viewport]);

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createStickyAtScreenPoint(point);
    },
    [createStickyAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Text tool: click creates text at the world point
  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, 'local');
      undoController.boundary();
      tool.setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController, tool],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, selection, editable, undoController]);

  const handleMarqueeBegin = useCallback((p: { x: number; y: number }) => {
    marquee.begin(p);
  }, [marquee]);

  const handleMarqueeMove = useCallback((p: { x: number; y: number }) => {
    marquee.move(p);
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
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

  // Measurer for text layout
  const measure = useMemo(() => createCanvasMeasurer(), []);

  // Track the editing text id for box sync
  const editingTextId = selection.editingId;
  const editingBoxSync = useTextBoxSync(doc, editingTextId ?? '', measure);

  // Handle text object pointer events that hit the viewport (for text tool)
  // Note: TextObject handles its own pointerdown with stopPropagation.

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        textToolActive={tool.tool === 'text'}
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
                editable={editable}
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
                editable={editable}
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
        disabled={!editable}
        undo={undoState}
        tool={tool.tool}
        onToolChange={tool.setTool}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Backward-compatible export for tests that import App */
export { BoardUI as App };
