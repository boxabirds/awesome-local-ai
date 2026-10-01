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
} from '../../../src/shared/board-model';
import { createText, setTextSize } from '../../../src/shared/objects/text';
import { createCanvasMeasurer, remeasureTextObject } from '../../../src/client/objects/textLayout';
import { getObjectType, objectAtPoint } from '../../../src/client/objects/registry';
import { useActiveTool } from '../../../src/client/tools/useActiveTool';
import { PenTool } from '../../../src/client/tools/PenTool';
import { PenToolbar } from '../../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../../src/client/tools/usePenOptions';
import {
  DEFAULT_STICKY_COLOR,
  TEXT_FONT_FAMILY,
  type StickyColor,
  type TextSize,
} from '../../../src/shared/config';
import { useTool, type Tool } from '../../../src/client/board/useTool';

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
  const { doc, objects: notes } = useBoardDoc();
  const toolState = useTool(canEdit);
  // Story 10/11: extended active tool (shape/connector/pen) + pen options.
  const activeTool = useActiveTool({
    canEdit,
    select: (id: string) => selection.click(id),
  });
  const penOptions = usePenOptions();
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const measurerRef = useRef<ReturnType<typeof createCanvasMeasurer> | null>(null);
  if (measurerRef.current === null) measurerRef.current = createCanvasMeasurer(TEXT_FONT_FAMILY);

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

  // Story 9: text creation (Text tool click / object click while Text active).
  const createTextAtScreen = (screenPoint: Point) => {
    if (!canEdit) return;
    const world = screenToWorld(camera, screenPoint);
    undo.boundary();
    const id = createText(doc, world, 'test-client');
    undo.boundary();
    if (id) {
      // The Text tool hands back to Select after creating (PRD text.tool_ui).
      toolState.setTool('select');
      activeTool.setTool('select');
      selection.startEdit(id);
    }
  };

  const handleObjectPointerDown = (e: PointerEvent, id: string) => {
    if (toolState.tool === 'text' || activeTool.tool === 'text') {
      createTextAtScreen({ x: e.clientX, y: e.clientY });
      return;
    }
    // Story 10/11: shape/connector/pen tools own the gesture (overlay handles it).
    if (
      activeTool.tool === 'shape' ||
      activeTool.tool === 'connector' ||
      activeTool.tool === 'pen'
    ) {
      return;
    }
    gesture.onObjectPointerDown(e, id);
  };

  // Story 11 (pen.select fall-through): a pointerdown inside a stroke's bbox
  // that missed its line is routed to the topmost object underneath.
  const handleMissHit = (e: PointerEvent, world: Point) => {
    const below = objectAtPoint(notes, world, camera.zoom);
    if (below) {
      e.stopPropagation();
      gesture.onObjectPointerDown(e, below.id);
    }
  };

  const handleTextSize = (id: string, size: TextSize) => {
    if (!canEdit) return;
    undo.boundary();
    setTextSize(doc, id, size);
    remeasureTextObject(doc, id, measurerRef.current!);
    undo.boundary();
  };

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit,
    captureRoot: () => viewportElRef.current,
    measurer: measurerRef.current ?? undefined,
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
    tool: toolState.tool,
    setTool: toolState.setTool,
    onStickyShortcut: () => {
      if (!canEdit) return;
      undo.boundary();
      const id = createSticky(doc, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, DEFAULT_STICKY_COLOR);
      undo.boundary();
      if (id) selection.startEdit(id);
    },
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
        textToolActive={toolState.tool === 'text'}
        penToolActive={activeTool.tool === 'pen'}
        onTextCreateAt={createTextAtScreen}
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
              onObjectPointerDown={handleObjectPointerDown}
              onStartEdit={(id) => {
                if (canEdit) selection.startEdit(id);
              }}
              onEndEdit={(next) => {
                selection.endEdit();
                if (next === 'unselected') selection.clear();
              }}
              undo={undo}
              measurer={measurerRef.current ?? undefined}
              onMissHit={handleMissHit}
              camera={camera}
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
      {/* Story 11: Pen tool overlay + options toolbar */}
      {activeTool.tool === 'pen' && canEdit && (
        <PenTool
          camera={camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId="test-client"
          wheel={wheel}
          onCommitted={() => undo.boundary()}
        />
      )}
      {activeTool.tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <Toolbar
        tool={toolState.tool}
        setTool={toolState.setTool}
        activeTool={activeTool.tool}
        setActiveTool={activeTool.setTool}
        shapeKind={activeTool.shapeKind}
        setShapeKind={activeTool.setShapeKind}
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

export type { Tool };
