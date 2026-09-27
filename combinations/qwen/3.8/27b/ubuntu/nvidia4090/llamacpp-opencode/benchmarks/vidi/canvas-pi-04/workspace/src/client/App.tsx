// Story 2: wires the board together: the Y.Doc (useBoardDoc), the notes,
// selection state, keyboard shortcuts and the fixed UI (toolbar, zoom, hint).
//
// Story 3: the live badge reflects the connection state.
//
// Story 5: App is a route switch (share.pages): `/` is the Home page,
// `/b/<id>` is the Board page (existence check, then this board), anything
// else is the Board-not-found page.
//
// Story 7: objects are rendered through the object-type registry, and the
// selection/transform gestures, marquee, selection overlay/bar and keyboard
// commands are wired here. Selection is set-based (many ids); a screen-space
// overlay holds the marquee rect, the selection outline/handles and the bar.

import type { JSX } from 'react';
import { createSticky, deleteObjects } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { useCamera, useWindowSize } from './canvas/useCamera';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): JSX.Element {
  const route = useRoute();
  if (route.name === 'home') {
    return <HomePage />;
  }
  if (route.name === 'board') {
    return <BoardPage id={route.id} />;
  }
  return <NotFoundPage />;
}

/** The full board experience for one board id (stories 1–4, 7). */
export function Board(props: { boardId: string }): JSX.Element {
  const viewport = useWindowSize();
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, objects, connectionState } = useBoardDoc(props.boardId);
  // Editing is locked out only while the board could not be loaded (story 4):
  // create/move/resize/edit/colour/delete are no-ops and the toolbar is
  // disabled. Selection stays available (read-only).
  const editable = canEdit(connectionState);
  const selection = useSelection(objects);

  // The shared transform gesture: group move (object pointerdown) and
  // bounding-box resize (handle pointerdown) for every registered type.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
  });

  // Shift+drag marquee: add the objects inside the rect to the selection.
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // Window keyboard commands (select all, clear, nudge, delete, edit).
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable });

  const createAtPoint = (at: { x: number; y: number }): void => {
    if (!editable) return; // load_failed: create is a no-op
    const id = createSticky(doc, at);
    if (id !== null) {
      selection.click(id);
      selection.startEdit(id);
    }
  };

  const createAtCenter = (): void => {
    createAtPoint(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  };

  const deleteSelection = (): void => {
    if (!editable) return;
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selection.clear();
  };

  return (
    <div className="app-root">
      <BoardViewport
        onCreateStickyAt={createAtPoint}
        onClearSelection={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (spec === undefined) return null; // unknown type: never rendered
          const Comp = spec.Component;
          return (
            <Comp
              key={obj.id}
              obj={obj}
              doc={doc}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              canEdit={editable}
              onPointerDown={(e) => gesture.onObjectPointerDown(e, obj.id)}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          );
        })}
      </BoardViewport>

      {/* Screen-space overlay above the board: marquee rect, selection
          outline + resize handles, and the floating selection bar. It is
          pointer-events: none except the interactive handles/bar, so pans,
          marquee and object presses still reach the board beneath. */}
      <div className="board-overlay">
        <MarqueeRect rect={marquee.rect} camera={camera} />
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          camera={camera}
          doc={doc}
          canEdit={editable}
          onDelete={deleteSelection}
        />
      </div>

      <Toolbar onCreateSticky={createAtCenter} canEdit={editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          if (canZoomIn(camera)) zoomStep('in');
        }}
        onZoomOut={() => {
          if (canZoomOut(camera)) zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  );
}
