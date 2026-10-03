// The stories 1-4 board: an infinite canvas of sticky notes, live-connected to the
// room behind this board's link. Story 5 moved it out of App so the board page can
// mount it *only* once the link has been answered "this board exists" — a bad link
// never opens a socket (share.not_found).
//
// Editing is locked only while the board could not be loaded (`load_failed`): there
// is no real board on screen in that state, so every mutation handler becomes a
// no-op and the Sticky note button is disabled rather than editing an empty board
// that would overwrite a real one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { useCamera, type WheelInput } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit } from '../sync/connectBoard';
import { IS_TEST_MODE, publishConnectionState } from '../canvas/testHooks';
import { StickyNote } from '../objects/StickyNote';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '../../shared/board-model';

/** Viewport size measured from the live board element via a ResizeObserver. */
function useViewportSize(
  ref: React.RefObject<HTMLDivElement | null>,
): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/** True when focus is in a text field, so board keys must not steal the event. */
function focusIsEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    el.getAttribute('contenteditable') === 'true'
  );
}

export interface BoardProps {
  /** Which board to connect to — the id from the address bar. */
  boardId: string;
}

export function Board({ boardId }: BoardProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(surfaceRef);
  const cam = useCamera(viewport);
  const { camera } = cam;
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  // Editing is locked only while the board could not be loaded (`load_failed`).
  // In that state there is no real board on screen — the room could not read it —
  // so every mutation handler below becomes a no-op and the Sticky note button is
  // disabled, rather than editing an empty board that would overwrite a real one.
  const editAllowed = canEdit(connectionState);

  // Render notes in a DOM order that never changes (stable by id) and express
  // stacking purely through CSS z-index (note.z). If the DOM order followed z,
  // bringing a note to front would relocate its node and drop the in-flight
  // pointer capture mid-drag (see TC-39).
  const orderedNotes = useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );

  // Let e2e assert the badge state itself, not just what is on screen.
  useEffect(() => publishConnectionState(connectionState), [connectionState]);

  // Expose the board document to component tests so they can simulate model-level
  // events (e.g. a note deleted by a remote user mid-drag). No-op in production.
  useEffect(() => {
    if (!IS_TEST_MODE) return;
    (window as unknown as { __vidi6Board?: Y.Doc }).__vidi6Board = doc;
  }, [doc]);

  // Bind the hook's intents so BoardViewport's effects that depend on them do
  // not re-subscribe on every render (the handler identities are stable).
  const onWheelInput = useCallback((e: WheelInput) => cam.wheel(e), [cam.wheel]);
  const onBeginPan = useCallback((p: Point) => cam.beginPan(p), [cam.beginPan]);
  const onPanMove = useCallback((p: Point) => cam.panMove(p), [cam.panMove]);
  const onEndPan = useCallback(() => cam.endPan(), [cam.endPan]);
  const onZoomStep = useCallback((d: 'in' | 'out') => cam.zoomStep(d), [cam.zoomStep]);
  const onReset = useCallback(() => cam.reset(), [cam.reset]);

  /** Create a note centred on a screen point and start editing it. */
  const createAtScreen = useCallback(
    (p: Point) => {
      if (!editAllowed) return;
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera, doc, startEdit, editAllowed],
  );

  /** Toolbar button: create a note at the centre of the visible board area. */
  const createAtCentre = useCallback(() => {
    if (!editAllowed) return;
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(centre);
  }, [viewport.width, viewport.height, createAtScreen, editAllowed]);

  const onColor = useCallback(
    (color: string) => {
      if (!editAllowed) return;
      if (selectedId) setStickyColor(doc, selectedId, color);
    },
    [doc, selectedId, editAllowed],
  );

  const onDelete = useCallback(() => {
    if (!editAllowed) return;
    if (!selectedId) return;
    deleteObject(doc, selectedId);
    select(null);
  }, [doc, selectedId, select, editAllowed]);

  // Clear stale selection / editing when a note disappears (e.g. deleted).
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);
  useEffect(() => {
    if (editingId && !notes.some((n) => n.id === editingId)) endEdit('unselected');
  }, [notes, editingId, endEdit]);

  // Board-level keyboard shortcuts (Enter to edit, Delete/Backspace to remove).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editAllowed) return; // an unloadable board is not editable
      if (editingId !== null) return; // text editing owns the keys
      if (focusIsEditable()) return;
      if (!selectedId) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, selectedId, doc, startEdit, select, editAllowed]);

  return (
    <div className="vidi6-app">
      <BoardViewport
        ref={surfaceRef}
        camera={camera}
        onWheelInput={onWheelInput}
        onBeginPan={onBeginPan}
        onPanMove={onPanMove}
        onEndPan={onEndPan}
        onZoomStep={onZoomStep}
        onReset={onReset}
        onCreateStickyAt={createAtScreen}
        onEmptyClick={() => select(null)}
      >
        {orderedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onColor={onColor}
            onDelete={onDelete}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            canEdit={editAllowed}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCentre} disabled={!editAllowed} />
      <ConnectionStatus state={connectionState} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
