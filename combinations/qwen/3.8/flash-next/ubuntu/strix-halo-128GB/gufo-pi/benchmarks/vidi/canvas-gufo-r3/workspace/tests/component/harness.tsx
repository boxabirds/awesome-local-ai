import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Camera, Point, Size, screenToWorld } from '@client/canvas/camera';
import { useCamera, UseCameraResult } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { useBoardDoc } from '@client/board/useBoardDoc';
import { useSelection, SelectionApi } from '@client/board/useSelection';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { SelectionOverlay } from '@client/board/SelectionOverlay';
import { SelectionBar } from '@client/board/SelectionBar';
import { useTransformGesture } from '@client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '@client/board/Marquee';
import { createSticky, deleteObject, deleteObjects, getStickyText, StickySnapshot, moveObjects } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import { act } from '@testing-library/react';

// Register sticky type
import { registerStickyType } from '@client/objects/registry';
registerStickyType(StickyNote);

export const VIEWPORT: Size = { width: 1280, height: 800 };

export interface HarnessApi {
  doc: Y.Doc;
  selection: SelectionApi;
  camera: Camera;
  cameraState: UseCameraResult;
  notes: readonly StickySnapshot[];
}

export interface HarnessHandle {
  current: HarnessApi | null;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** Mirrors src/client/Board.tsx wiring so component tests exercise the real handlers. */
export function TestBoard({
  handle,
  initialNotes = [],
}: {
  handle: HarnessHandle;
  initialNotes?: { x: number; y: number; text?: string; color?: 'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet' }[];
}) {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  const cameraState = useCamera(VIEWPORT);
  const { camera } = cameraState;

  const seededRef = useRef(false);
  if (!seededRef.current) {
    seededRef.current = true;
    for (const n of initialNotes) {
      const id = createSticky(doc, { x: n.x, y: n.y }, n.color);
      if (n.text) {
        const yt = getStickyText(doc, id);
        if (yt) yt.insert(0, n.text);
      }
    }
  }

  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  handle.current = { doc, selection, camera, cameraState, notes };

  // Transform gesture
  const transform = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: true,
  });

  // Marquee
  const marquee = useMarquee(camera, notes, useCallback((ids: string[]) => {
    selection.setMany(ids, true);
  }, [selection.setMany]));

  // Keyboard commands
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sel = selection;
      const editing = sel.editingId !== null;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !editing) {
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        sel.setMany(notes.map((n) => n.id), false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape' && !editing) {
        sel.clear();
        return;
      }

      // Arrow keys: nudge
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowUp') dy = -step;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of notes) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete/Backspace
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        e.preventDefault();
        deleteObjects(doc, [...sel.ids]);
        sel.clear();
        return;
      }

      // Enter: edit single sticky
      if (
        e.key === 'Enter' &&
        !editing &&
        !isTextInputTarget(e.target) &&
        sel.ids.size === 1 &&
        !e.ctrlKey && !e.metaKey
      ) {
        e.preventDefault();
        const id = [...sel.ids][0];
        const obj = notes.find((o) => o.id === id);
        if (obj && obj.type === 'sticky') {
          sel.startEdit(id);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, notes, selection]);

  // Delete selection callback
  const handleDeleteSelection = useCallback(() => {
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection.ids, selection.clear]);

  const createAtWorldCentre = useCallback(() => {
    const world = screenToWorld(cameraRef.current, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    const id = createSticky(doc, world);
    if (id) selection.startEdit(id);
  }, [doc, selection.startEdit]);

  const handleDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      const world = screenToWorld(cameraRef.current, screenPoint);
      const id = createSticky(doc, world);
      if (id) selection.startEdit(id);
    },
    [doc, selection.startEdit],
  );

  const showHandles = selection.ids.size > 0;
  const renderOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <div style={{ width: VIEWPORT.width, height: VIEWPORT.height }}>
      <BoardViewport
        camera={camera}
        beginPan={cameraState.beginPan}
        panMove={cameraState.panMove}
        endPan={cameraState.endPan}
        wheel={cameraState.wheel}
        gestureZoom={cameraState.gestureZoom}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onClickEmpty={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {renderOrder.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            dragging={transform.draggingId === note.id}
            onSelect={selection.click}
            onToggle={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onObjectPointerDown={transform.onObjectPointerDown}
          />
        ))}
        <MarqueeRect rect={marquee.rect} camera={camera} />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        showHandles={showHandles}
        onHandlePointerDown={transform.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={handleDeleteSelection}
      />
      <Toolbar onCreateSticky={createAtWorldCentre} />
    </div>
  );
}

export function flushFrames(times = 3): Promise<void> {
  return new Promise((resolve) => {
    let n = 0;
    const step = () => {
      n++;
      if (n >= times) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Adds a sticky note to the harness document (centre at world cx, cy). */
export function addNote(
  handle: HarnessHandle,
  cx: number,
  cy: number,
  opts: { text?: string; color?: 'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet' } = {},
): string {
  const doc = handle.current!.doc;
  let id = '';
  act(() => {
    id = createSticky(doc, { x: cx, y: cy }, opts.color);
    if (opts.text) {
      const yt = getStickyText(doc, id);
      if (yt) yt.insert(0, opts.text);
    }
  });
  return id;
}

export function useHarnessHandle(): HarnessHandle {
  const ref = useRef<HarnessApi | null>(null);
  return ref;
}
