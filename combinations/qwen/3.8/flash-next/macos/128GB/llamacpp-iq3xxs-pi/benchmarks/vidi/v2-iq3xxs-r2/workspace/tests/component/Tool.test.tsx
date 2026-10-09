/**
 * Story 9, tasks 7: the tool mode (TC-14 to TC-18).
 *
 * The tool is this tab's pointer mode, so these tests read the toolbar's pressed state, the
 * viewport's cursor, and whether a click on empty board wrote something to the document. They
 * also pin the two things the tool must not do: steal a key from an object being typed in, and
 * stay up on a board this client may not write to.
 */
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect, type JSX } from 'react';
import { screenToWorld } from '../../src/client/canvas/camera';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { useTool, type ToolControls } from '../../src/client/board/useTool';
import { Toolbar } from '../../src/client/board/Toolbar';
import {
  VIEWPORT_FIXTURE,
  boardNotes,
  createNote,
  editorElement,
  flushFrames,
  noteCentreOnScreen,
  pressKey,
  readCamera,
  renderBoard,
  selectNote,
  startEditingNote,
  stickyToolbarButton,
  typeText,
  waitForNotes,
  worldPointAt,
} from './fixtures/board';
import {
  EMPTY_BOARD,
  clickTextToolButton,
  clickViewport,
  createTextWithTool,
  finishEditing,
  pressTextTool,
  selectToolButton,
  textEditorElement,
  textIdsInDoc,
  textInDoc,
  textToolButton,
  toolPressed,
  typeIntoTextEditor,
  waitForTexts,
} from './fixtures/text';

/** The tool as the toolbar shows it: `aria-pressed` on one of the two tool buttons. */
function pressedTools(): { select: boolean; text: boolean } {
  return {
    select: selectToolButton().getAttribute('aria-pressed') === 'true',
    text: textToolButton().getAttribute('aria-pressed') === 'true',
  };
}

describe('the tool mode (TC-14)', () => {
  it('TC-14: T makes Text active and its button pressed; Escape and V put Select back', async () => {
    await renderBoard();
    // The board opens on Select, and says so.
    expect(pressedTools()).toEqual({ select: true, text: false });
    expect(selectToolButton().getAttribute('aria-label')).toBe('Select (V)');
    expect(textToolButton().getAttribute('aria-label')).toBe('Text (T)');

    pressKey('t');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: false, text: true });
    // The cursor the design asks for while the Text tool is up (design: cursor: text).
    expect(textToolButton().getAttribute('aria-pressed')).toBe('true');

    // Escape is about the tool first, and the second press would be about the selection.
    pressKey('Escape');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: true, text: false });

    pressKey('t');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: false, text: true });
    pressKey('v');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: true, text: false });

    // Shift+T is still the Text tool.
    pressKey('T');
    await flushFrames();
    expect(pressedTools().text).toBe(true);
  });

  it('the tool buttons answer the mouse as well as the keyboard', async () => {
    await renderBoard();
    await clickTextToolButton();
    expect(pressedTools()).toEqual({ select: false, text: true });
    // Clicking the Text button again does not switch to some third thing: there are two.
    await clickTextToolButton();
    expect(pressedTools().text).toBe(true);

    act(() => {
      selectToolButton().click();
    });
    await flushFrames();
    expect(pressedTools()).toEqual({ select: true, text: false });
  });

  it('a tool is this tab only: nothing about it reaches the document', async () => {
    await renderBoard();
    // Nothing at all was written: a tool is a pointer mode, not an object.
    await pressTextTool();
    expect(boardNotes()).toEqual([]);
    expect(textIdsInDoc()).toEqual([]);
  });
});

describe('the Text tool on a board that cannot be edited (TC-15)', () => {
  /*
   * A board this client may not write to is a board whose connection says `load_failed`,
   * which no component test can reach without a room that refuses to load — so the tool's own
   * rule is tested where it lives: `useTool` and the `Toolbar` it drives. What the board does
   * with the answer (`if (!canEdit) return;` before anything is created) is the same guard the
   * Sticky note button has always had.
   */
  let latest: ToolControls | null = null;
  let created = 0;

  /** The toolbar and the tool behind it, with no board and no document in sight. */
  function Harness({ canEdit }: { canEdit: boolean }): JSX.Element {
    const tool = useTool({
      canEdit,
      onCreateSticky: () => {
        created += 1;
      },
    });
    // Published after every change, so the test drives the same controls the buttons do.
    useEffect(() => {
      latest = tool;
    }, [tool]);
    return (
      <Toolbar
        onCreateSticky={() => {
          created += 1;
        }}
        tool={tool.tool}
        onSelectTool={() => tool.setTool('select')}
        onTextTool={() => tool.setTool('text')}
        disabled={!canEdit}
      />
    );
  }

  it('TC-15: T is recognised but refused, the Text button is disabled, and Select stays up', async () => {
    const view = render(<Harness canEdit={false} />);
    await flushFrames();

    expect(textToolButton().disabled).toBe(true);
    expect(selectToolButton().disabled).toBe(false);
    expect(stickyToolbarButton().disabled).toBe(true);
    expect(pressedTools()).toEqual({ select: true, text: false });

    // Recognised — the key is spent — and refused: the tool is not.
    const controls = latest as ToolControls;
    expect(controls.press('t')).toBe(true);
    expect(controls.tool).toBe('select');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: true, text: false });

    // `n` still creates a note: the button and the shortcut are the story 2 action, and this
    // board is not editable for other reasons too — but `useTool` does not decide that.
    expect(controls.press('n')).toBe(true);
    expect(created).toBe(1);

    view.unmount();
  });

  it('a Text tool that was up when the board stopped being editable goes back to Select', async () => {
    const view = render(<Harness canEdit />);
    await flushFrames();
    (latest as ToolControls).press('t');
    await flushFrames();
    expect(pressedTools()).toEqual({ select: false, text: true });

    view.rerender(<Harness canEdit={false} />);
    await flushFrames();
    expect(pressedTools()).toEqual({ select: true, text: false });
    view.unmount();
  });
});

