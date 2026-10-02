import { useEffect, useRef, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useMarquee } from '../../../src/client/board/useMarquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { getObjectType } from '../../../src/client/objects/registry';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { MarqueeRect } from '../../../src/client/board/Marquee';
import {
  setStickyColor,
  deleteObjects,
  objectBounds,
  createSticky,
} from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';
import { unionRects } from '../../../src/shared/geometry';
import { worldToScreen } from '../../../src/client/canvas/camera';

export interface TestBoardProps {
  camera: Camera;
  viewportSize: Size;
  onDocReady?: (doc: Y.Doc) => void;
  /** Whether local edits are allowed (default true). */
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Pan callbacks (the viewport delegates to these). */
  beginPan?: (p: Point) => void;
  panMove?: (d: Point) => void;
  endPan?: () => void;
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

/**
 * A test double for the board: renders notes through the generic registry and
 * wires the real selection/marquee/gesture/keyboard hooks — the same
 * composition the real BoardPage uses.
 */
export function TestBoard({
  camera,
  viewportSize,
  onDocReady,
  canEdit = true,
  onGestureStart,
  onGestureEnd,
  beginPan,
  panMove,
  endPan,
  wheel,
}: TestBoardProps): ReactNode {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  const marquee = useMarquee(camera, notes, (ids) => selection.setMany(ids, true));
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });

  const handleObjectPointerDown = (e: PointerEvent, id: string) => {
    if (e.shiftKey) {
      selection.toggle(id);
      return;
    }
    gesture.onObjectPointerDown(e, id);
  };

  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit,
    escapeHandler: () => {
      if (marqueeRef.current.rect) {
        marqueeRef.current.cancel();
        return true;
      }
      return false;
    },
  });

  const handleDelete = () => {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selection.clear();
  };

  const handleColor = (color: StickyColor) => {
    for (const id of selection.ids) {
      setStickyColor(doc, id, color);
    }
  };

  const selectedObjs = notes.filter((o) => selection.ids.has(o.id));
  const box = unionRects(selectedObjs.map(objectBounds));
  let barPos: { left: number; top: number } | null = null;
  if (box) {
    const p = worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });
    barPos = { left: p.x, top: p.y - 8 };
  }

  const handleAddNote = () => {
    const id = createSticky(doc, {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2,
    });
    if (id) selection.startEdit(id);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: viewportSize.width,
        height: viewportSize.height,
        overflow: 'hidden',
      }}
    >
      <BoardViewport
        camera={camera}
        beginPan={beginPan ?? (() => undefined)}
        panMove={panMove ?? (() => undefined)}
        endPan={endPan ?? (() => undefined)}
        wheel={wheel ?? (() => undefined)}
        onClearSelection={selection.clear}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {notes.map((o) => {
          const spec = getObjectType(o.type);
          if (!spec) return null;
          const C = spec.Component;
          return (
            <C
              key={o.id}
              obj={o}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(o.id)}
              editing={selection.editingId === o.id}
              onPointerDown={handleObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={(next) => {
                selection.endEdit();
                if (next === 'unselected') selection.clear();
              }}
            />
          );
        })}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      {barPos && (
        <div
          style={{
            position: 'absolute',
            left: barPos.left,
            top: barPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 100,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={handleDelete}
            onColor={handleColor}
          />
        </div>
      )}
      <Toolbar onCreateSticky={handleAddNote} />
      {onDocReady && <DocReadyProbe doc={doc} onDocReady={onDocReady} />}
    </div>
  );
}

function DocReadyProbe({
  doc,
  onDocReady,
}: {
  doc: Y.Doc;
  onDocReady: (doc: Y.Doc) => void;
}): null {
  useEffect(() => {
    onDocReady(doc);
  }, [doc, onDocReady]);
  return null;
}
