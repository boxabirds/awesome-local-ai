import { useEffect, useState, useMemo, useCallback } from 'react';
import type { RefObject } from 'react';
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, getStickyText, hasObject, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import type { Selection } from '../../src/client/board/useSelection';
import { useBoardActions } from '../../src/client/board/useBoardActions';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useTool } from '../../src/client/board/useTool';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { Toolbar } from '../../src/client/board/Toolbar';
import { getObjectType } from '../../src/client/objects/registry';
import { createMeasurer } from '../../src/client/objects/textLayout';
import { createText, getTextYText, deleteIfEmpty, isEmptyText } from '../../src/shared/objects/text';
import { deleteObjects, objectBounds } from '../../src/shared/board-model';
import { unionRects } from '../../src/shared/geometry';
import { worldToScreen, screenToWorld } from '../../src/client/canvas/camera';
import { DEFAULT_TEXT_SIZE } from '../../src/shared/config';
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
  undoRef,
  undo,
  editable = true,
  onGestureStart,
  onGestureEnd,
}: {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  selectionRef?: RefObject<Selection | null>;
  /** The active undo controller (real or injected) for assertions. */
  undoRef?: RefObject<UndoController | null>;
  /**
   * Inject a (fake) undo controller instead of the real one (story 8,
   * TC-18 to TC-21). Absent: a real controller is created for the doc.
   */
  undo?: UndoController;
  /** persist.client_status: false simulates a locked (load_failed) board. */
  editable?: boolean;
  /** Gesture boundaries (story 8 undo hooks; asserted in TC-26). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const size = DEFAULT_SIZE;
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  // Story 8: a real per-user controller per doc unless a test injects one.
  const [internalUndo] = useState(() => createUndo(doc));
  useEffect(() => () => internalUndo.destroy(), [internalUndo]);
  const controller = undo ?? internalUndo;
  if (undoRef) undoRef.current = controller;
  const boundary = () => controller.boundary();
  const undoState = useUndo(controller, editable);
  const selection = useSelection(notes, (id) => hasObject(doc, id));
  const actions = useBoardActions({ doc, api, size, selection, editable });
  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: () => {
      boundary();
      onGestureStart?.();
    },
    onGestureEnd: () => {
      boundary();
      onGestureEnd?.();
    },
  });
  const { tool, setTool } = useTool(editable);
  const measurer = useMemo(() => createMeasurer(), []);
  const createStickyAtRef = (p: { x: number; y: number }) => {
    boundary();
    actions.createAtScreenPoint(p);
    boundary();
  };
  const createStickyCentreRef = () => {
    boundary();
    actions.createAtCentre();
    boundary();
  };
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo: controller, tool, setTool, onCreateStickyCentre: createStickyCentreRef });
  const marquee = useMarquee(api.camera, notes, (ids) => selection.setMany(ids, true));
  if (docRef) docRef.current = doc;
  if (apiRef) apiRef.current = api;
  if (selectionRef) selectionRef.current = selection;

  const createStickyAt = createStickyAtRef;
  const createStickyCentre = createStickyCentreRef;

  const createTextAt = useCallback((screenPoint: { x: number; y: number }) => {
    if (!editable) return;
    boundary();
    const world = screenToWorld(api.camera, screenPoint);
    const id = createText(doc, LOCAL_ORIGIN, world, DEFAULT_TEXT_SIZE);
    if (id) {
      selection.setMany([id], false);
      selection.startEdit(id);
    }
    boundary();
    setTool('select');
  }, [doc, api, editable, selection, setTool]);

  const handleEndEdit = useCallback(() => {
    const editingId = selection.editingId;
    if (editingId !== null && isEmptyText(doc, editingId)) {
      deleteIfEmpty(doc, LOCAL_ORIGIN, editingId);
      selection.clear();
      return;
    }
    selection.endEdit();
  }, [doc, selection]);

  const deleteSelection = () => {
    if (!editable) return;
    boundary();
    if (deleteObjects(doc, [...selection.ids]) > 0) selection.clear();
    boundary();
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
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
        tool={tool}
        onCreateTextAt={createTextAt}
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
              onEndEdit={handleEndEdit}
              undo={controller}
              measurer={measurer}
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
            boundary={boundary}
          />
        </div>
      )}
      <Toolbar onCreateSticky={createStickyCentre} undo={undoState} tool={tool} onToolChange={setTool} disabled={!editable} />
    </div>
  );
}

export interface NotesHarnessHandle {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  /** The live selection state (ids + editingId). */
  selectionRef: RefObject<Selection | null>;
  /** The active undo controller (story 8). */
  undoRef: RefObject<UndoController | null>;
  /** The board viewport element (empty board space). */
  viewport: HTMLElement;
}

/** Render the notes harness; the doc is created during the first render. */
export function renderNotesHarness(
  props?: {
    editable?: boolean;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
    /** Inject a (fake) undo controller instead of the real one (TC-18 to TC-21). */
    undo?: UndoController;
  },
): NotesHarnessHandle {
  const docRef: RefObject<Y.Doc | null> = { current: null };
  const apiRef: RefObject<CameraApi | null> = { current: null };
  const selectionRef: RefObject<Selection | null> = { current: null };
  const undoRef: RefObject<UndoController | null> = { current: null };
  render(
    <NotesHarness
      docRef={docRef}
      apiRef={apiRef}
      selectionRef={selectionRef}
      undoRef={undoRef}
      editable={props?.editable ?? true}
      onGestureStart={props?.onGestureStart}
      onGestureEnd={props?.onGestureEnd}
      undo={props?.undo}
    />,
  );
  const viewport = document.querySelector('.vidi6-viewport') as HTMLElement;
  return { docRef, apiRef, selectionRef, undoRef, viewport };
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

/** Create a text object from test code (outside React events). */
export function createTextObject(doc: Y.Doc, x: number, y: number): string {
  let id = '';
  act(() => {
    id = createText(doc, LOCAL_ORIGIN, { x, y }, DEFAULT_TEXT_SIZE);
  });
  return id;
}

/** Seed a text object's content from test code. */
export function seedTextContent(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    getTextYText(doc, id)!.insert(0, text);
  });
}
