import { useCallback, useEffect } from 'react';
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
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObjects, deleteObject, snapshot } from '../shared/board-model';
import { installTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import type { Handle } from '../shared/geometry';

// Register object types (side effect)
import './objects/registerSticky';

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

  // Keyboard commands (select-all, clear, nudge, delete, enter-to-edit)
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable });

  // Transform gesture (group move and resize)
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
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
      const id = createSticky(doc, world);
      if (!id) return;
      selection.startEdit(id);
    },
    [doc, selection, editable],
  );

  /** Toolbar creation: the centre of the visible board area. */
  const createAtViewportCentre = useCallback(() => {
    if (!editable) return;
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width, editable]);

  /** Delete the entire selection (SelectionBar button). */
  const deleteSelection = useCallback(() => {
    if (!editable) return;
    const ids = [...selection.ids];
    deleteObjects(doc, ids);
    selection.clear();
  }, [doc, selection, editable]);

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
    installTestHooks({ getStickyNotes: () => snapshot(doc) });
  }, [doc]);

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
        {notes.map((note) => (
          <StickyNote
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
          />
        ))}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} disabled={!editable} />
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
