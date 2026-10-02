import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar, SelectionAnnouncement } from '../../../src/client/board/SelectionBar';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { createSticky, deleteObjects, objectsInRect } from '../../../src/shared/board-model';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';
import type { Rect } from '../../../src/shared/geometry';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  getSelectedIds(): ReadonlySet<string>;
  /** Backward compat: returns first selected id or null */
  getSelectedId(): string | null;
  getEditingId(): string | null;
  selection: ReturnType<typeof useSelection>;
}

/** True when the key press belongs to a text field rather than to the board. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface BoardHarnessProps {
  handleRef: React.MutableRefObject<HarnessHandle | null>;
  viewport?: Size;
  /** When true, editing (create / drag / colour / delete / text) is disabled. */
  readOnly?: boolean;
}

/**
 * The board wiring (document, selection, viewport, toolbar, notes) with the
 * handles a component test needs. Mirrors App.tsx.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);
  const { editingId, startEdit, endEdit } = selection;

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !readOnly,
  });

  // Marquee
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const getObjectsInRectFn = useCallback((rect: Rect): string[] => {
    return objectsInRect(notesRef.current, rect);
  }, []);
  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  }, getObjectsInRectFn);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

  const handleMarqueeBegin = useCallback((p: { x: number; y: number }) => {
    marquee.begin(p);
  }, [marquee]);
  const handleMarqueeMove = useCallback((p: { x: number; y: number }) => {
    marquee.move(p);
    setMarqueeRect(marquee.getRect());
  }, [marquee]);
  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
    setMarqueeRect(null);
  }, [marquee]);
  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
    setMarqueeRect(null);
  }, [marquee]);

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: !readOnly,
  });

  const live = useRef({ camera, selection });
  live.current = { camera, selection };

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedIds: () => live.current.selection.ids,
      getSelectedId: () => {
        const ids = live.current.selection.ids;
        if (ids.size === 0) return null;
        return Array.from(ids)[0];
      },
      getEditingId: () => live.current.selection.editingId,
      selection: selection,
    };
  }

  // Enter edits the selected sticky (single selection)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId) return;
      if (selection.ids.size !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = Array.from(selection.ids)[0];
        startEdit(id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection.ids, editingId, startEdit, readOnly]);

  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      const id = createSticky(doc, screenToWorld(camera, point));
      if (id) startEdit(id);
    },
    [camera, doc, startEdit, readOnly],
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
    const ids = Array.from(selection.ids);
    if (ids.length > 0) {
      deleteObjects(doc, ids);
      selection.clear();
    }
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
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === editingId}
            onSelect={selection.click}
            onStartEdit={startEdit}
            onEndEdit={(next) => endEdit(next)}
            editable={!readOnly}
            onObjectPointerDown={gesture.onObjectPointerDown}
            dragging={gesture.isDragging && selection.ids.has(note.id)}
          />
        ))}
      </BoardViewport>
      {/* Marquee rect in screen space */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1002 }}>
        <MarqueeRect rect={marqueeRect} camera={camera} />
      </div>
      {/* Selection overlay */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {/* Selection bar */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000 }}>
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          camera={camera}
          onDelete={handleDeleteSelection}
        />
      </div>
      <SelectionAnnouncement count={selection.ids.size} />
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
