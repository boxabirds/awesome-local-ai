import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardViewport,
  type ViewportBridge,
} from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { useTool } from './board/useTool';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import * as Y from 'yjs';
import { createSticky, deleteObjects } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { isTestMode, setTestConnectionState } from './testHooks';
import { canEdit } from './sync/connectBoard';
import type { Camera, Point } from './canvas/camera';
import type { Handle } from '../shared/geometry';
import { createCanvasMeasurer } from './objects/textLayout';

// Register sticky note type (side effect: populates the registry)
import './objects/registerTypes';

export interface AppProps {
  /**
   * Optional board document. Production passes nothing and the app owns one;
   * component tests pass a doc they can also read and mutate.
   */
  doc?: Y.Doc;
  /**
   * Optional boardId to connect to the sync server. If omitted, no connection.
   */
  boardId?: string;
}

export function App({ doc: externalDoc, boardId: propBoardId }: AppProps = {}): React.JSX.Element {
  const boardId = propBoardId;

  const { doc, notes, connectionState } = useBoardDoc(externalDoc, boardId);
  const isReadOnly = !canEdit(connectionState);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (isTestMode()) {
      setTestConnectionState(connectionState);
    }
  }, [connectionState]);

  // Undo controller: one per board doc, destroyed on unmount
  const [undoCtrl, setUndoCtrl] = useState<UndoController | null>(null);
  useEffect(() => {
    const ctrl = createUndo(doc);
    setUndoCtrl(ctrl);
    return () => { ctrl.destroy(); setUndoCtrl(null); };
  }, [doc]);

  const undoState = useUndo(undoCtrl, !isReadOnly);

  const selection = useSelection(notes);
  const bridgeRef = useRef<ViewportBridge | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const onCameraChange = useCallback((cam: Camera) => setCamera(cam), []);

  // Tool state
  const { tool, setTool } = useTool(!isReadOnly);

  // Measurer for text objects
  const measurer = useMemo(() => createCanvasMeasurer(), []);

  // Transform gesture: move and resize (boundary on gesture start/end)
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
    onGestureStart: undoCtrl?.boundary,
    onGestureEnd: undoCtrl?.boundary,
  });

  // Marquee: shift+drag on empty space
  const marquee = useMarquee(camera, notes, (ids) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  });

  /** Centre a new note on a world point, select it and start typing. */
  const createAndEdit = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      undoCtrl?.boundary();
      const id = createSticky(doc, world);
      undoCtrl?.boundary();
      if (id) selection.startEdit(id);
    },
    [doc, selection, isReadOnly, undoCtrl],
  );

  const onCreateStickyWorld = useCallback(
    (world: Point) => {
      createAndEdit(world);
    },
    [createAndEdit],
  );

  /** The toolbar button or N key: a note centred in the visible board area. */
  const onCreateSticky = useCallback(() => {
    const centre = bridgeRef.current?.centreWorld();
    if (!centre) return;
    createAndEdit(centre);
  }, [createAndEdit]);

  /** Text tool: click creates text at world point, then switch to select and start editing. */
  const onTextToolClick = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      undoCtrl?.boundary();
      const id = createText(doc, world, 'local');
      undoCtrl?.boundary();
      if (id) {
        setTool('select');
        selection.startEdit(id);
      }
    },
    [doc, selection, isReadOnly, undoCtrl, setTool],
  );

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
    undo: undoCtrl ?? undefined,
    tool,
    setTool,
    onCreateSticky,
  });

  const clearSelection = useCallback(() => selection.clear(), [selection]);

  const onDeleted = useCallback(
    (_id: string) => {
      // Selection pruning handles this via the snapshot effect
    },
    [],
  );

  const onDeleteSelection = useCallback(() => {
    if (selection.ids.size === 0) return;
    if (isReadOnly) return;
    undoCtrl?.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoCtrl?.boundary();
    selection.clear();
  }, [doc, selection, isReadOnly, undoCtrl]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, handle: Handle) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  // Marquee handlers
  const onMarqueeStart = useCallback(
    (screen: Point) => marquee.begin(screen),
    [marquee],
  );
  const onMarqueeMove = useCallback(
    (screen: Point) => marquee.move(screen),
    [marquee],
  );
  const onMarqueeEnd = useCallback(
    () => marquee.end(),
    [marquee],
  );
  const onMarqueeCancel = useCallback(
    () => marquee.cancel(),
    [marquee],
  );

  // Build the overlay (screen-space elements: marquee rect, selection overlay, selection bar)
  const overlay = (
    <>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={onDeleteSelection}
      />
    </>
  );

  // Separate sticky notes and text objects
  const stickyNotes = notes.filter((n) => n.type === 'sticky');
  const textObjects = notes.filter((n) => n.type === 'text');

  return (
    <div className="app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        bridgeRef={bridgeRef}
        onCreateStickyWorld={onCreateStickyWorld}
        onClearSelection={clearSelection}
        onCameraChange={onCameraChange}
        onMarqueeStart={onMarqueeStart}
        onMarqueeMove={onMarqueeMove}
        onMarqueeEnd={onMarqueeEnd}
        onMarqueeCancel={onMarqueeCancel}
        overlay={overlay}
        tool={tool}
        onTextToolClick={onTextToolClick}
      >
        {stickyNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onPointerDown={onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onDeleted={onDeleted}
            undo={undoCtrl ?? undefined}
          />
        ))}
        {textObjects.map((obj) => (
          <TextObject
            key={obj.id}
            obj={obj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(obj.id)}
            editing={obj.id === selection.editingId}
            canEdit={!isReadOnly}
            onPointerDown={onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onDeleted={onDeleted}
            undo={undoCtrl ?? undefined}
            measurer={measurer}
          />
        ))}
      </BoardViewport>
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        canEdit={!isReadOnly}
        onCreateSticky={onCreateSticky}
        undo={undoState}
      />
    </div>
  );
}
