import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { BoardViewport, type BoardViewportApi } from './canvas/BoardViewport';
import type { Camera, Point } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type EndEditTarget } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionAnnouncement, SelectionBar } from './board/SelectionBar';
import { UndoContext, useUndo, useUndoController } from './board/useUndo';
import { getObjectType } from './objects/registry';
import './objects/index';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { installApplyUpdate, installBoardHook, reportConnectionState } from './canvas/testHooks';

export interface AppProps {
  doc?: Y.Doc;
  boardId?: string;
}

/** The camera before the viewport has reported one, which is the default view. */
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * The board: document, connection, selection, toolbars, shortcuts, viewport.
 *
 * Story 10 adds the Shape and Connector tools. Both are state in `useActiveTool`,
 * which also owns the single-key shortcuts, and both render a screen-space layer of
 * their own over the viewport: while a drawing tool is up it owns the pointer, so the
 * board does not pan and objects under the cursor are not dragged.
 */
export default function App({ doc, boardId }: AppProps = {}) {
  const { doc: boardDoc, notes, connection } = useBoardDoc(doc, boardId);
  const locked = !canEdit(connection);

  // --- Local UI state -------------------------------------------------------
  const selection = useSelection(notes);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const viewportApi = useRef<BoardViewportApi | null>(null);

  // --- Tool mode (story 9, story 10) -----------------------------------------
  const active = useActiveTool({
    canEdit: !locked,
    selection,
    onCreateSticky: () => createStickyAtCentre(),
  });

  // --- Undo ---------------------------------------------------------------
  const undoHistory = useUndoController(boardDoc);
  const undoApi = useUndo(undoHistory, !locked);

  const deleteSelection = useCallback(() => {
    if (locked) return;
    undoHistory.boundary();
    deleteObjects(boardDoc, [...selection.ids]);
    undoHistory.boundary();
    selection.clear();
  }, [boardDoc, locked, selection, undoHistory]);

  // --- Gestures -------------------------------------------------------------
  const gesture = useTransformGesture({
    doc: boardDoc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !locked,
    onGestureStart: () => undoHistory.boundary(),
    onGestureEnd: () => undoHistory.boundary(),
  });

  const addToSelection = useCallback((ids: string[]) => selection.setMany(ids, true), [selection]);
  const marquee = useMarquee(camera, notes, addToSelection);

  // --- Text creation (story 9) ----------------------------------------------
  const handleTextClick = useCallback(
    (worldPoint: Point) => {
      if (locked) return;
      undoHistory.boundary();
      const id = createText(boardDoc, worldPoint, 'local');
      undoHistory.boundary();
      active.setTool('select');
      if (id) {
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [boardDoc, locked, selection, undoHistory, active],
  );

  useBoardKeys({
    doc: boardDoc,
    selection,
    snapshot: notes,
    canEdit: !locked,
    onEscape: () => {
      if (!marquee.rect) return false;
      marquee.cancel();
      return true;
    },
    undo: undoHistory,
  });

  const createStickyAtCentre = useCallback(() => {
    const centre = viewportApi.current?.viewportCentreWorld() ?? { x: 0, y: 0 };
    undoHistory.boundary();
    const id = createSticky(boardDoc, centre);
    undoHistory.boundary();
    if (id) {
      selection.click(id);
      selection.startEdit(id);
    }
  }, [boardDoc, selection, undoHistory]);

  const openForEditing = useCallback(
    (id: string) => {
      selection.click(id);
      selection.startEdit(id);
    },
    [selection],
  );

  const onEditChange = useCallback(
    (id: string, next: EndEditTarget | null) => {
      if (next === null) {
        if (!locked) selection.startEdit(id);
        return;
      }
      if (next === 'unselected') selection.clear();
      else selection.endEdit();
    },
    [locked, selection],
  );

  useEffect(() => {
    installBoardHook(() => snapshot(boardDoc));
    installApplyUpdate((bytes) => Y.applyUpdate(boardDoc, bytes));
  }, [boardDoc]);
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  const paintOrder = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    [notes],
  );

  const transforming = gesture.draggingIds.size > 0 || selection.editingId !== null;

  return (
    <UndoContext.Provider value={undoHistory}>
    <main className="app" data-testid="app-root">
      <ConnectionStatus state={connection} />
      <SelectionAnnouncement count={selection.count} />
      <Toolbar
        onCreateSticky={createStickyAtCentre}
        undo={undoApi}
        locked={locked}
        tool={active.tool}
        onTool={active.setTool}
        shapeKind={active.shapeKind}
        onShapeKind={active.setShapeKind}
      />
      <BoardViewport
        doc={boardDoc}
        viewportApi={viewportApi}
        onStickyCreated={openForEditing}
        onClearSelection={() => selection.clear()}
        onCameraChange={setCamera}
        marquee={marquee}
        locked={locked}
        tool={active.tool}
        onTextClick={handleTextClick}
        overlay={
          <>
            {/*
              A drawing tool's own layer, above the objects and below the selection
              bar: while it is up it owns the pointer, so a drag that starts on a shape
              draws instead of moving it.
            */}
            {active.tool === 'shape' && !locked ? (
              <ShapeTool
                doc={boardDoc}
                kind={active.shapeKind}
                camera={camera}
                onCreated={active.toolCreated}
                onUndoBoundary={() => undoHistory.boundary()}
              />
            ) : null}
            {active.tool === 'connector' && !locked ? (
              <ConnectorTool
                doc={boardDoc}
                camera={camera}
                snapshot={notes}
                onCreated={active.toolCreated}
                onUndoBoundary={() => undoHistory.boundary()}
              />
            ) : null}
            <SelectionOverlay
              ids={selection.ids}
              snapshot={notes}
              camera={camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            >
              <SelectionBar
                ids={selection.ids}
                snapshot={notes}
                doc={boardDoc}
                onDelete={deleteSelection}
                undo={undoHistory}
                locked={locked}
                hideControls={transforming}
              />
            </SelectionOverlay>
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </>
        }
      >
        {paintOrder.map((note) => {
          const objectType = getObjectType(note.type);
          if (!objectType) return null;
          return (
            <objectType.Component
              key={note.id}
              doc={boardDoc}
              snapshot={note}
              camera={camera}
              selection={{
                selected: selection.has(note.id),
                editing: selection.editingId === note.id,
                dragging: gesture.draggingIds.has(note.id),
              }}
              onEditChange={onEditChange}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onUndoBoundary={() => undoHistory.boundary()}
            />
          );
        })}
      </BoardViewport>
    </main>
    </UndoContext.Provider>
  );
}
