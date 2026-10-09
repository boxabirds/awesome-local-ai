/**
 * Shared harness for the story 2 component tests: renders the real board
 * wiring (BoardViewport + StickyNote list + selection/keyboard hooks + left
 * toolbar) against a *real* `Y.Doc` with an explicit viewport size (jsdom
 * has no layout), plus camera and selection snapshots for assertions.
 *
 * Mirrors App.tsx (minus ZoomControls/NavigationHint and the test hooks).
 */
import { render, screen } from "@testing-library/react";
import * as Y from "yjs";
import type { Camera, Point } from "../../src/client/canvas/camera";
import { screenToWorld } from "../../src/client/canvas/camera";
import { BoardViewport } from "../../src/client/canvas/BoardViewport";
import { CameraContext, useCamera } from "../../src/client/canvas/useCamera";
import { Toolbar } from "../../src/client/board/Toolbar";
import { useBoardDoc } from "../../src/client/board/useBoardDoc";
import {
  usePruneSelection,
  useSelection,
  useStickyKeyboard,
} from "../../src/client/board/useSelection";
import { StickyNote } from "../../src/client/objects/StickyNote";
import {
  createSticky,
  initDoc,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { TEST_VIEWPORT } from "./testBoard";

export function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function Harness({ doc }: { doc: Y.Doc }) {
  const api = useCamera(TEST_VIEWPORT);
  const { notes } = useBoardDoc(doc);
  const selection = useSelection();

  usePruneSelection(notes, selection);
  useStickyKeyboard(doc, selection);

  const createStickyAt = (world: Point): void => {
    const id = createSticky(doc, world);
    if (id !== "") selection.startEdit(id);
  };

  const createStickyAtCenter = (): void => {
    createStickyAt(
      screenToWorld(api.camera, {
        x: TEST_VIEWPORT.width / 2,
        y: TEST_VIEWPORT.height / 2,
      }),
    );
  };

  return (
    <div>
      <CameraContext.Provider value={api}>
        <BoardViewport
          onCreateAt={createStickyAt}
          onEmptyClick={() => selection.select(null)}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
      </CameraContext.Provider>
      <Toolbar onCreateSticky={createStickyAtCenter} />
      <output data-testid="camera-snapshot">{JSON.stringify(api.camera)}</output>
      <output data-testid="selection-snapshot">
        {JSON.stringify({
          selectedId: selection.selectedId,
          editingId: selection.editingId,
        })}
      </output>
    </div>
  );
}

export function renderHarness(doc: Y.Doc) {
  return render(<Harness doc={doc} />);
}

export function cameraOf(): Camera {
  const raw = screen.getByTestId("camera-snapshot").textContent ?? "{}";
  return JSON.parse(raw) as Camera;
}

export interface SelectionSnapshot {
  selectedId: string | null;
  editingId: string | null;
}

export function selectionOf(): SelectionSnapshot {
  const raw = screen.getByTestId("selection-snapshot").textContent ?? "{}";
  return JSON.parse(raw) as SelectionSnapshot;
}

export function notesOf(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}
