import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  createSticky,
  deleteObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../shared/config';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size,
} from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { useCamera } from '../canvas/useCamera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Whether the board may be edited. False only while its saved state cannot be loaded: an
 * empty stand-in must not be edited as if it were the board (PRD persist.load_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

const UNMEASURED: Size = { width: 0, height: 0 };
const HALF = 2;

/** Keys typed into these elements belong to them, never to board shortcuts. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

/** Creation order: a stable DOM order, so stacking changes never move a note's element. */
function byCreation(a: StickySnapshot, b: StickySnapshot): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The board of stories 1–4 (camera, sticky notes, live sync, persistence) for one existing
 * board. Since story 5 it is mounted by BoardPage only after the board's link was checked.
 */
export function Board({ boardId, children }: { boardId: string; children?: ReactNode }) {
  const [viewport, setViewport] = useState<Size>(UNMEASURED);
  const controller = useCamera(viewport);
  const { camera } = controller;
  const { doc, notes, connection } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit: beginEdit, endEdit } = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const editable = canEdit(connection);

  const stateRef = useRef({ selectedId, editingId, camera, viewport, editable });
  stateRef.current = { selectedId, editingId, camera, viewport, editable };

  // Every edit entry point goes through these guards: no board-model mutation while !editable.
  const startEdit = useCallback(
    (id: string) => {
      if (stateRef.current.editable) beginEdit(id);
    },
    [beginEdit],
  );

  // Losing the board mid-edit ends the edit (text typed so far is already in the document).
  useEffect(() => {
    if (!editable && stateRef.current.editingId !== null) endEdit('selected');
  }, [editable, endEdit]);

  // A note removed while selected, edited or dragged (stale id) simply ends the interaction:
  // this is also how a note deleted by someone else ends my typing or dragging, silently.
  useEffect(() => {
    const present = new Set(notes.map((n) => n.id));
    if (selectedId !== null && !present.has(selectedId)) select(null);
    if (draggingId !== null && !present.has(draggingId)) setDraggingId(null);
  }, [notes, selectedId, draggingId, select]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({ getNotes: () => snapshot(doc), getDoc: () => doc });
  }, [doc]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({ connectionState: connection });
  }, [connection]);

  const createAt = useCallback(
    (world: Point) => {
      if (!stateRef.current.editable) return;
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const onEmptyDoubleClick = useCallback(
    (point: Point) => createAt(screenToWorld(stateRef.current.camera, point)),
    [createAt],
  );

  const onCreateSticky = useCallback(() => {
    const { camera: cam, viewport: size } = stateRef.current;
    createAt(screenToWorld(cam, { x: size.width / HALF, y: size.height / HALF }));
  }, [createAt]);

  const onEmptyPointerDown = useCallback(() => {
    if (stateRef.current.editingId !== null) endEdit('unselected');
  }, [endEdit]);

  const onEmptyClick = useCallback(() => select(null), [select]);

  const onDragChange = useCallback((id: string, dragging: boolean) => {
    setDraggingId((current) => (dragging ? id : current === id ? null : current));
  }, []);

  const deleteSelected = useCallback(() => {
    const id = stateRef.current.selectedId;
    if (id === null || !stateRef.current.editable) return;
    deleteObject(doc, id);
    select(null);
  }, [doc, select]);

  // Enter edits the selected note; Delete/Backspace delete it — never while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;
      const { selectedId: selected, editingId: editing } = stateRef.current;
      if (selected === null || editing !== null) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selected);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startEdit, deleteSelected]);

  const stackIndex = useMemo(() => new Map(notes.map((n, i) => [n.id, i + 1])), [notes]);
  const domOrder = useMemo(() => [...notes].sort(byCreation), [notes]);

  const selectedNote = selectedId === null ? undefined : notes.find((n) => n.id === selectedId);
  const showNoteToolbar = editable && selectedNote !== undefined && editingId === null && draggingId === null;
  let noteToolbarStyle: CSSProperties | undefined;
  if (selectedNote) {
    const anchor = worldToScreen(camera, { x: selectedNote.x + STICKY_SIZE_WORLD / HALF, y: selectedNote.y });
    noteToolbarStyle = { left: anchor.x, top: anchor.y };
  }

  return (
    <main className="app">
      <BoardViewport
        controller={controller}
        onResize={setViewport}
        onEmptyPointerDown={onEmptyPointerDown}
        onEmptyClick={onEmptyClick}
        onEmptyDoubleClick={onEmptyDoubleClick}
      >
        {domOrder.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            stackIndex={stackIndex.get(note.id) ?? 0}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDragChange={onDragChange}
            readOnly={!editable}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
      {showNoteToolbar && selectedNote && (
        <NoteToolbar
          color={selectedNote.color}
          style={noteToolbarStyle}
          onColor={(c: StickyColor) => {
            if (stateRef.current.editable) setStickyColor(doc, selectedNote.id, c);
          }}
          onDelete={deleteSelected}
        />
      )}
      <NavigationHint visible={!controller.hasNavigated} />
      <ConnectionStatus state={connection} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
      {children}
    </main>
  );
}
