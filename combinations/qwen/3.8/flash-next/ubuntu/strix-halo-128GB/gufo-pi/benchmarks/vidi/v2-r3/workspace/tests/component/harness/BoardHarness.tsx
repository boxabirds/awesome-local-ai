import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { createSticky, deleteObject } from '../../../src/shared/board-model';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
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
 * The story 2 wiring (document, selection, viewport, toolbar, notes) with the
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const live = useRef({ camera, selectedId, editingId });
  live.current = { camera, selectedId, editingId };

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedId: () => live.current.selectedId,
      getEditingId: () => live.current.editingId,
    };
  }

  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingId || !selectedId || isTextEntry(e.target)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, editingId, doc, startEdit, select, readOnly]);

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

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={() => select(null)}
        onEmptyDblClick={handleEmptyDblClick}
      >
        {notes.map((note) => (
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
            editable={!readOnly}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} />
    </>
  );
}
