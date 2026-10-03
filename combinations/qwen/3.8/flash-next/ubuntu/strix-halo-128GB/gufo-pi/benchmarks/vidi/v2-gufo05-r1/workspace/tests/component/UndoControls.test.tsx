/**
 * The Undo and Redo controls, and the keys that do the same thing
 * (`undo.buttons`, `undo.shortcuts`, `undo.not_editable`).
 *
 * Two kinds of claim, so two kinds of double. The buttons are tested against a real
 * controller on a real document, because what has to be proved about them is that they say
 * what the history actually holds — enabled while there is a step, disabled while there is
 * not — and that a press moves the document rather than the screen. The key combinations
 * are tested against a fake controller, because what has to be proved about them is a
 * mapping: this combination means undo, that one means redo, this one belongs to a field
 * with the caret in it, and none of that has anything to do with documents.
 *
 * TC-18 the buttons and the shortcuts, both directions, and an empty history
 * TC-19 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y, and where they are not claimed
 * TC-20 a board that cannot be edited offers no history and obeys no shortcuts
 * TC-21 two people on one board, each with a history of their own
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { createSticky, moveObjects, objectSnapshots } from '../../src/shared/board-model';
import { SharePanel } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { Toolbar } from '../../src/client/board/Toolbar';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';
import { linkDocs } from '../unit/peer';

afterEach(cleanup);

/**
 * The part of the board that answers to the keyboard and to the mouse: the toolbar with
 * the real `useUndo` behind it, the real keyboard handler, and an empty board.
 */
function ControlsProbe({
  doc,
  controller,
  canEdit,
}: {
  doc: Y.Doc;
  controller: UndoController;
  canEdit: boolean;
}) {
  const selection = useSelection([]);
  useBoardKeys({ doc, selection, snapshot: [], canEdit, undo: controller });
  const undo = useUndo(controller, canEdit);
  return <Toolbar onCreateSticky={() => {}} undo={undo} />;
}

/** Press a key somewhere, and report whether the board claimed the event. */
function press(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
  target: EventTarget = window,
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const undoButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

/** Where the first object on the board is, or nothing when the board is empty. */
function firstPlace(doc: Y.Doc): { x: number; y: number } | undefined {
  const [object] = objectSnapshots(doc);
  return object && { x: object.x, y: object.y };
}

/**
 * A controller that records what it was asked to do, so a test can read the mapping from
 * a key combination to a command with no document in the way.
 */
function fakeController(): { controller: UndoController; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    controller: {
      undo: () => {
        calls.push('undo');
        return true;
      },
      redo: () => {
        calls.push('redo');
        return true;
      },
      boundary: () => {
        calls.push('boundary');
      },
      canUndo: () => false,
      canRedo: () => false,
      addScope: () => {},
      onChange: () => () => {},
      destroy: () => {},
    },
  };
}

