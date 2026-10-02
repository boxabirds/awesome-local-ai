import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { createSticky, deleteObjects } from '../../../src/shared/board-model';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  getSelectedIds(): ReadonlySet<string>;
  getSelectedId(): string | null;
  getEditingId(): string | null;
  getSelection(): ReturnType<typeof useSelection>;
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
 * Board harness for component tests with stories 2 + 7 wiring.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !readOnly,
  });
  const draggingIds = gesture.dragging ? selection.ids : new Set<string>();

  // Marquee selection
  const marqueeSelect = useCallback((ids: string[]) => {
    selection.setMany(ids, true);
  }, [selection]);
  const marquee = useMarquee(camera, notes, marqueeSelect);

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
        return ids.size === 1 ? [...ids][0] : null;
      },
      getEditingId: () => live.current.selection.editingId,
      getSelection: () => live.current.selection,
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
    const ids = [...selection.ids];
    deleteObjects(doc, ids);
    selection.clear();
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
            onSelect={selection.click}
            onStartEdit={selection.startEdit}
            onEndEdit={(next) => { selection.endEdit(); if (next === 'unselected') selection.clear(); }}
            editable={!readOnly}
            onObjectPointerDown={gesture.onObjectPointerDown}
            dragging={draggingIds.has(note.id)}
          />
        ))}
        <MarqueeRect rect={marquee.rect} camera={camera} />
        {selection.ids.size > 0 && !gesture.dragging && (
          <SelectionOverlay
            ids={selection.ids}
            snapshot={notes}
            camera={camera}
            onHandlePointerDown={gesture.onHandlePointerDown}
          />
        )}
      </BoardViewport>
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        onDelete={handleDeleteSelection}
      />
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
