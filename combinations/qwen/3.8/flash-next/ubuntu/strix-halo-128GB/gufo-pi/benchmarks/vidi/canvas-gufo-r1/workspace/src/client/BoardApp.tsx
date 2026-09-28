import { useCallback, useRef, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, worldToScreen, type Size } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { createSticky, deleteObjects, setStickyColor } from '../shared/board-model';
import type { StickyColor } from '../shared/config';

export function BoardApp({ boardId }: { boardId: string }) {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);

  const [camState, setCamState] = useState({ x: 0, y: 0, zoom: 1, vw: 0, vh: 0 });
  const camRef = useRef(camState);
  camRef.current = camState;

  const handleCameraChange = useCallback(
    (cam: { x: number; y: number; zoom: number }, vp: Size) => {
      setCamState({ x: cam.x, y: cam.y, zoom: cam.zoom, vw: vp.width, vh: vp.height });
    },
    [],
  );

  const handleCreateSticky = useCallback(() => {
    if (!editable) return;
    const cam = camRef.current;
    const centre = { x: cam.vw / 2, y: cam.vh / 2 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    selection.click(id);
    selection.startEdit(id);
  }, [doc, selection, editable]);

  const handleDblClickEmpty = useCallback(
    (worldPoint: { x: number; y: number }) => {
      if (!editable) return;
      const id = createSticky(doc, worldPoint);
      selection.click(id);
      selection.startEdit(id);
    },
    [doc, selection, editable],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Marquee
  const handleMarqueeSelect = useCallback((ids: string[]) => {
    selection.setMany(ids, true);
  }, [selection]);

  const marquee = useMarquee(camState, notes, handleMarqueeSelect);

  const handleMarqueeBegin = useCallback((screen: { x: number; y: number }) => {
    marquee.begin(screen);
  }, [marquee]);

  const handleMarqueeMove = useCallback((screen: { x: number; y: number }) => {
    marquee.move(screen);
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  // Transform gesture
  const gesture = useTransformGesture({
    doc,
    camera: camState,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Keyboard
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
  });

  // Enter to edit a single selected sticky
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selection.editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      const note = notes.find((n) => n.id === id);
      if (!note || note.type !== 'sticky') return;
      if (e.key === 'Enter') {
        if (!editable) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    },
    [selection, notes, editable],
  );

  const handleColor = useCallback(
    (color: StickyColor) => {
      if (selection.ids.size !== 1) return;
      if (!editable) return;
      const [id] = [...selection.ids];
      setStickyColor(doc, id, color);
    },
    [doc, selection.ids, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    deleteObjects(doc, ids);
    selection.clear();
  }, [doc, selection, editable]);

  const zoom = camState.zoom;
  const cam = camState;

  // Determine if we show the single-note toolbar
  const isSingleSticky = selection.ids.size === 1;
  const selectedStickyId = isSingleSticky ? [...selection.ids][0] : null;
  const selectedNote = selectedStickyId ? notes.find((n) => n.id === selectedStickyId) : null;
  const showNoteToolbar = selectedNote && !selection.editingId && selectedNote.type === 'sticky';

  let noteToolbarStyle: React.CSSProperties | undefined;
  if (selectedNote && showNoteToolbar) {
    const noteW = selectedNote.width ?? 200;
    const screenPt = worldToScreen(cam, { x: selectedNote.x + noteW / 2, y: selectedNote.y });
    noteToolbarStyle = {
      position: 'fixed' as const,
      left: screenPt.x,
      top: screenPt.y - 40,
      transform: 'translateX(-50%)',
      zIndex: 1000,
    };
  }

  // Selection bar position (for 2+ selected)
  let selectionBarStyle: React.CSSProperties | undefined;
  if (selection.ids.size >= 2 && notes.length > 0) {
    // Compute bounding box of selection in screen space
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const note of notes) {
      if (!selection.ids.has(note.id)) continue;
      const w = note.width ?? 200;
      if (note.x < minX) minX = note.x;
      if (note.y < minY) minY = note.y;
      if (note.x + w > maxX) maxX = note.x + w;
    }
    const topLeft = worldToScreen(cam, { x: minX, y: minY });
    const topRight = worldToScreen(cam, { x: maxX, y: minY });
    selectionBarStyle = {
      position: 'fixed' as const,
      left: (topLeft.x + topRight.x) / 2,
      top: topLeft.y - 40,
      transform: 'translateX(-50%)',
      zIndex: 1000,
    };
  }

  return (
    <div onKeyDown={handleKeyDown} data-testid="app-root" tabIndex={-1}>
      <ConnectionStatus state={connectionState} />
      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editable} />
      <BoardViewport
        onDblClickEmpty={handleDblClickEmpty}
        onEmptyClick={handleEmptyClick}
        onCameraChange={handleCameraChange}
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
            zoom={zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            editable={editable}
            onSelect={(id) => selection.click(id)}
            onToggleSelect={(id) => selection.toggle(id)}
            onStartEdit={(id) => selection.startEdit(id)}
            onEndEdit={() => selection.endEdit()}
            onObjectPointerDown={gesture.onObjectPointerDown}
          />
        ))}
        <MarqueeRect rect={marquee.rect} camera={camState} />
      </BoardViewport>

      {/* Selection overlay (handles) */}
      {!selection.editingId && selection.ids.size >= 1 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={notes}
          camera={camState}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
      )}

      {/* Selection bar for 2+ objects */}
      {selection.ids.size >= 2 && !selection.editingId && (
        <div style={selectionBarStyle}>
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* Note toolbar for single sticky */}
      {showNoteToolbar && selectedNote && (
        <div style={noteToolbarStyle}>
          <NoteToolbar color={selectedNote.color} onColor={handleColor} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
