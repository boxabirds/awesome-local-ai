import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import type { Camera, Point, Size } from '../../../src/client/canvas/camera';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../../src/client/board/undo';
import { useUndo } from '../../../src/client/board/useUndo';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { setTextSize } from '../../../src/shared/objects/text';
import { getObjectType } from '../../../src/client/objects/registry';
import {
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from '../../../src/shared/config';

export interface TestBoardProps {
  camera: Camera;
  viewportSize: Size;
  onDocReady?: (doc: Y.Doc) => void;
  beginPan?: (p: Point) => void;
  panMove?: (p: Point) => void;
  endPan?: () => void;
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  /** When false, gestures/edits are disabled (read-only board). Default: true. */
  canEdit?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Story 8: receives the board's per-client undo controller. */
  onUndoReady?: (undo: UndoController) => void;
}

/**
 * Component-test harness for the board: a real Y.Doc (no network), a fixed
 * camera, and the full story-7 wiring — selection (Set), type-registry
 * rendering, group gestures, marquee, keyboard shortcuts, selection bar and
 * overlay. Used by the story-2 sticky tests and the story-7 multi-selection
 * tests.
 */
export function TestBoard({
  camera,
  viewportSize,
  onDocReady,
  beginPan = () => undefined,
  panMove = () => undefined,
  endPan = () => undefined,
  wheel = () => undefined,
  canEdit = true,
  onGestureStart,
  onGestureEnd,
  onUndoReady,
}: TestBoardProps) {
  const { doc, notes } = useBoardDoc();
  const viewportElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onDocReady?.(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Story 8: the per-client undo history, exposed to tests via onUndoReady.
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undo = undoRef.current;
  useEffect(() => {
    onUndoReady?.(undo);
    return () => {
      undo.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, undo]);
  const undoControls = useUndo(undo, canEdit);

  const selection = useSelection(notes);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit,
    captureRoot: () => viewportElRef.current,
    // Story 8: a gesture is one undo step — boundaries bracket it.
    onGestureStart: () => {
      onGestureStart?.();
      undo.boundary();
    },
    onGestureEnd: () => {
      onGestureEnd?.();
      undo.boundary();
    },
  });
  const marquee = useMarquee(camera, notes, (ids, additive) =>
    selection.setMany(ids, additive),
  );
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit,
    marqueeActive: () => marquee.rect !== null,
    undo,
  });

  // Escape cancels an in-progress marquee.
  useEffect(() => {
    if (marquee.rect === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        marquee.cancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [marquee.rect, marquee.cancel]);

  const handleDeleteSelection = () => {
    if (!canEdit || selection.ids.size === 0) return;
    // Story 8: the whole deletion is one undo step.
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    undo.boundary();
  };

  const handleColor = (id: string, color: StickyColor) => {
    if (!canEdit) return;
    // Story 8: a colour change is one undo step.
    undo.boundary();
    setStickyColor(doc, id, color);
    undo.boundary();
  };

  const handleTextSize = (id: string, size: string) => {
    if (!canEdit) return;
    undo.boundary();
    setTextSize(doc, id, size);
    undo.boundary();
  };

  // Selection bar above the selection bbox (screen space), like BoardPage.
  const selectedNotes = notes.filter((n) => selection.ids.has(n.id));
  let selectionBarPos: { left: number; top: number } | null = null;
  if (selectedNotes.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (const o of selectedNotes) {
      const b = objectBounds(o);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
    }
    const c = worldToScreen(camera, { x: (minX + maxX) / 2, y: minY });
    // Same viewport clamping as BoardPage so the bar never renders off-screen.
    const halfW = 120;
    const left = Math.min(Math.max(c.x, halfW), Math.max(viewportSize.width - halfW, halfW));
    const top = Math.max(c.y - 8, 44 + 2);
    selectionBarPos = { left, top };
  }

  return (
    <div
      data-testid="test-board"
      style={{ position: 'relative', width: viewportSize.width, height: viewportSize.height }}
    >
      <BoardViewport
        camera={camera}
        beginPan={beginPan}
        panMove={panMove}
        endPan={endPan}
        wheel={wheel}
        onCreateStickyAt={(p) => {
          if (!canEdit) return;
          // Story 8: note creation is one undo step.
          undo.boundary();
          createSticky(doc, screenToWorld(camera, p), DEFAULT_STICKY_COLOR);
          undo.boundary();
        }}
        onClearSelection={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
        onViewportEl={(el) => {
          viewportElRef.current = el;
        }}
      >
        {notes.map((n) => {
          const spec = getObjectType(n.type);
          if (!spec) return null;
          const C = spec.Component;
          return (
            <C
              key={n.id}
              obj={n as ObjectSnapshot}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(n.id)}
              editing={selection.editingId === n.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={(id) => {
                if (canEdit) selection.startEdit(id);
              }}
              onEndEdit={(next) => {
                selection.endEdit();
                if (next === 'unselected') selection.clear();
              }}
              undo={undo}
            />
          );
        })}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>
      {selectionBarPos && (
        <div
          data-testid="selection-bar-host"
          style={{
            position: 'absolute',
            left: selectionBarPos.left,
            top: selectionBarPos.top,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={handleDeleteSelection}
            onColor={handleColor}
            onTextSize={handleTextSize}
          />
        </div>
      )}
      <Toolbar
        onCreateSticky={() => {
          if (!canEdit) return;
          // Story 8: note creation is one undo step.
          undo.boundary();
          const id = createSticky(doc, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, DEFAULT_STICKY_COLOR);
          undo.boundary();
          if (id) selection.startEdit(id);
        }}
        disabled={!canEdit}
        undo={undoControls}
      />
    </div>
  );
}

export type { StickySnapshot };
