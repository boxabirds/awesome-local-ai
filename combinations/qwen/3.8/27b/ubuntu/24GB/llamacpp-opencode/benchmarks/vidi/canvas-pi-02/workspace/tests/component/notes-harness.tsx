import type { RefObject } from 'react';
import { act, render } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { CameraApi } from '../../src/client/canvas/useCamera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardActions } from '../../src/client/board/useBoardActions';
import { useBoardKeyboard } from '../../src/client/board/useBoardKeyboard';
import { Toolbar } from '../../src/client/board/Toolbar';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { DEFAULT_SIZE } from './test-utils';

/**
 * Test double for App's board wiring: the same hooks (useCamera +
 * useBoardDoc + useSelection + create/keyboard wiring) at a fixed
 * 1280x800 size, exposing the doc and camera api for assertions.
 */
export function NotesHarness({
  docRef,
  apiRef,
}: {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
}) {
  const size = DEFAULT_SIZE;
  const api = useCamera(size);
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  const actions = useBoardActions({ doc, api, size, selection });
  useBoardKeyboard({ doc, selection });
  if (docRef) docRef.current = doc;
  if (apiRef) apiRef.current = api;

  return (
    <div className="vidi6-shell">
      <BoardViewport api={api} onCreateStickyAt={actions.createAtScreenPoint} onEmptyClick={() => selection.select(null)}>
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
      <Toolbar onCreateSticky={actions.createAtCentre} />
    </div>
  );
}

export interface NotesHarnessHandle {
  docRef: RefObject<Y.Doc | null>;
  apiRef: RefObject<CameraApi | null>;
  /** The board viewport element (empty board space). */
  viewport: HTMLElement;
}

/** Render the notes harness; the doc is created during the first render. */
export function renderNotesHarness(): NotesHarnessHandle {
  const docRef: RefObject<Y.Doc | null> = { current: null };
  const apiRef: RefObject<CameraApi | null> = { current: null };
  render(<NotesHarness docRef={docRef} apiRef={apiRef} />);
  const viewport = document.querySelector('.vidi6-viewport') as HTMLElement;
  return { docRef, apiRef, viewport };
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
