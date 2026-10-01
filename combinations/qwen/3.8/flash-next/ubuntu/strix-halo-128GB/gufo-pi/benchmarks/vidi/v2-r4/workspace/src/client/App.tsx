import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardViewport,
  type ViewportBridge,
} from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import * as Y from 'yjs';
import { createSticky, deleteObjects } from '../shared/board-model';
import { isTestMode, setTestConnectionState } from './testHooks';
import { canEdit } from './sync/connectBoard';
import type { Camera, Point } from './canvas/camera';
import type { Handle } from '../shared/geometry';

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

  const selection = useSelection(notes);
  const bridgeRef = useRef<ViewportBridge | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const onCameraChange = useCallback((cam: Camera) => setCamera(cam), []);

  // Transform gesture: move and resize
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
  });

  // Marquee: shift+drag on empty space
  const marquee = useMarquee(camera, notes, (ids) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  });

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
  });

  /** Centre a new note on a world point, select it and start typing. */
  const createAndEdit = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [doc, selection, isReadOnly],
  );

  const onCreateStickyWorld = useCallback(
    (world: Point) => {
      createAndEdit(world);
    },
    [createAndEdit],
  );

  /** The toolbar button: a note centred in the visible board area. */
  const onCreateSticky = useCallback(() => {
    const centre = bridgeRef.current?.centreWorld();
    if (!centre) return;
    createAndEdit(centre);
  }, [createAndEdit]);

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
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, isReadOnly]);

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
      >
        {notes.map((note) => (
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
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
    </div>
  );
}
