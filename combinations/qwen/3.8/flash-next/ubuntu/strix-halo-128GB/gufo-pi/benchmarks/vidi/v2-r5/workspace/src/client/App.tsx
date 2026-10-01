import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useUndo } from './board/useUndo';
import { useTool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObjects, deleteObject, snapshot } from '../shared/board-model';
import { createText, setTextSize, setTextWidthFixed, setTextBox, getTextContent } from '../shared/objects/text';
import { layoutText, createCanvasMeasurer } from './objects/textLayout';
import { TEXT_FONT_FAMILY } from '../shared/config';
import { TextObject } from './objects/TextObject';
import { installTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import type { Handle } from '../shared/geometry';

// Register object types (side effect)
import './objects/registerSticky';
import './objects/registerText';

/** Extract the boardId from /b/:boardId. */
function readBoardIdFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/b\/([^/]+)/);
  return match?.[1];
}

/**
 * Top-level layout: a full-window board, the tool toolbar on the left, the zoom control in the
 * bottom-right corner and the first-use navigation hint near the bottom centre.
 *
 * Story 7: multi-select, group move, resize, nudge and delete.
 * Story 8: undo/redo with per-user history.
 */
export interface AppProps {
  doc?: Y.Doc;
  boardId?: string;
}

export function App({ doc: providedDoc, boardId: boardIdProp }: AppProps = {}) {
  const viewport = useViewportSize();
  const { camera, hasNavigated, ...handlers } = useCamera(viewport);
  const boardId = boardIdProp ?? readBoardIdFromPath();
  const { doc, notes, connectionState } = useBoardDoc(providedDoc, boardId);
  const selection = useSelection(notes);
  const editable = connectionState === undefined || canEdit(connectionState);
  const { tool, setTool } = useTool(editable);

  // Undo controller: one per board doc, destroyed on board change/unmount (session-only)
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoCtrl = undoRef.current;
  const boundary = useCallback(() => undoCtrl.boundary(), [undoCtrl]);

  useEffect(() => {
    return () => {
      undoCtrl.destroy();
    };
  }, [undoCtrl]);

  const undoState = useUndo(undoCtrl, editable);

  // Keyboard commands (select-all, clear, nudge, delete, enter-to-edit, undo/redo, tool shortcuts)
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController: undoCtrl,
    boundary,
    tool,
    setTool,
    onCreateSticky: () => { createAtViewportCentre(); },
  });

  // Transform gesture (group move and resize) with undo boundaries
  const gestureMeasurer = useRef(createCanvasMeasurer(TEXT_FONT_FAMILY));
  const handleResizeComplete = useCallback((rects: ReadonlyMap<string, { x: number; y: number; width: number; height: number }>) => {
    for (const [id, rect] of rects) {
      // Find if it's a text object by checking the snapshot
      const obj = notes.find((n) => n.id === id);
      if (obj?.type === 'text') {
        // Set width mode to fixed with the new width from the resize
        const newWidth = rect.width;
        setTextWidthFixed(doc, id, newWidth);
        // Remeasure height using the new width
        const textContent = getTextContent(doc, id);
        const txt = textContent?.toString() ?? '';
        if (txt.length > 0) {
          const box = layoutText(txt, obj.size ?? 'M', 'fixed', newWidth, gestureMeasurer.current);
          setTextBox(doc, id, box);
        }
      }
    }
  }, [doc, notes]);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: boundary,
    onGestureEnd: boundary,
    onResizeComplete: handleResizeComplete,
  });

  // Marquee (Shift+drag)
  const marquee = useMarquee({
    camera,
    snapshot: notes,
    onSelect: useCallback(
      (ids: string[]) => selection.setMany(ids, true),
      [selection],
    ),
  });

  /** Create a note whose centre is the given world point, and start typing straight away. */
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) return;
      boundary();
      const id = createSticky(doc, world);
      boundary();
      if (!id) return;
      selection.startEdit(id);
    },
    [doc, selection, editable, boundary],
  );

  /** Text tool click: create text at world point, switch back to select, start editing. */
  const handleTextToolClick = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) return;
      boundary();
      const id = createText(doc, world, 'local');
      boundary();
      if (!id) return;
      setTool('select');
      selection.startEdit(id);
    },
    [doc, selection, editable, boundary, setTool],
  );

  /** Toolbar creation: the centre of the visible board area. */
  const createAtViewportCentre = useCallback(() => {
    if (!editable) return;
    boundary();
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width, editable, boundary]);

  /** Delete the entire selection (SelectionBar button). */
  const deleteSelection = useCallback(() => {
    if (!editable) return;
    const ids = [...selection.ids];
    boundary();
    deleteObjects(doc, ids);
    boundary();
    selection.clear();
  }, [doc, selection, editable, boundary]);

  /** Delete a single note (NoteToolbar button). */
  const removeOne = useCallback(
    (id: string) => {
      if (!editable) return;
      deleteObject(doc, id);
      selection.clear();
    },
    [doc, selection, editable],
  );

  // Test build only: let the suites read the model.
  useEffect(() => {
    installTestHooks({ getStickyNotes: () => snapshot(doc), getAllObjects: () => notes });
  }, [doc, notes]);

  // Expose connection state for e2e tests.
  useEffect(() => {
    if (connectionState !== undefined) {
      installTestHooks({ connectionState });
    }
  }, [connectionState]);

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  return (
    <div className="app-root">
      {connectionState !== undefined && <ConnectionStatus state={connectionState} />}
      <BoardViewport
        camera={camera}
        handlers={handlers}
        onCreateSticky={createAt}
        onClearSelection={selection.clear}
        onMarqueeStart={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        textToolActive={tool === 'text'}
        onTextToolClick={handleTextToolClick}
        overlay={
          <SelectionOverlay
            ids={selection.ids}
            snapshot={notes}
            camera={camera}
            onHandlePointerDown={handleHandlePointerDown}
          />
        }
        bar={
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={deleteSelection}
          />
        }
      >
        {notes.map((note) => {
          if (note.type === 'text') {
            return (
              <TextObject
                key={note.id}
                note={note}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(note.id)}
                editing={note.id === selection.editingId}
                onSelect={selection.click}
                onToggle={selection.toggle}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
                onDelete={removeOne}
                onObjectPointerDown={gesture.onObjectPointerDown}
                undoController={undoCtrl}
                boundary={boundary}
                canEdit={editable}
                onSizeChange={(id, size) => {
                  setTextSize(doc, id, size);
                  // Trigger re-measure via remeasureAfterLocalChange in the component
                }}
              />
            );
          }
          return (
            <StickyNote
              key={note.id}
              note={note as any}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={note.id === selection.editingId}
              onSelect={selection.click}
              onToggle={selection.toggle}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              onDelete={removeOne}
              onObjectPointerDown={gesture.onObjectPointerDown}
              undoController={undoCtrl}
              boundary={boundary}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} disabled={!editable} undo={undoState} tool={tool} onToolChange={setTool} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => handlers.zoomStep('in')}
        onZoomOut={() => handlers.zoomStep('out')}
        onReset={handlers.reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
