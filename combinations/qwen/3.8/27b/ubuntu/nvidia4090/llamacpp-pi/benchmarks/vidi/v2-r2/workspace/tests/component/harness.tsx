import { useCallback, useEffect, useState } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import { CameraContext, useCamera } from '../../src/client/canvas/useCamera';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky, deleteObject, renderOrder, setStickyColor } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useStickyKeyboard } from '../../src/client/board/useStickyKeyboard';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { NoteToolbar } from '../../src/client/objects/NoteToolbar';
import { canEdit } from '../../src/client/App';

/** Fixed viewport size for component tests (default laptop, design fixture). */
export const TEST_VIEWPORT: Size = { width: 1280, height: 800 };

export interface BoardHarnessOptions {
  withHint?: boolean;
  withControls?: boolean;
  /** Render the ConnectionStatus badge wired to the mocked provider. */
  withStatusBadge?: boolean;
}

export interface BoardHarnessResult extends RenderResult {
  /** The camera the viewport currently renders (read after each act). */
  readCamera(): { x: number; y: number; zoom: number };
}

/**
 * Renders the board wired exactly like App.tsx does (useCamera + context +
 * BoardViewport, plus the zoom controls and hint), with a fixed viewport
 * size, so component tests exercise the real input handlers and rendering.
 */
export function renderBoard(options: BoardHarnessOptions = {}): BoardHarnessResult {
  function Harness() {
    const controller = useCamera(TEST_VIEWPORT);
    return (
      <CameraContext.Provider value={controller}>
        <BoardViewport />
        {options.withControls !== false && (
          <ZoomControls
            zoomPercent={zoomPercent(controller.camera)}
            canZoomIn={canZoomIn(controller.camera)}
            canZoomOut={canZoomOut(controller.camera)}
            onZoomIn={() => controller.zoomStep('in')}
            onZoomOut={() => controller.zoomStep('out')}
            onReset={controller.reset}
          />
        )}
        {options.withHint === true && (
          <NavigationHint visible={!controller.hasNavigated} />
        )}
      </CameraContext.Provider>
    );
  }

  const utils = render(<Harness />);

  return { ...utils, readCamera: () => readWorldCamera(utils) };
}

function readWorldCamera(utils: RenderResult): { x: number; y: number; zoom: number } {
  const worldLayer = utils.getByTestId('world-layer');
  const transform = worldLayer.style.transform;
  const match = transform.match(
    /scale\(([-\d.eE+]+)\) translate\(([-\d.eE+]+)px,\s*([-\d.eE+]+)px\)/,
  );
  if (!match) {
    throw new Error(`unexpected world layer transform: ${transform}`);
  }
  return {
    x: -Number(match[2]),
    y: -Number(match[3]),
    zoom: Number(match[1]),
  };
}

export interface StickyBoardHarnessResult extends RenderResult {
  /** The Y.Doc backing the rendered board (mutate inside act()). */
  doc: Y.Doc;
  /** The camera the viewport currently renders (read after each act). */
  readCamera(): { x: number; y: number; zoom: number };
}

/**
 * Renders the full story-2 board wired exactly like App.tsx does: camera
 * context, Y.Doc snapshot store, selection, keyboard shortcuts, the left
 * toolbar, the floating note toolbar and all sticky notes, with a fixed
 * viewport size.
 */
export function renderStickyBoard(options: BoardHarnessOptions = {}): StickyBoardHarnessResult {
  let docInstance: Y.Doc | null = null;

  function StickyBoardHarness() {
    const controller = useCamera(TEST_VIEWPORT);
    // The y-websocket provider is mocked in tests/component/setup.ts, so
    // this boardId never reaches the network.
    const { doc, objects, connectionState } = useBoardDoc('harness-board');
    docInstance = doc;
    // Mirrors App.tsx: editing is locked out while the board failed to load.
    const editable = canEdit(connectionState);
    const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
    const [draggingId, setDraggingId] = useState<string | null>(null);

    useStickyKeyboard({ doc, selectedId, editingId, select, startEdit, editable });

    // Stale local state guard (mirrors App.tsx).
    useEffect(() => {
      if (selectedId !== null && !objects.some((o) => o.id === selectedId)) {
        select(null);
      }
      if (editingId !== null && !objects.some((o) => o.id === editingId)) {
        endEdit('unselected');
      }
    }, [objects, selectedId, editingId, select, endEdit]);

    const createAt = useCallback(
      (p: Point): void => {
        if (!editable) {
          return; // load_failed: editing locked out (mirrors App.tsx)
        }
        const id = createSticky(doc, screenToWorld(controller.camera, p));
        if (id !== '') {
          startEdit(id);
        }
      },
      [doc, controller.camera, startEdit, editable],
    );

    const selectedNote =
      selectedId !== null ? objects.find((o) => o.id === selectedId) : undefined;
    const noteToolbarVisible =
      selectedNote !== undefined &&
      editingId !== selectedNote.id &&
      draggingId !== selectedNote.id;

    return (
      <CameraContext.Provider value={controller}>
        <BoardViewport onDoubleClickEmpty={createAt} onEmptyClick={() => select(null)}>
          {renderOrder(objects).map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={controller.camera.zoom}
              selected={selectedId === note.id}
              editing={editingId === note.id}
              disabled={!editable}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDraggingChange={setDraggingId}
            />
          ))}
        </BoardViewport>
        <Toolbar
          onCreateSticky={() => createAt({ x: TEST_VIEWPORT.width / 2, y: TEST_VIEWPORT.height / 2 })}
          disabled={!editable}
        />
        {options.withStatusBadge === true && <ConnectionStatus state={connectionState} />}
        {noteToolbarVisible && selectedNote !== undefined && (
          <div
            style={{
              position: 'fixed',
              left: (STICKY_SIZE_WORLD * controller.camera.zoom) / 2,
              top: 200,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <NoteToolbar
              color={selectedNote.color}
              disabled={!editable}
              onColor={(c) => {
                if (!editable) {
                  return; // load_failed: editing locked out (mirrors App.tsx)
                }
                setStickyColor(doc, selectedNote.id, c);
              }}
              onDelete={() => {
                if (!editable) {
                  return; // load_failed: editing locked out (mirrors App.tsx)
                }
                if (deleteObject(doc, selectedNote.id)) {
                  select(null);
                }
              }}
            />
          </div>
        )}
        {options.withControls !== false && (
          <ZoomControls
            zoomPercent={zoomPercent(controller.camera)}
            canZoomIn={canZoomIn(controller.camera)}
            canZoomOut={canZoomOut(controller.camera)}
            onZoomIn={() => controller.zoomStep('in')}
            onZoomOut={() => controller.zoomStep('out')}
            onReset={controller.reset}
          />
        )}
        {options.withHint === true && (
          <NavigationHint visible={!controller.hasNavigated} />
        )}
      </CameraContext.Provider>
    );
  }

  const utils = render(<StickyBoardHarness />);
  if (docInstance === null) {
    throw new Error('sticky board harness did not render a document');
  }

  return { ...utils, doc: docInstance, readCamera: () => readWorldCamera(utils) };
}
