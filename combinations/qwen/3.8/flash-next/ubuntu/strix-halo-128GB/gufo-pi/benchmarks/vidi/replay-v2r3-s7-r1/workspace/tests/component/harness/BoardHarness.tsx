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
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { createSticky, deleteObjects } from '../../../src/shared/board-model';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';
import type { UseSelectionResult } from '../../../src/client/board/useSelection';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  getSelection(): UseSelectionResult;
  /** Returns the single selected id or null (backward compat). */
  getSelectedId(): string | null;
  getEditingId(): string | null;
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
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);

  const transform = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !readOnly,
  });

  const marquee = useMarquee(camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

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
      getSelection: () => live.current.selection,
      getSelectedId: () => {
        const ids = live.current.selection.ids;
        return ids.size === 1 ? [...ids][0] : null;
      },
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

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleDeleteSelection = useCallback(() => {
    if (readOnly) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, readOnly]);

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      selection.endEdit();
      if (next === 'unselected') selection.clear();
    },
    [selection],
  );

  // Enter edits single selected sticky
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = [...selection.ids][0];
        const obj = notes.find((n) => n.id === id);
        if (obj?.type === 'sticky') {
          selection.startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, readOnly, notes]);

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
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onStartEdit={selection.startEdit}
            onEndEdit={handleEndEdit}
            editable={!readOnly}
            onPointerDown={transform.onObjectPointerDown}
          />
        ))}
      </BoardViewport>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={transform.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
      />
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
