/**
 * The live board for one board id (stories 1–7): document, multi-selection,
 * toolbar, objects, connection badge, marquee, transform gesture, and
 * keyboard shortcuts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { Toolbar } from './Toolbar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { reportConnectionState } from '../canvas/testHooks';
import { createSticky, setStickyColor, deleteObjects } from '../../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import { useMarquee, MarqueeRect } from './Marquee';
import { useTransformGesture } from './useTransformGesture';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { useBoardKeys } from './useBoardKeys';
import { createUndo, type UndoController } from './undo';
import { useUndo } from './useUndo';
import type { Handle } from '../../shared/geometry';

/**
 * The live board for one board id: document, selection state, toolbar,
 * objects, connection badge, and keyboard shortcuts.
 */
export function Board({ boardId }: { boardId: string }): JSX.Element {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  // Editing is locked only while the board failed to load (close code 4500).
  const editable = canEdit(connectionState);

  // Publish the mapped state for long-running e2e tests (test builds only).
  useEffect(() => {
    reportConnectionState(connectionState);
  }, [connectionState]);

  // Camera ref updated by BoardViewport via onCameraChange callback
  const cameraRef = useRef<Camera>({ x: -640, y: -400, zoom: 1 });
  const [camera, setCamera] = useState<Camera>({ x: -640, y: -400, zoom: 1 });

  // Per-user undo controller (story 8): session-only, scoped to this doc.
  const [undo, setUndo] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setUndo(controller);
    return () => {
      controller.destroy();
      setUndo(null);
    };
  }, [doc]);
  const undoBinding = useUndo(undo, editable);
  const undoBoundary = useCallback(() => {
    undo?.boundary();
  }, [undo]);

  // Marquee
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    boundary: undoBoundary,
  });

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    boundary: undoBoundary,
    undo,
  });

  const onDblClickEmpty = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (!editable) return;
      const cam = cameraRef.current;
      const world = screenToWorld(cam, screenPoint);
      const id = createSticky(doc, world);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable],
  );

  const onClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  const onCreateSticky = useCallback(() => {
    if (!editable) return;
    const cam = cameraRef.current;
    const centre = { x: 640, y: 400 };
    const world = screenToWorld(cam, centre);
    undoBoundary();
    const id = createSticky(doc, world);
    undoBoundary();
    if (id) {
      selection.startEdit(id);
    }
  }, [doc, selection, editable, undoBoundary]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const onObjectDoubleClick = useCallback(
    (id: string) => {
      if (!editable) return;
      const obj = notes.find((o) => o.id === id);
      if (obj && obj.type === 'sticky') {
        selection.startEdit(id);
      }
    },
    [editable, notes, selection],
  );

  const onDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoBoundary();
    deleteObjects(doc, Array.from(selection.ids));
    undoBoundary();
    selection.clear();
  }, [doc, selection, editable, undoBoundary]);

  const onColorChange = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      if (selection.ids.size !== 1) return;
      const [id] = selection.ids;
      undoBoundary();
      setStickyColor(doc, id, color);
      undoBoundary();
    },
    [doc, selection, editable, undoBoundary],
  );

  // Render objects through the registry
  const renderObjects = () => {
    return notes.map((obj) => {
      const spec = getObjectType(obj.type);
      if (!spec) return null;
      const Comp = spec.Component;
      return (
        <Comp
          key={obj.id}
          obj={obj}
          selected={selection.ids.has(obj.id)}
          editing={selection.editingId === obj.id}
          canEdit={editable}
          onPointerDown={onObjectPointerDown}
          onDoubleClick={onObjectDoubleClick}
          doc={doc}
          onEndEdit={(next: 'selected' | 'unselected') => {
            selection.endEdit(next);
          }}
          undo={undo}
        />
      );
    });
  };

  // Position the selection bar above the bounding box
  const barPosition = (() => {
    if (selection.ids.size === 0) return null;
    const selectedRects = notes
      .filter((o) => selection.ids.has(o.id))
      .map((o) => {
        const w = o.width ?? STICKY_SIZE_WORLD;
        const h = o.height ?? STICKY_SIZE_WORLD;
        return { x: o.x, y: o.y, w, h };
      });
    if (selectedRects.length === 0) return null;
    const minY = Math.min(...selectedRects.map((r) => r.y));
    const centerX = selectedRects.reduce((s, r) => s + r.x + r.w / 2, 0) / selectedRects.length;
    const screen = worldToScreen(camera, { x: centerX, y: minY });
    return { left: screen.x, top: screen.y - 8 };
  })();

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onDblClickEmpty={onDblClickEmpty}
        onClickEmpty={onClickEmpty}
        onCameraChange={(cam) => {
          cameraRef.current = cam;
          setCamera(cam);
        }}
        onMarqueeBegin={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
      >
        {renderObjects()}
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={onHandlePointerDown}
      />

      {barPosition && (
        <div
          style={{
            position: 'fixed',
            left: `${barPosition.left}px`,
            top: `${barPosition.top}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={onDeleteSelection}
            onColor={onColorChange}
          />
        </div>
      )}

      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} undo={undoBinding} />
    </>
  );
}