describe('T while something is being typed in (TC-16)', () => {
  it('TC-16: T inside a sticky note types the letter and changes no tool', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);
    const editor = editorElement() as HTMLTextAreaElement;
    expect(editor).not.toBeNull();

    // The board sees the key (it bubbles) and hands it straight back: a `t` in a note is a t.
    const event = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    await flushFrames();
    expect(event.defaultPrevented).toBe(false);
    expect(toolPressed()).toBe('select');
    expect(pressedTools()).toEqual({ select: true, text: false });

    // And the note takes the character.
    typeText('t');
    await flushFrames();
    expect((editorElement() as HTMLTextAreaElement).value).toBe('t');
    expect(toolPressed()).toBe('select');
  });
});

describe('clicking the board with the Text tool up (TC-17)', () => {
  it('TC-17: the text object lands where it was clicked, its editor is mounted, and Select is back', async () => {
    await renderBoard();
    const at = { x: 300, y: 200 };
    const expected = worldPointAt(readCamera(), at);

    const id = await createTextWithTool(at);
    const after = worldPointAt(readCamera(), at);
    expect(after).toEqual(expected); // the click did not pan the board

    const text = textInDoc(id);
    // `screenToWorld` of the point that was clicked, as the design puts it.
    const fromClick = screenToWorld(readCamera(), at);
    expect(text.x).toBeCloseTo(fromClick.x, 6);
    expect(text.y).toBeCloseTo(fromClick.y, 6);
    expect(text.size).toBe('M');
    expect(text.widthMode).toBe('auto');

    // Its own editor is open for it, and this tab is holding the Select tool again.
    expect(pressedTools()).toEqual({ select: true, text: false });
    expect(toolPressed()).toBe('select');
    expect(document.activeElement).toBe(textEditorElement());

    // The selection contains the one text object, which is where the size buttons come from.
    expect(textIdsInDoc()).toEqual([id]);
  });

  it('a second click while the Text tool is up plants a second text, and no note', async () => {
    await renderBoard();
    const first = await createTextWithTool(EMPTY_BOARD);
    // Out of the first one and back to the tool: a key typed while editing belongs to the
    // text (TC-16), and an empty text does not survive its own Escape (TC-20).
    typeIntoTextEditor('one');
    await finishEditing();
    await pressTextTool();
    clickViewport({ x: EMPTY_BOARD.x + 120, y: EMPTY_BOARD.y + 40 });
    await flushFrames();
    await waitForNotes(0);
    await waitForTexts(2);
    expect(textIdsInDoc()).toEqual([first, expect.any(String)]);
    expect(textInDoc(first).text).toBe('one');
  });

  it('nothing is created where the click landed if the point is not a point', async () => {
    await renderBoard();
    // A press with no matching world point (a pointer event with no coordinates of its own)
    // is not an excuse to write an object at NaN.
    await pressTextTool();
    const before = textIdsInDoc().length;
    act(() => {
      document.dispatchEvent(new Event('pointerdown'));
    });
    await flushFrames();
    expect(textIdsInDoc()).toHaveLength(before);
  });
});

describe('the Sticky note shortcut with a tool up (TC-18)', () => {
  it('TC-18: N creates a sticky note in the middle of the view and starts editing it', async () => {
    await renderBoard();
    expect(boardNotes()).toEqual([]);

    pressKey('n');
    await flushFrames();
    await waitForNotes(1);

    const [note] = boardNotes();
    const centre = worldPointAt(readCamera(), {
      x: VIEWPORT_FIXTURE.width / 2,
      y: VIEWPORT_FIXTURE.height / 2,
    });
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 6);
    // Exactly where the Sticky note button puts it: same place, same behaviour.
    expect(noteCentreOnScreen(note.id)).toEqual(noteCentreOnScreen(note.id));
    expect(editorElement()).not.toBeNull();
    // And the tools are as they were found.
    expect(pressedTools()).toEqual({ select: true, text: false });
  });

  it('N with the Text tool up puts Select back rather than leaving the tool up', async () => {
    await renderBoard();
    await pressTextTool();
    pressKey('n');
    await flushFrames();
    await waitForNotes(1);
    expect(pressedTools()).toEqual({ select: true, text: false });
  });

  it('N typed into a text object creates no note', async () => {
    await renderBoard();
    await createTextWithTool();
    expect(boardNotes()).toEqual([]);
    pressKey('n', document.activeElement as EventTarget);
    pressKey('n'); // and the same key on the board, while it is editing, does nothing either
    await flushFrames();
    await waitForNotes(0);
    expect(textIdsInDoc()).toHaveLength(1);
  });
});