describe('undo.buttons: the toolbar controls, on a real history', () => {
  it('TC-18 says what the history holds, in both directions', () => {
    const doc = new Y.Doc();
    const controller = createUndo(doc);
    render(<ControlsProbe doc={doc} controller={controller} canEdit />);

    // An empty history: both buttons are out, rather than waiting for a click.
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');

    // One change of mine, and Undo wakes up while Redo stays out.
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 300 });
    });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    act(() => {
      undoButton().click();
    });
    // The press moved the document, not just the buttons.
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    act(() => {
      redoButton().click();
    });
    expect(objectSnapshots(doc).map((object) => object.id)).toEqual([id]);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    // And back to an empty history: out again, not stuck looking live.
    act(() => {
      undoButton().click();
    });
    expect(undoButton().disabled).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);

    controller.destroy();
    doc.destroy();
  });

  it('TC-18 the shortcuts do the same thing, and claim the event', () => {
    const doc = new Y.Doc();
    const controller = createUndo(doc);
    render(<ControlsProbe doc={doc} controller={controller} canEdit />);

    let id = '';
    act(() => {
      id = createSticky(doc, { x: 300, y: 300 });
    });
    expect(firstPlace(doc)).toEqual({ x: 200, y: 200 });

    // Ctrl+Z: claimed, so the browser does not undo the page underneath the board.
    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(undoButton().disabled).toBe(true);

    expect(press('z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(objectSnapshots(doc).map((object) => object.id)).toEqual([id]);
    expect(firstPlace(doc)).toEqual({ x: 200, y: 200 });

    controller.destroy();
    doc.destroy();
  });

  it('TC-18 a press with nothing behind it changes nothing', () => {
    const doc = new Y.Doc();
    const controller = createUndo(doc);
    render(<ControlsProbe doc={doc} controller={controller} canEdit />);

    // Everything the control offers, on a board that has no history at all.
    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(press('z', { metaKey: true })).toBe(true);
    expect(press('y', { ctrlKey: true })).toBe(true);
    expect(objectSnapshots(doc)).toHaveLength(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    // Including the buttons themselves: disabled, and still nothing happens.
    act(() => {
      undoButton().click();
      redoButton().click();
    });
    expect(objectSnapshots(doc)).toHaveLength(0);

    controller.destroy();
    doc.destroy();
  });
});

describe('undo.shortcuts: which combination means what', () => {
  it('TC-19 maps every combination to its command, once each', () => {
    const doc = new Y.Doc();
    const { controller, calls } = fakeController();
    render(<ControlsProbe doc={doc} controller={controller} canEdit />);

    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(press('z', { metaKey: true })).toBe(true);
    expect(press('z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press('z', { metaKey: true, shiftKey: true })).toBe(true);
    expect(press('y', { ctrlKey: true })).toBe(true);

    // In order: undo, undo, redo, redo, redo. None dropped, none doubled.
    expect(calls).toEqual(['undo', 'undo', 'redo', 'redo', 'redo']);
    doc.destroy();
  });

  it('TC-19 leaves alone what belongs to somebody else', () => {
    const doc = new Y.Doc();
    const { controller, calls } = fakeController();
    const { container } = render(
      <ControlsProbe doc={doc} controller={controller} canEdit />,
    );
    const field = document.createElement('textarea');
    const button = document.createElement('button');
    container.append(field, button);

    // A field with the caret keeps its own undo (`undo.typing` answers for it inside the
    // editor, and the board refuses to answer twice).
    expect(press('z', { ctrlKey: true }, field)).toBe(false);
    expect(press('y', { ctrlKey: true }, field)).toBe(false);

    // Alt is never claimed, so the browser and the input method keep it.
    expect(press('z', { ctrlKey: true, altKey: true })).toBe(false);

    // Cmd+Y is not a combination this product claims (`undo.shortcuts` names Ctrl+Y).
    expect(press('y', { metaKey: true })).toBe(false);

    // A plain letter is not history. Ctrl+A is claimed too, but by story 7's select-all,
    // which is why the fake controller is still holding its breath.
    expect(press('a', { ctrlKey: true })).toBe(true);

    // A focused *button* does not keep the keys: clicking Undo and then pressing Ctrl+Z
    // means the same thing both times.
    expect(press('z', { ctrlKey: true }, button)).toBe(true);

    expect(calls).toEqual(['undo']);
    doc.destroy();
  });

  it('TC-20 a board that cannot be edited offers no history and obeys no shortcuts', () => {
    const doc = new Y.Doc();
    const controller = createUndo(doc);
    act(() => {
      createSticky(doc, { x: 300, y: 300 });
    });
    expect(controller.canUndo()).toBe(true);
    expect(firstPlace(doc)).toEqual({ x: 200, y: 200 });

    render(<ControlsProbe doc={doc} controller={controller} canEdit={false} />);

    // There is history in the controller, and none of it is on offer: on a board that
    // failed to load there is nothing of mine to undo, and undoing would write to a
    // document that is about to be thrown away.
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    expect(press('z', { ctrlKey: true })).toBe(false);
    expect(press('z', { metaKey: true })).toBe(false);
    expect(press('z', { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(press('y', { ctrlKey: true })).toBe(false);
    expect(firstPlace(doc)).toEqual({ x: 200, y: 200 });
    expect(objectSnapshots(doc)).toHaveLength(1);

    controller.destroy();
    doc.destroy();
  });

  it('TC-21 a field that is not the board keeps its own undo', () => {
    const doc = new Y.Doc();
    const { controller, calls } = fakeController();
    render(
      <>
        <ControlsProbe doc={doc} controller={controller} canEdit />
        <SharePanel boardId={newBoardId()} />
      </>,
    );

    // The share panel's link field: an ordinary input on the same page as the board.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    const field = screen.getByRole('textbox') as HTMLInputElement;
    field.focus();

    // Caret in it, Ctrl+Z is the field's own — the board does not claim it, does not ask
    // its controller for anything, and the board's buttons stay as they were.
    expect(press('z', { ctrlKey: true }, field)).toBe(false);
    expect(press('z', { metaKey: true }, field)).toBe(false);
    expect(press('z', { ctrlKey: true, shiftKey: true }, field)).toBe(false);
    expect(press('y', { ctrlKey: true }, field)).toBe(false);
    expect(calls).toEqual([]);

    doc.destroy();
  });
});

describe('two people, one board, two histories', () => {
  it('each tab undoes itself', () => {
    // Mia's tab and Raj's tab, on two documents that relay to each other, each with its
    // own controller. That is all a personal history is: the same document, and a stack
    // that only this tab's writes were ever added to.
    const mia = new Y.Doc();
    const raj = new Y.Doc();
    const unlink = linkDocs(mia, raj, 'from-mia', 'from-raj');

    const place = (doc: Y.Doc, id: string): { x: number; y: number } => {
      const found = objectSnapshots(doc).find((object) => object.id === id);
      if (!found) throw new Error(`note ${id} is not on this board`);
      return { x: found.x, y: found.y };
    };

    // Two notes, put there before either tab had a history, so every step from here on is
    // one person's own.
    const mine = createSticky(mia, { x: 300, y: 300 });
    const theirs = createSticky(mia, { x: 800, y: 300 });

    const miaUndo = createUndo(mia);
    const rajUndo = createUndo(raj);
    expect(miaUndo.canUndo()).toBe(false);
    expect(rajUndo.canUndo()).toBe(false);

    // Mia moves her note. Raj sees it, and has no part of it in his history.
    moveObjects(mia, new Map([[mine, { x: 400, y: 400 }]]));
    expect(place(raj, mine)).toEqual({ x: 400, y: 400 });
    expect(miaUndo.canUndo()).toBe(true);
    expect(rajUndo.canUndo()).toBe(false);
    expect(rajUndo.undo()).toBe(false);
    expect(place(mia, mine)).toEqual({ x: 400, y: 400 });

    // Raj moves his own note. Neither history takes anything from the other.
    moveObjects(raj, new Map([[theirs, { x: 900, y: 500 }]]));
    expect(place(mia, theirs)).toEqual({ x: 900, y: 500 });
    expect(miaUndo.canUndo()).toBe(true);
    expect(rajUndo.canUndo()).toBe(true);

    // Mia undoes. Her note goes back on both screens; his does not move an inch.
    expect(miaUndo.undo()).toBe(true);
    expect(place(mia, mine)).toEqual({ x: 200, y: 200 });
    expect(place(raj, mine)).toEqual({ x: 200, y: 200 });
    expect(place(raj, theirs)).toEqual({ x: 900, y: 500 });
    expect(miaUndo.canUndo()).toBe(false);
    expect(rajUndo.canUndo()).toBe(true);

    // Raj undoes his. The same, the other way round.
    expect(rajUndo.undo()).toBe(true);
    expect(place(raj, theirs)).toEqual({ x: 700, y: 200 });
    expect(place(mia, theirs)).toEqual({ x: 700, y: 200 });
    expect(place(mia, mine)).toEqual({ x: 200, y: 200 });
    expect(rajUndo.canUndo()).toBe(false);
    expect(rajUndo.canRedo()).toBe(true);
    expect(miaUndo.canRedo()).toBe(true);

    // Mia redoes her own step: her note, and nothing of Raj's anywhere near it.
    expect(miaUndo.redo()).toBe(true);
    expect(place(mia, mine)).toEqual({ x: 400, y: 400 });
    expect(place(raj, mine)).toEqual({ x: 400, y: 400 });
    expect(place(raj, theirs)).toEqual({ x: 700, y: 200 });

    // And the one case where the two of them do write the same note: Mia moves it, Raj
    // moves it too, and her undo of the first move can no longer be applied. It is a
    // silent no-op rather than an error, and rather than a jump back over Raj's work
    // (`undo.safe`).
    moveObjects(raj, new Map([[mine, { x: 1200, y: 800 }]]));
    expect(miaUndo.undo()).toBe(false);
    expect(place(mia, mine)).toEqual({ x: 1200, y: 800 });

    miaUndo.destroy();
    rajUndo.destroy();
    unlink();
    mia.destroy();
    raj.destroy();
  });
});
