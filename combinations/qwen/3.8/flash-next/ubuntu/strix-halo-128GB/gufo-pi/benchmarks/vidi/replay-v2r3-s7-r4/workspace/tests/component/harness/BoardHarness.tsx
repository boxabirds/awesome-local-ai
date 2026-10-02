import React, { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { ObjectLayer } from '../../../src/client/board/ObjectLayer';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { Toolbar } from '../../../src/client/board/Toolbar';
import {
  bringObjectsToFront,
  createSticky,
  deleteObjects,
} from '../../../src/shared/board-model';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';
import '../../../src/client/objects/registry';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  /** The single selected id, or null when zero or many are selected. */
  getSelectedId(): string | null;
  getSelectedIds(): string[];
  getEditingId(): string | null;
}

export interface BoardHarnessProps {
  handleRef: React.MutableRefObject<HarnessHandle | null>;
  viewport?: Size;
  /** When true, editing (create / drag / resize / colour / delete / text) is disabled. */
  readOnly?: boolean;
  /** Called on each transform-gesture start/end (story 8 undo, TC-30/31). */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/**
 * The story 7 board wiring (document, multi-selection, viewport, toolbar, object
 * layer via the registry, transform gesture, marquee, overlay and bar) with the
 * handles a component test needs. Mirrors App.tsx.
 */
export function BoardHarness({
  handleRef,
  viewport = { width: 1280, height: 800 },
  readOnly = false,
  onGestureStart,
  onGestureEnd,
}: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !readOnly,
    onGestureStart,
    onGestureEnd,
  });

  const getViewportRect = useCallback(
    (): DOMRect =>
      ({
        left: 0,
        top: 0,
        right: viewport.width,
        bottom: viewport.height,
        width: viewport.width,
        height: viewport.height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
    [viewport.width, viewport.height],
  );

  const marquee = useMarquee({
    selection,
    snapshot: notes,
    camera,
    canEdit: !readOnly,
    getViewportRect,
  });

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: !readOnly });

  const live = useRef({ camera, selection });
  live.current = { camera, selection };

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedId: () => {
        const ids = live.current.selection.ids;
        return ids.size === 1 ? [...ids][0] : null;
      },
      getSelectedIds: () => [...live.current.selection.ids],
      getEditingId: () => live.current.selection.editingId,
    };
  }

  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      const id = createSticky(doc, screenToWorld(camera, point));
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, readOnly],
  );

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => createAtScreenPoint(point),
    [createAtScreenPoint],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

  const handleDeleteSelection = useCallback(() => {
    if (readOnly) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, readOnly]);

  const handleBringToFront = useCallback(() => {
    if (readOnly) return;
    bringObjectsToFront(doc, [...selection.ids]);
  }, [doc, selection, readOnly]);

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={() => selection.clear()}
        onEmptyDblClick={handleEmptyDblClick}
        onSurfaceShiftPointerDown={marquee.startMarquee}
      >
        <ObjectLayer
          snapshot={notes}
          doc={doc}
          camera={camera}
          selectedIds={selection.ids}
          editingId={selection.editingId}
          draggingIds={gesture.draggingIds}
          editable={!readOnly}
          onObjectPointerDown={gesture.onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={selection.endEdit}
        />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
        onBringToFront={handleBringToFront}
      />
      <MarqueeRect rect={marquee.marquee} />
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
