import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Camera, Point, Size, screenToWorld } from '@client/canvas/camera';
import { useCamera, UseCameraResult } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { useBoardDoc } from '@client/board/useBoardDoc';
import { useSelection, SelectionApi } from '@client/board/useSelection';
import { Toolbar } from '@client/board/Toolbar';
import { StickyNote } from '@client/objects/StickyNote';
import { createSticky, deleteObject, getStickyText, StickySnapshot } from '@shared/board-model';
import { act } from '@testing-library/react';

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

/** Mirrors src/client/App.tsx wiring so component tests exercise the real handlers. */
export function TestBoard({
  handle,
  initialNotes = [],
}: {
  handle: HarnessHandle;
  initialNotes?: { x: number; y: number; text?: string; color?: 'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet' }[];
}) {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;
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

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const cameraRef = useRef<Camera>(camera);
  cameraRef.current = camera;

  handle.current = { doc, selection, camera, cameraState, notes };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { selectedId: sel, editingId: ed } = selectionRef.current;
      if (e.key === 'Enter') {
        if (ed !== null || sel === null) return;
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        startEdit(sel);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ed !== null || sel === null) return;
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        deleteObject(doc, sel);
        select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, startEdit, select]);

  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  const createAtWorldCentre = useCallback(() => {
    const world = screenToWorld(cameraRef.current, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    const id = createSticky(doc, world);
    if (id) startEdit(id);
  }, [doc, startEdit]);

  const handleDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      const world = screenToWorld(cameraRef.current, screenPoint);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Mirror App.tsx: stable DOM order by id, stacking via CSS z-index.
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
        onClickEmpty={() => select(null)}
      >
        {renderOrder.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
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
