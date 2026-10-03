import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from './canvas/camera';
import { useCamera, type WheelInput } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { IS_TEST_MODE, publishConnectionState } from './canvas/testHooks';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { StickyNote } from './objects/StickyNote';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '../shared/board-model';

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

/**
 * The board route: `/b/<boardId>`. Everything else (including an id that is not
 * 22 base64url characters) means "no board in the URL yet".
 */
const BOARD_ROUTE = /^\/b\/([^/]+)\/?$/;

function boardIdFromLocation(): string | null {
  const match = BOARD_ROUTE.exec(window.location.pathname);
  if (!match) return null;
  return isValidBoardId(match[1] as string) ? (match[1] as string) : null;
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

export default function App() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(surfaceRef);
  const cam = useCamera(viewport);
  const { camera } = cam;
  // The board comes from the URL, so opening a shared link joins that room. A
  // bare `/` mints a fresh board id and puts it in the URL, which makes the
  // board shareable straight away (story 5 replaces this with a board list).
  const [boardId] = useState<string>(() => boardIdFromLocation() ?? newBoardId());
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  // Render notes in a DOM order that never changes (stable by id) and express
  // stacking purely through CSS z-index (note.z). If the DOM order followed z,
  // bringing a note to front would relocate its node and drop the in-flight
  // pointer capture mid-drag (see TC-39).
  const orderedNotes = useMemo(
    () => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );

  // Keep the URL equal to the board we are on, so the address bar holds a link
  // to this exact room. Done in an effect (not during render) because React may
  // invoke the initialiser twice in development.
  useEffect(() => {
    const path = `/b/${boardId}`;
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, [boardId]);

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
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera, doc, startEdit],
  );

  /** Toolbar button: create a note at the centre of the visible board area. */
  const createAtCentre = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    createAtScreen(centre);
  }, [viewport.width, viewport.height, createAtScreen]);

  const onColor = useCallback(
    (color: string) => {
      if (selectedId) setStickyColor(doc, selectedId, color);
    },
    [doc, selectedId],
  );

  const onDelete = useCallback(() => {
    if (!selectedId) return;
    deleteObject(doc, selectedId);
    select(null);
  }, [doc, selectedId, select]);

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
  }, [editingId, selectedId, doc, startEdit, select]);

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
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCentre} />
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
