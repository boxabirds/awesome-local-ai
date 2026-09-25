import { useCallback, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { BoardContext, type BoardContextValue } from './canvas/BoardContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useBoardKeys } from './board/useBoardKeys';
import { useTransformGesture } from './board/useTransformGesture';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState, ProviderFactory } from './sync/connectBoard';
import { createSticky, deleteObjects, setStickyColor } from '../shared/board-model';
import type { StickyColor } from '../shared/config';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

const HALF = 2;

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Whether the board may be changed (anchor: persist.client_status). False only while the
 * saved board cannot be loaded: editing an empty stand-in would look like lost work.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface AppProps {
  /** Board to join live. Omitted: a local-only board (component tests). */
  boardId?: string;
  doc?: Y.Doc;
  createProvider?: ProviderFactory;
}

export function App(props: AppProps = {}): React.JSX.Element {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const board = useCamera(viewport);
  const context = useMemo<BoardContextValue>(() => ({ board, setViewport }), [board]);
  const { camera } = board;
  const { doc, objects, connection } = useBoardDoc({
    boardId: props.boardId,
    doc: props.doc,
    createProvider: props.createProvider,
  });
  const editable = canEdit(connection);
  const selection = useSelection(objects);
  const { ids: selectedIds, click, clear, setMany, startEdit, endEdit } = selection;
  const editingId = editable ? selection.editingId : null;
  // DOM order never changes when objects are brought to front (moving a DOM node would drop
  // its pointer capture mid-drag); stacking comes from each object's z-index instead.
  const renderOrder = useMemo(
    () =>
      objects
        .filter((o) => getObjectType(o.type) !== undefined)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [objects],
  );

  const transform = useTransformGesture({ doc, camera, selection, snapshot: objects, canEdit: editable });
  const { gesture } = transform;
  const marquee = useMarquee(camera, objects, useCallback((ids: string[]) => setMany(ids, true), [setMany]));
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  const createAt = useCallback(
    (world: Point) => {
      if (!editable) return;
      const id = createSticky(doc, world);
      if (id !== '') startEdit(id);
    },
    [doc, startEdit, editable],
  );

  const onCreateSticky = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / HALF, y: viewport.height / HALF }));
  }, [camera, viewport, createAt]);

  const onDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selectedIds]);
    clear();
  }, [doc, selectedIds, clear, editable]);
  const onColor = useCallback((id: string, c: StickyColor) => setStickyColor(doc, id, c), [doc]);

  const overlay = (
    <>
      <SelectionOverlay
        ids={selectedIds}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={transform.onHandlePointerDown}
        showHandles={editable && editingId === null}
      />
      <SelectionBar
        ids={selectedIds}
        snapshot={objects}
        camera={camera}
        editable={editable}
        hidden={editingId !== null || gesture.kind !== 'idle'}
        onDelete={onDeleteSelection}
        onColor={onColor}
      />
    </>
  );

  return (
    <BoardContext.Provider value={context}>
      <main className="app">
        <BoardViewport
          onBackgroundClick={clear}
          onBackgroundDoubleClick={createAt}
          marquee={marquee}
          overlay={overlay}
        >
          {renderOrder.map((obj) => {
            const { Component } = getObjectType(obj.type)!;
            return (
              <Component
                key={obj.id}
                object={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selectedIds.has(obj.id)}
                editing={obj.id === editingId}
                transforming={gesture.ids.has(obj.id)}
                editable={editable}
                onPointerDown={transform.onObjectPointerDown}
                onSelect={click}
                onStartEdit={startEdit}
                onEndEdit={endEdit}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
      </main>
    </BoardContext.Provider>
  );
}

/**
 * The page for the current address (anchor: share.pages): `/` home, `/b/:id` the board
 * (after an existence check), anything else Board not found. Boards are created only by
 * the Create a board action; no address creates one by being opened.
 */
export function Routes(): React.JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
