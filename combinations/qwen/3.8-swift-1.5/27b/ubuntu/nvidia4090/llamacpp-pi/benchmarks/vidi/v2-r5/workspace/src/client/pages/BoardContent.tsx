// src/client/pages/BoardContent.tsx
// The board UI from stories 1-7.

import { useEffect, useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { screenToWorld } from '../canvas/camera';
import type { Size, Camera, Point } from '../canvas/camera';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import '../objects/registerSticky';
import { createSticky, deleteObjects, objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';

// Test-only hook
declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      connectionState?: string;
    };
  }
}

export function BoardContent(props: { boardId: string }): ReactElement {
  const { boardId } = props;

  const [viewport, setViewport] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cam = useCamera(viewport);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Expose test hook in test mode
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = {
        setCamera: (c: Camera) => {
          cam.setCamera(c);
        },
        connectionState,
      };
    }
    return () => {
      delete window.__vidi6;
    };
  });

  // Marquee selection
  const marquee = useMarquee(cam.camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Keyboard commands
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable });

  // Create sticky at a screen point (disabled when load_failed)
  const createStickyAtScreen = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    const id = createSticky(doc, worldPoint);
    if (id) {
      selection.startEdit(id);
    }
  }, [cam.camera, doc, selection, connectionState]);

  // Create sticky at viewport centre (toolbar button)
  const createStickyAtCentre = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createStickyAtScreen(centre);
  }, [viewport, createStickyAtScreen]);

  // Handle double-click on empty board space
  const handleDblClickEmpty = useCallback((screenPoint: Point) => {
    createStickyAtScreen(screenPoint);
  }, [createStickyAtScreen]);

  // Handle click on empty board space (clear selection)
  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Handle double-click on a note (start editing)
  const handleNoteDblClick = useCallback((_e: React.MouseEvent, id: string) => {
    if (editable) {
      selection.startEdit(id);
    }
  }, [selection, editable]);

  // Handle end edit from the text editor
  const handleEndEdit = useCallback((_next: 'selected' | 'unselected') => {
    selection.endEdit();
  }, [selection]);

  // Compute selection bar position (above bounding box in screen space)
  const selectedObjects = notes.filter(n => selection.ids.has(n.id));
  const bbox = unionRects(selectedObjects.map(o => objectBounds(o)));
  let barStyle: React.CSSProperties | undefined;
  if (bbox && selection.ids.size > 0) {
    const topLeft = worldToScreen(cam.camera, { x: bbox.x, y: bbox.y });
    barStyle = {
      position: 'absolute',
      left: topLeft.x + (bbox.width * cam.camera.zoom) / 2,
      top: topLeft.y - 8,
      transform: 'translate(-50%, -100%)',
      zIndex: 100,
    };
  }

  // Handle delete selection
  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, editable]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomIn={cam.zoomIn}
        zoomOut={cam.zoomOut}
        reset={cam.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cam.camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={selection.editingId === note.id}
            onPointerDown={gesture.onObjectPointerDown}
            onDblClick={handleNoteDblClick}
            onEndEdit={handleEndEdit}
          />
        ))}
        {/* Marquee rectangle in world space */}
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>

      {/* Selection overlay (screen space) */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* Selection bar (screen space, positioned above bounding box) */}
      {barStyle && (
        <div style={barStyle}>
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            onDelete={handleDeleteSelection}
          />
        </div>
      )}

      <Toolbar onCreateSticky={createStickyAtCentre} disabled={!editable} />
      <ZoomControls
        zoomPercent={cam.zoomPercent}
        canZoomIn={cam.canZoomIn}
        canZoomOut={cam.canZoomOut}
        onZoomIn={cam.zoomIn}
        onZoomOut={cam.zoomOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </>
  );
}
