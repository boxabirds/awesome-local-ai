import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point } from './canvas/camera';
import { screenToWorld, worldToScreen } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from './canvas/camera';
import { CameraProvider, useCameraApi } from './canvas/useCamera';
import { BoardDocProvider, useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { canEdit, ConnectionStatus } from './sync/ConnectionStatus';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { getObjectType } from './objects/registry';
import { createSticky, deleteObject, deleteObjects, setStickyColor } from '../shared/board-model';
import { SharePanel } from './share/SharePanel';

/** Fixed overlays that read the board camera: zoom control and first-use hint. */
export function BoardOverlays() {
  const { camera, hasNavigated, zoomStep, reset } = useCameraApi();

  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

/** The connection badge, reading the state the board's provider reports. */
export function ConnectionBadge() {
  const { connection } = useBoardDoc();
  return <ConnectionStatus state={connection} />;
}

/**
 * The main board content: objects, viewport, toolbar, selection and keyboard
 * handlers. All sharing one doc and one selection state.
 */
function BoardContent() {
  const { doc, notes, connection } = useBoardDoc();
  const selection = useSelection(notes);
  const { camera } = useCameraApi();

  const editable = canEdit(connection);
  const { ids, editingId, click, toggle, setMany, clear, startEdit, endEdit } = selection;

  useEffect(() => {
    if (!editable && editingId !== null) endEdit();
  }, [editable, editingId, endEdit]);

  const draggingRef = useRef(false);
  const gesture = useTransformGesture({
    doc,
    camera,
    snapshot: notes,
    selection: ids,
    canEdit: editable,
    onClickObject: click,
    onToggleObject: toggle,
    onGestureStart: () => {
      draggingRef.current = true;
    },
    onGestureEnd: () => {
      draggingRef.current = false;
    },
  });

  const marquee = useMarquee(camera, notes, useCallback(
    // A marquee always starts from a Shift+drag, so it adds to whatever is
    // already selected (design TC-20) rather than replacing it.
    (selected: readonly string[]) => setMany(selected, true),
    [setMany],
  ));

  useBoardKeys({ doc, snapshot: notes, selection: { ids, setMany, clear }, editingId, canEdit: editable });

  const handleDblClickEmpty = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      const id = createSticky(doc, worldPoint);
      startEdit(id);
    },
    [doc, startEdit, editable],
  );

  const handleEmptyClick = useCallback(() => {
    clear();
  }, [clear]);

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const viewportEl = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    const screenCenter: Point = { x: rect.width / 2, y: rect.height / 2 };
    const worldCenter = screenToWorld(camera, screenCenter);
    const id = createSticky(doc, worldCenter);
    startEdit(id);
  }, [doc, camera, startEdit, editable]);

  const handleColorChange = useCallback(
    (id: string, color: string) => {
      if (!editable) return;
      setStickyColor(doc, id, color);
    },
    [doc, editable],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!editable) return;
      deleteObject(doc, id);
      clear();
    },
    [doc, clear, editable],
  );

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    deleteObjects(doc, Array.from(ids));
    clear();
  }, [doc, ids, clear, editable]);

  // Story 2's Enter-to-edit for a single selected, editable-text object.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!editable || editingId !== null) return;
      if (event.key !== 'Enter' || ids.size !== 1) return;
      const only = Array.from(ids)[0];
      const obj = only === undefined ? undefined : notes.find((n) => n.id === only);
      const spec = obj === undefined ? undefined : getObjectType(obj.type);
      if (spec?.editableText) {
        event.preventDefault();
        startEdit(only!);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editable, editingId, ids, notes, startEdit]);

  // Stable render order (by id), independent of z-order.
  const renderedNotes = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)), [notes]);

  const singleId = ids.size === 1 ? Array.from(ids)[0] : undefined;
  const selectedNote =
    singleId !== undefined && editingId === null
      ? notes.find((n) => n.id === singleId && n.type === 'sticky')
      : undefined;
  const overlayVisible = ids.size > 0 && !gesture.isDragging;

  return (
    <>
      <Toolbar onCreateSticky={handleCreateSticky} editable={editable} />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
        marqueeController={marquee.controller}
      >
        {renderedNotes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={camera.zoom}
              selected={ids.has(note.id)}
              editing={editingId === note.id}
              editable={editable}
              onStartEdit={startEdit}
              onEndEdit={(next) => {
                if (next === 'unselected') clear();
                else endEdit();
              }}
              onObjectPointerDown={gesture.onObjectPointerDown}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      {overlayVisible && (
        <SelectionOverlay
          snapshot={notes}
          ids={ids}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}

      {overlayVisible && (
        <SelectionBar snapshot={notes} ids={ids} camera={camera} onDelete={handleDeleteSelection} />
      )}

      {selectedNote !== undefined && (
        <NoteToolbarOverlay
          note={selectedNote}
          camera={camera}
          onColor={handleColorChange}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

/** Screen-space toolbar above a single selected sticky note. */
function NoteToolbarOverlay({ note, camera, onColor, onDelete }: {
  note: { id: string; x: number; y: number; color: import('../shared/config').StickyColor };
  camera: { x: number; y: number; zoom: number };
  onColor(id: string, color: string): void;
  onDelete(id: string): void;
}) {
  const screenPos = worldToScreen(camera, { x: note.x, y: note.y });
  return (
    <div
      className="note-toolbar-screen"
      style={{ left: screenPos.x, top: screenPos.y - 36 }}
    >
      <NoteToolbar
        color={note.color}
        onColor={(c) => onColor(note.id, c)}
        onDelete={() => onDelete(note.id)}
      />
    </div>
  );
}

/** The full board application, exportable with an optional doc for testing. */
export function BoardApp({ doc, boardId }: { doc?: Y.Doc; boardId?: string } = {}): JSX.Element {
  return (
    <CameraProvider>
      <BoardDocProvider doc={doc} boardId={boardId}>
        <BoardContent />
        <BoardOverlays />
        <ConnectionBadge />
        {boardId && <SharePanel boardId={boardId} />}
      </BoardDocProvider>
    </CameraProvider>
  );
}
