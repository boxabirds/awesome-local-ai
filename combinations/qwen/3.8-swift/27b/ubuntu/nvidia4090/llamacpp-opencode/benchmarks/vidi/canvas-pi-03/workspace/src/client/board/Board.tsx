/**
 * Story 1–4 board UI (extracted from App.tsx in story 5): viewport, camera,
 * notes, toolbars and connection badge. Story 5 mounts it from BoardPage once
 * the board's existence check succeeds; the `__vidi6` test hook (test build
 * only) stays here with the board.
 */
import { type JSX, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, worldToScreen, screenToWorld } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionOverlay, selectionBounds } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { Toolbar } from './Toolbar';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import { getObjectType } from '../objects/registry';
import { NoteToolbar } from '../objects/NoteToolbar';
import {
  createSticky,
  setStickyColor,
  deleteObject,
  deleteObjects,
  getStickyText,
  type StickySnapshot,
} from 'src/shared/board-model';

export function Board({ boardId }: { boardId: string }): JSX.Element {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cam = useCamera(size);
  const { doc, notes, objects, connectionState, dropSocket, resumeSocket } = useBoardDoc(boardId);
  const sel = useSelection(objects);
  // A load-failed board is read-only (persist.client_status): every board-model
  // mutation is a no-op and the create button is disabled.
  const editable = canEdit(connectionState);
  const [dragging, setDragging] = useState(false);
  const gestureStartsRef = useRef(0);
  const gestureEndsRef = useRef(0);

  // Story 8: ONE per-user undo controller per board doc (key decision 5).
  // BoardPage remounts Board per board id (key={route.id}) and a reload
  // starts a fresh tab, so history is session-only (undo.session_only).
  const undoController = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => {
    return () => {
      undoController.destroy();
    };
  }, [undoController]);
  const undoState = useUndo(undoController, editable);

  // Story 7: the generic transform gesture — group move (drag any selected
  // object), single-object drag, handle resize with aspect lock + size
  // limits. Works for every registered object type (sel.all_types).
  // Story 8: gesture start/end (including pointercancel) close undo capture
  // windows, so one drag is exactly one undo step (undo.boundaries).
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      gestureStartsRef.current += 1;
      undoController.boundary();
      setDragging(true);
    },
    onGestureEnd: () => {
      gestureEndsRef.current += 1;
      undoController.boundary();
      setDragging(false);
    },
  });

  // Story 7: Shift+drag marquee on empty space — selects everything inside,
  // unioned with the current selection (sel.marquee).
  const marquee = useMarquee(cam.camera, objects, (ids) => sel.setMany(ids, true));

  // Story 7: Ctrl+A / Escape / arrows / Delete / Enter (sel.keyboard).
  // Story 8: + Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y undo and redo.
  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit: editable, undo: undoController });

  // Test hook: story 1 exposes setCamera; story 2 additionally exposes the
  // board doc so tests can drive the model directly (e.g. TC-37).
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      // seedNotes creates `count` varied notes via the real board-model so the
      // Yjs updates flow through the normal sync → store path (deterministic
      // e2e seeding without 25× UI interactions).
      // `start` offsets both ids and grid positions so several calls never
      // collide (story 8 TC-23 seeds one note per undo step).
      const seedNotes = (count: number, start = 0): string[] => {
        const colors: Array<'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet'> = [
          'yellow',
          'orange',
          'green',
          'blue',
          'pink',
          'violet',
        ];
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const n = start + i;
          const id = createSticky(
            doc,
            { x: (n % 5) * 120, y: Math.floor(n / 5) * 120 },
            colors[n % colors.length],
            `seed-${n}`,
          );
          if (id) {
            getStickyText(doc, id)?.insert(0, `Note ${n}: the quick brown fox`);
            ids.push(id);
          }
        }
        return ids;
      };
      (window as unknown as Record<string, unknown>).__vidi6 = {
        setCamera: cam.setCamera,
        doc,
        connectionState,
        dropSocket,
        resumeSocket,
        seedNotes,
        // Story 7: gesture bookkeeping (undo boundaries, story 8) + toolbar hiding.
        gestureStarts: () => gestureStartsRef.current,
        gestureEnds: () => gestureEndsRef.current,
        dragging,
        // Story 8: the per-user undo controller (component/e2e tests).
        undo: undoController,
      };
    }
  }, [cam.setCamera, doc, connectionState, dropSocket, resumeSocket, dragging, undoController]);

  // Double-click on empty board space: create a note centred on the point,
  // select it and start editing (sticky.create_dblclick). No-op when locked.
  const handleCreateStickyAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) return;
      // Story 8: one note creation is exactly one undo step.
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) sel.startEdit(id);
    },
    [doc, sel, editable, undoController],
  );

  // Toolbar button: create a note at the centre of the visible board area
  // (sticky.create_button) — works no matter where the board is panned. No-op
  // when locked.
  const handleCreateStickyCentred = useCallback(() => {
    if (!editable) return;
    const centre = screenToWorld(cam.camera, {
      x: size.width / 2,
      y: size.height / 2,
    });
    // Story 8: one note creation is exactly one undo step.
    undoController.boundary();
    const id = createSticky(doc, centre);
    undoController.boundary();
    if (id) sel.startEdit(id);
  }, [cam.camera, size, doc, sel, editable, undoController]);

  // Story 7: a group delete removes every selected object at once and clears
  // the selection (sel.delete_multi). No-op when the board is locked.
  // Story 8: the whole group delete is exactly one undo step.
  const handleDeleteSelection = useCallback(() => {
    if (!editable || sel.ids.size === 0) return;
    undoController.boundary();
    deleteObjects(doc, [...sel.ids]);
    undoController.boundary();
    sel.clear();
  }, [doc, editable, sel, undoController]);

  // The single selected sticky note (for the story 2 note toolbar — shown
  // only when EXACTLY one object is selected; with 2+ the selection bar
  // appears instead, sel.multibar). Hidden while a gesture is in progress.
  // The single selected sticky note (from `notes`: full StickySnapshot with
  // color/text). Only sticky notes have the note toolbar; other types do not.
  const singleSticky: StickySnapshot | undefined =
    sel.ids.size === 1 ? notes.find((n) => sel.ids.has(n.id)) : undefined;
  const showNoteToolbar = singleSticky !== undefined && sel.editingId === null && !dragging;

  // Floating-bar placement: above the selection's bounding box (screen space).
  const selBox = sel.ids.size > 0 ? selectionBounds(sel.ids, objects) : null;
  let barStyle: React.CSSProperties | undefined;
  if (selBox) {
    const centre = worldToScreen(cam.camera, {
      x: selBox.x + selBox.width / 2,
      y: selBox.y,
    });
    barStyle = {
      position: 'fixed',
      left: centre.x,
      top: centre.y - 10,
      transform: 'translate(-50%, -100%)',
      zIndex: 1001,
    };
  }

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomStepIn={cam.zoomStepIn}
        zoomStepOut={cam.zoomStepOut}
        reset={cam.reset}
        setCamera={cam.setCamera}
        onCreateStickyAt={handleCreateStickyAt}
        onEmptyClick={() => sel.clear()}
        marquee={{
          active: marquee.rect !== null,
          begin: marquee.begin,
          move: marquee.move,
          end: marquee.end,
          cancel: marquee.cancel,
        }}
      >
        {/* Story 7: the marquee rectangle renders in the world layer. */}
        <MarqueeRect rect={marquee.rect} />
        {/* Render in stable id order, NOT z order: objects are stacked via
            `z-index` (which is deterministic from the model's z), and
            reordering the DOM on a z change would detach the node mid-drag,
            releasing its pointer capture and killing the drag. */}
        {[...objects]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((o) => {
            // Every type renders through the registry (sel.all_types): the
            // generic selection/move/resize machinery applies to all of them.
            const spec = getObjectType(o.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={o.id}
                obj={o}
                doc={doc}
                zoom={cam.camera.zoom}
                selected={sel.ids.has(o.id)}
                editing={sel.editingId === o.id}
                editable={editable}
                onPointerDown={gesture.onObjectPointerDown}
                onSelect={sel.click}
                onStartEdit={sel.startEdit}
                onEndEdit={sel.endEdit}
                undo={undoController}
              />
            );
          })}
      </BoardViewport>
      <Toolbar
        onCreateSticky={handleCreateStickyCentred}
        disabled={!editable}
        undo={undoState}
      />
      <SelectionOverlay
        ids={sel.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {showNoteToolbar && singleSticky && selBox && (
        <div style={barStyle}>
          <NoteToolbar
            color={singleSticky.color}
            editable={editable}
            onColor={(c) => {
              // Story 8: one colour change is exactly one undo step.
              undoController.boundary();
              setStickyColor(doc, singleSticky.id, c);
              undoController.boundary();
            }}
            onDelete={() => {
              // Story 8: one delete is exactly one undo step.
              undoController.boundary();
              if (deleteObject(doc, singleSticky.id)) sel.clear();
              undoController.boundary();
            }}
          />
        </div>
      )}
      {sel.ids.size >= 2 && barStyle && (
        <div style={barStyle}>
          <SelectionBar ids={sel.ids} disabled={!editable} onDelete={handleDeleteSelection} />
        </div>
      )}
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={cam.zoomStepIn}
        onZoomOut={cam.zoomStepOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated && notes.length === 0} />
    </>
  );
}
