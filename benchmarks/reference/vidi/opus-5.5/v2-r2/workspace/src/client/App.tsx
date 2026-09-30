import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  isStickyColor,
  resizeObjects,
  setStickyColor,
  stickiesOf,
} from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { type Point, type Size, canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installTestHooks } from './canvas/testHooks';
import { BoardCameraContext, useCamera } from './canvas/useCamera';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';

function initialViewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Whether the board may be edited: never while its saved state cannot be loaded. */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * `boardId` connects the board to its live room; without it the board stays
 * local. `doc` lets tests supply the board document; the app creates its own.
 */
export function App(props: { boardId?: string | null; doc?: Y.Doc } = {}): React.JSX.Element {
  const [viewportSize, setViewportSize] = useState<Size>(initialViewportSize);
  const board = useCamera(viewportSize);
  const context = useMemo(() => ({ ...board, setViewportSize }), [board]);
  const { camera } = board;
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, startEdit, endEdit } = selection;
  // A board that could not be loaded is never presented as an empty editable board.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  useEffect(() => {
    if (!editable) endEdit('selected');
  }, [editable, endEdit]);

  const gesture = useTransformGesture({ doc, camera, selection, snapshot: objects, canEdit: editable });
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  useEffect(
    () =>
      installTestHooks({
        getNotes: () => stickiesOf(objects),
        getSelection: () => [...selectedIds],
        seedNotes: (notes) =>
          notes.map((n) => {
            const size = n.size ?? STICKY_SIZE_WORLD;
            const color = isStickyColor(n.color) ? n.color : undefined;
            const id = createSticky(doc, { x: n.x + STICKY_SIZE_WORLD / 2, y: n.y + STICKY_SIZE_WORLD / 2 }, color);
            if (id === false) throw new Error('seed rejected');
            if (n.text) doc.transact(() => getStickyText(doc, id)?.insert(0, n.text!), LOCAL_ORIGIN);
            if (size !== STICKY_SIZE_WORLD) resizeObjects(doc, new Map([[id, { x: n.x, y: n.y, width: size, height: size }]]));
            return id;
          }),
      }),
    [objects, selectedIds, doc],
  );
  const connectionStates = useRef<ConnectionState[]>([]);
  useEffect(() => {
    if (!props.boardId) return;
    connectionStates.current.push(connection);
    return installTestHooks({ connectionState: connection, connectionStates: connectionStates.current });
  }, [props.boardId, connection]);

  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      const id = createSticky(doc, world);
      if (id !== false) startEdit(id);
    },
    [doc, startEdit],
  );

  const createAtViewportCentre = () =>
    createAt(screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));

  const deleteSelection = () => {
    deleteObjects(doc, [...selectedIds]);
    selection.clear();
  };

  const transforming = gesture.active !== null;

  return (
    <BoardCameraContext.Provider value={context}>
      <main className="app">
        <BoardViewport onEmptyDoubleClick={createAt} onEmptyClick={selection.clear} marquee={marquee}>
          {[...objects].sort(byId).map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const selected = selectedIds.has(obj.id);
            return (
              <spec.Component
                key={obj.id}
                object={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selected}
                editing={obj.id === editingId}
                editable={editable}
                transforming={transforming && selected}
                onPointerDown={gesture.onObjectPointerDown}
                onSelect={selection.click}
                onStartEdit={startEdit}
                onEndEdit={endEdit}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </BoardViewport>
        <SelectionOverlay
          ids={selectedIds}
          snapshot={objects}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
          showHandles={editable && editingId === null}
        />
        <SelectionBar
          ids={selectedIds}
          snapshot={objects}
          camera={camera}
          onDelete={deleteSelection}
          onColor={(id, color) => setStickyColor(doc, id, color)}
          hidden={!editable || editingId !== null || transforming}
        />
        <Toolbar onCreateSticky={createAtViewportCentre} disabled={!editable} />
        {props.boardId && <ConnectionStatus state={connection} />}
        <NavigationHint visible={!board.hasNavigated} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
      </main>
    </BoardCameraContext.Provider>
  );
}
