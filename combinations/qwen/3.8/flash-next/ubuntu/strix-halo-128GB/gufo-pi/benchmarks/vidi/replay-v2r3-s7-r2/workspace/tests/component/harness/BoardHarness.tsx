import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { getObjectType } from '../../../src/client/objects/registry';
import type { ObjectProps } from '../../../src/client/objects/registry';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';
import { createSticky, deleteObjects } from '../../../src/shared/board-model';
import type { ObjectSnapshot } from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  /** The single selected id, or null when none or several are selected. */
  getSelectedId(): string | null;
  /** Every selected id, in selection order. */
  getSelectedIds(): string[];
  getEditingId(): string | null;
  setCamera(cam: Camera): void;
  clearSelection(): void;
  /** Create a sticky note without selecting or editing it. */
  addSticky(at: { x: number; y: number }, text?: string, color?: StickyColor): string;
}

type SharedObjectProps = Omit<ObjectProps, 'obj' | 'selected' | 'soleSelected' | 'editing' | 'transforming'>;

export interface BoardHarnessProps {
  handleRef: React.MutableRefObject<HarnessHandle | null>;
  viewport?: Size;
  /** When true, editing (create / move / resize / colour / delete / text) is disabled. */
  readOnly?: boolean;
  /** Transform gesture notifications, for tests that count them. */
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

/**
 * The board wiring (document, selection, marquee, transform gesture, viewport,
 * toolbar, objects) with the handles a component test needs. Mirrors App.tsx;
 * kept here so tests can reach the Y.Doc and the local state without exposing
 * them in production.
 */
export function BoardHarness({
  handleRef,
  viewport = { width: 1280, height: 800 },
  readOnly = false,
  onGestureStart,
  onGestureEnd,
}: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom, setCamera } = useCamera(viewport);
  const { doc, objects } = useBoardDoc(null);
  const selection = useSelection(objects);

  const live = useRef({ camera, selection });
  live.current = { camera, selection };

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedId: () =>
        live.current.selection.ids.size === 1 ? [...live.current.selection.ids][0] : null,
      getSelectedIds: () => [...live.current.selection.ids],
      getEditingId: () => live.current.selection.editingId,
      setCamera,
      clearSelection: () => live.current.selection.clear(),
      addSticky: (at, text, color) => {
        const id = createSticky(doc, at, color);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          (m.get('text') as Y.Text).insert(0, text);
        }
        return id;
      },
    };
  }

  const marquee = useMarquee(
    camera,
    objects,
    useCallback((ids: string[]) => selection.setMany(ids, true), [selection]),
  );

  const gesture = useTransformGesture({
    doc,
    selection,
    snapshot: objects,
    camera,
    canEdit: !readOnly,
    onGestureStart,
    onGestureEnd,
  });

  useBoardKeys({ doc, selection, snapshot: objects, canEdit: !readOnly });

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

  const handleEmptyClick = useCallback(() => selection.clear(), [selection]);

  const deleteSelection = useCallback(() => {
    if (readOnly) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, readOnly, selection]);

  const shared: SharedObjectProps = {
    doc,
    zoom: camera.zoom,
    editable: !readOnly,
    onObjectPointerDown: gesture.onObjectPointerDown,
    onStartEdit: selection.startEdit,
    onEndEdit: selection.endEdit,
  };

  const renderObject = (obj: ObjectSnapshot) => {
    const spec = getObjectType(obj.type);
    if (!spec) return null;
    const Component = spec.Component;
    const selected = selection.ids.has(obj.id);
    return (
      <Component
        key={obj.id}
        obj={obj}
        {...shared}
        selected={selected}
        soleSelected={selected && selection.ids.size === 1}
        editing={selection.editingId === obj.id}
        transforming={gesture.activeIds.has(obj.id)}
      />
    );
  };

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        overlay={
          <>
            <SelectionOverlay
              ids={selection.ids}
              snapshot={objects}
              camera={camera}
              editable={!readOnly}
              frozen={gesture.frozen}
              onHandlePointerDown={gesture.onHandlePointerDown}
              onEmptyDblClick={handleEmptyDblClick}
            />
            <SelectionBar
              ids={selection.ids}
              snapshot={objects}
              camera={camera}
              editable={!readOnly}
              onDelete={deleteSelection}
            />
            <MarqueeRect rect={marquee.rect} camera={camera} />
          </>
        }
      >
        {objects.map(renderObject)}
      </BoardViewport>
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
