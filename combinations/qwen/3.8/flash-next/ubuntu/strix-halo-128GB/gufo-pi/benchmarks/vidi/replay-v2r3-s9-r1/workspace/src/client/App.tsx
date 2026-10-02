import React, { useEffect, useCallback, useState, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTool } from './board/useTool';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { getObjectType } from './objects/registry';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { createSticky, deleteObjects, snapshot, LOCAL_ORIGIN } from '../shared/board-model';
import { createText, setTextSize } from '../shared/objects/text';
import type { TextSize } from '../shared/config';
import { getSharedMeasurer } from './objects/textLayout';
import { remeasureTextBox } from './objects/useTextBoxSync';
import { getClientId } from './identity';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/**
 * BoardUI: the board UI with multi-selection support (stories 1-7).
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
  // Active creation tool (story 9): select or text.
  const { tool: activeTool, setTool } = useTool(editable);

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

  const toolbarCreateRef = useRef<() => void>(() => {});
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
    // N creates a sticky at the view centre (story 9).
    onCreateSticky: () => toolbarCreateRef.current(),
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
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
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
      getSelectedIds: () => [...selectionRef.current.ids],
      getTool: () => activeToolRef.current,
      setTool: (next) => setTool(next),
      getEditingId: () => selectionRef.current.editingId,
    });
  }, [setCamera, doc, undoController, setTool]);

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

  // Enter edits the single selected object, when its type has editable text.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        const [id] = selection.ids;
        const obj = notes.find((o) => o.id === id);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, editable, notes]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  // A new note lands centred on the given screen point and opens for typing.
  const createAtScreenPoint = useCallback(
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
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport]);
  toolbarCreateRef.current = handleToolbarCreate;

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createAtScreenPoint(point);
    },
    [createAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  // A board click with the Text tool places text, then returns to Select.
  const handleToolPointerUp = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, getClientId());
      undoController.boundary();
      setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, setTool, undoController],
  );

  // A size preset change rewraps the text; x/y never move.
  const handleTextSize = useCallback(
    (id: string, size: TextSize) => {
      if (!editable) return;
      undoController.boundary();
      if (setTextSize(doc, id, size)) remeasureTextBox(doc, id, getSharedMeasurer());
      undoController.boundary();
    },
    [doc, editable, undoController],
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
        tool={activeTool}
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
              editable={editable}
              undoController={undoController}
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
        disabled={!editable}
        undo={undoState}
        tool={activeTool}
        onSelectTool={setTool}
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
