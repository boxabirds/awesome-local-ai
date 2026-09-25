import type { RefObject } from 'react';
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, getStickyText, hasObject } from '../../src/shared/board-model';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import type { Selection } from '../../src/client/board/useSelection';
import { useBoardActions } from '../../src/client/board/useBoardActions';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { Toolbar } from '../../src/client/board/Toolbar';
import { getObjectType } from '../../src/client/objects/registry';
import { deleteObjects, objectBounds } from '../../src/shared/board-model';
import { unionRects } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import { DEFAULT_SIZE } from './test-utils';

/**
 * Test double for App's board wiring: the same hooks (useCamera +
 * useBoardDoc + useSelection + transform gesture + marquee + keys +
 * overlay/bar) at a fixed 1280x800 size, exposing the doc, camera api and
 * selection for assertions.
 */
export function NotesHarness({
  docRef,
  apiRef,
  selectionRef,
  editable = true,
  onGestureStart,
  onGestureEnd,
}: {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  selectionRef?: RefObject<Selection | null>;
  /** persist.client_status: false simulates a locked (load_failed) board. */
  editable?: boolean;
  /** Gesture boundaries (story 8 undo hooks; asserted in TC-26). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const size = DEFAULT_SIZE;
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes, (id) => hasObject(doc, id));
  const actions = useBoardActions({ doc, api, size, selection, editable });
  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart,
    onGestureEnd,
  });
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable });
  const marquee = useMarquee(api.camera, notes, (ids) => selection.setMany(ids, true));
  if (docRef) docRef.current = doc;
  if (apiRef) apiRef.current = api;
  if (selectionRef) selectionRef.current = selection;

  const deleteSelection = () => {
    if (!editable) return;
    if (deleteObjects(doc, [...selection.ids]) > 0) selection.clear();
  };

  const selectedObjects = notes.filter((o) => selection.ids.has(o.id));
  const box = unionRects(selectedObjects.map(objectBounds));
  let barAnchor: { x: number; y: number } | null = null;
  if (box !== null) {
    const topLeft = worldToScreen(api.camera, { x: box.x, y: box.y });
    barAnchor = { x: topLeft.x + (box.width * api.camera.zoom) / 2, y: topLeft.y - 8 };
  }

  return (
    <div className="vidi6-shell">
      <BoardViewport
        api={api}
        onCreateStickyAt={actions.createAtScreenPoint}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
      >
        {notes.map((note) => {
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              editable={editable}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={api.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <MarqueeRect rect={marquee.rect} camera={api.camera} />
      {barAnchor !== null && selection.editingId === null && (
        <div
          className="vidi6-selection-bar-anchor"
          style={{ left: barAnchor.x, top: barAnchor.y }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            editable={editable}
            onDelete={deleteSelection}
          />
        </div>
      )}
      <Toolbar onCreateSticky={actions.createAtCentre} />
    </div>
  );
}

export interface NotesHarnessHandle {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  /** The live selection state (ids + editingId). */
  selectionRef: RefObject<Selection | null>;
  /** The board viewport element (empty board space). */
  viewport: HTMLElement;
}

/** Render the notes harness; the doc is created during the first render. */
export function renderNotesHarness(
  props?: {
    editable?: boolean;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  },
): NotesHarnessHandle {
  const docRef: RefObject<Y.Doc | null> = { current: null };
  const apiRef: RefObject<CameraApi | null> = { current: null };
  const selectionRef: RefObject<Selection | null> = { current: null };
  render(
    <NotesHarness
      docRef={docRef}
      apiRef={apiRef}
      selectionRef={selectionRef}
      editable={props?.editable ?? true}
      onGestureStart={props?.onGestureStart}
      onGestureEnd={props?.onGestureEnd}
    />,
  );
  const viewport = document.querySelector('.vidi6-viewport') as HTMLElement;
  return { docRef, apiRef, selectionRef, viewport };
}

/** Create a note from test code (outside React events), flushed synchronously. */
export function createNote(doc: Y.Doc, x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y });
  });
  return id;
}

/** Seed a note's text from test code (a "remote peer" writing the Y.Text). */
export function seedNoteText(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    getStickyText(doc, id)!.insert(0, text);
  });
}
