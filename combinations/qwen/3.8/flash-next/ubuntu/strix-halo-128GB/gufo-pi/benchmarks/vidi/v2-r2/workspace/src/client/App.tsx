import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoard } from './canvas/BoardContext';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, worldToScreen } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { NoteLayer } from './objects/NoteLayer';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import {
  createSticky,
  deleteObject,
  setStickyColor,
} from '@shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '@shared/config';
import type { Point } from '@client/canvas/camera';


/**
 * Editing is disabled only while the board cannot be loaded (load_failed). All
 * other connection states (connecting/connected/reconnecting/confirmed) allow
 * editing so a transient storage hiccup never locks the user out.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function BoardOverlay(): ReactElement {
  const { camera, hasNavigated, zoomStep, reset } = useBoard();
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

export function Board({ boardId }: { boardId: string }): ReactElement {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const selection = useSelection(doc, notes);
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  // Refs for stable access in global keydown handler
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const docRef = useRef(doc);
  docRef.current = doc;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  // Global keyboard handler for Enter, Delete, Backspace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editableRef.current) return; // read-only board (load_failed)
      const sel = selectionRef.current;
      const d = docRef.current;
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl !== null &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if (e.key === 'Enter') {
        if (sel.selectedId && !sel.editingId && !isInputFocused) {
          e.preventDefault();
          sel.startEdit(sel.selectedId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.selectedId && !sel.editingId && !isInputFocused) {
          e.preventDefault();
          deleteObject(d, sel.selectedId);
          sel.select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleCreateSticky = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      const id = createSticky(doc, worldPoint);
      if (id) {
        startEdit(id);
      }
    },
    [doc, startEdit, editable],
  );

  const handleEmptyDoubleClick = useCallback(
    (worldPoint: Point) => {
      handleCreateSticky(worldPoint);
    },
    [handleCreateSticky],
  );

  const handleEmptyClick = useCallback(() => {
    if (editingId) {
      endEdit('unselected');
    }
    select(null);
  }, [editingId, endEdit, select]);

  const handleColorChange = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      if (selectedId) {
        setStickyColor(doc, selectedId, color);
      }
    },
    [doc, selectedId, editable],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    if (selectedId) {
      deleteObject(doc, selectedId);
      select(null);
    }
  }, [doc, selectedId, select, editable]);

  return (
    <div className="vidi6-app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onEmptyClick={handleEmptyClick}
        overlay={
          <AppChrome
            doc={doc}
            notes={notes}
            selectedId={selectedId}
            editingId={editingId}
            editable={editable}
            onColorChange={handleColorChange}
            onDelete={handleDelete}
            onCreateSticky={handleCreateSticky}
          />
        }
      >
        <NoteLayer
          notes={notes}
          doc={doc}
          selectedId={selectedId}
          editingId={editingId}
          editable={editable}
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      </BoardViewport>
    </div>
  );
}

interface AppChromeProps {
  doc: import('yjs').Doc;
  notes: readonly import('@shared/board-model').StickySnapshot[];
  selectedId: string | null;
  editingId: string | null;
  editable: boolean;
  onColorChange(c: StickyColor): void;
  onDelete(): void;
  onCreateSticky(p: Point): void;
}

function AppChrome(props: AppChromeProps): ReactElement {
  const { camera, viewport } = useBoard();
  const selectedNote = props.notes.find((n) => n.id === props.selectedId) || null;

  const handleCreateFromToolbar = useCallback(() => {
    const worldPoint: Point = {
      x: camera.x + viewport.width / 2 / camera.zoom,
      y: camera.y + viewport.height / 2 / camera.zoom,
    };
    props.onCreateSticky(worldPoint);
  }, [camera, viewport, props]);

  return (
    <>
      <BoardOverlay />
      <Toolbar onCreateSticky={handleCreateFromToolbar} disabled={!props.editable} />
      {selectedNote && !props.editingId && (
        <NoteToolbarScreenSpace
          note={selectedNote}
          camera={camera}
          onColor={props.onColorChange}
          onDelete={props.onDelete}
        />
      )}
    </>
  );
}

function NoteToolbarScreenSpace({
  note,
  camera,
  onColor,
  onDelete,
}: {
  note: import('@shared/board-model').StickySnapshot;
  camera: { x: number; y: number; zoom: number };
  onColor(c: StickyColor): void;
  onDelete(): void;
}): ReactElement {
  const screenPos = worldToScreen(camera, {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y,
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
    >
      <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
    </div>
  );
}

/**
 * Top-level router (story 5): `/` -> Home, `/b/:id` -> Board page, anything else
 * -> Board not found. The story 3 client-side redirect from `/` to a random id is
 * removed: boards are created server-side and opened by explicit link.
 */
export function App(): ReactElement {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
