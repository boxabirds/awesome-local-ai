/**
 * Which tool the pointer is, right now.
 *
 * A board has two of them in this story, and the reason for having any at all is one particular moment: a
 * person who wants a heading in the middle of a busy board has to say *text goes here* somehow, and every
 * other way of saying it is worse. Double-clicking is the sticky note's way and it cannot be reused — the
 * board is already double-clicked at to make a note, and a board where one gesture makes two different
 * objects is a board nobody learns. A mode the pointer is in costs one keypress, is visible in the toolbar
 * while it lasts, and says "the next click is a placement" before the click.
 *
 * **One placement, then it steps aside.** After the click that puts text down, the tool is Select again. A
 * mode that stayed armed would be a board that keeps making empty text objects at every click, which is
 * the mistake repeated instead of the intention followed; and the person who placed a heading is, in the
 * moment after placing it, wanting to move it or type in it — both of which are Select jobs.
 *
 * **The keys are window listeners, registered before the board's own.** `V` and `T` are single letters, and
 * single letters collide with nothing except each other; but Escape is shared, and the order matters. When
 * the text tool is armed, Escape means *stop meaning that* and nothing else — it must not also clear the
 * selection behind it, because a person who backs out of a tool has not said anything about what is
 * selected. Being first, and stopping the key there, is what keeps one keypress to one meaning.
 *
 * **Typing wins over everything.** While the focus is in a textarea — a note's, or a piece of text's own —
 * every key is a character, and no shortcut is more important than the letter somebody is pressing. The
 * `T` that turns the text tool on is a `t` in a heading when the heading is open for typing, and the tool
 * does not move.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isTypingTarget } from './useBoardKeys';

/** The two tools the pointer can be put in. Select is not a tool so much as the absence of one. */
export type BoardTool = 'select' | 'text';

export interface BoardToolState {
  tool: BoardTool;
  /** The toolbar's buttons, and nothing else: the keyboard goes through the listener below. */
  selectTool(): void;
  textTool(): void;
  /**
   * The text tool placed something, so it is done.
   *
   * Separate from `selectTool` because it answers a different question: one is a person choosing Select,
   * the other is a tool having finished its job. They happen to do the same thing today, and saying both
   * is what lets the board step aside after a placement without pretending somebody pressed `V`.
   */
  usedTextTool(): void;
}

/** Keys that choose a tool, whatever else they might mean. */
const TOOL_KEYS: Record<string, BoardTool> = {
  v: 'select',
  t: 'text',
};

/**
 * The board's tool, and the keys that change it.
 *
 * `canEdit` is not a display setting: on a board this person cannot write to, the text tool is a promise
 * that a click will create something, and a promise that will not be kept is worse than no promise. So the
 * button is disabled, the key does nothing, and a tool that was armed when editing was taken away is
 * dropped — a person who loses the right to write should not be left holding a cursor that looks like it
 * still has one.
 */
export function useTool(canEdit: boolean): BoardToolState {
  const [tool, setTool] = useState<BoardTool>('select');

  // Read from refs inside the listener, which is installed once: the key that is pressed belongs to the
  // board that is open now, and a listener carrying a stale `canEdit` would answer a keypress with a
  // permission that has since changed.
  const armed = useRef(tool);
  armed.current = tool;
  const editable = useRef(canEdit);
  editable.current = canEdit;

  const selectTool = useCallback((): void => {
    setTool('select');
  }, []);

  const textTool = useCallback((): void => {
    // A board that cannot be written to has no text to place, and arming the tool would say otherwise.
    setTool(editable.current ? 'text' : 'select');
  }, []);

  const usedTextTool = useCallback((): void => {
    setTool('select');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Whoever has the focus has the keys. This is the rule the whole board follows, and the tool is not
      // an exception to it: while a piece of text is open for typing, `t` is a letter.
      if (isTypingTarget(event.target)) return;
      // A command key means the keystroke belongs to something else — Ctrl+T is a browser tab, and a tool
      // that stole it would be a tool that stops people opening boards in new tabs.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        // Escape is the one key shared with the board's own shortcuts, and while the text tool is armed it
        // is this tool's to answer — and the answer stops here, so the same press does not also clear the
        // selection. When the tool is Select, Escape was never the tool's business and it travels on.
        if (armed.current !== 'text') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        selectTool();
        return;
      }

      const wanted = TOOL_KEYS[event.key.toLowerCase()];
      if (wanted === undefined) return;
      if (!editable.current) return;

      event.preventDefault();
      // The board's other shortcuts are registered on the same window and come after this one; a tool key
      // that travelled on would be a keypress with two answers, which is how one key ends up doing two
      // things the person pressing it did not ask for.
      event.stopImmediatePropagation();
      if (wanted === 'text') textTool();
      else selectTool();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectTool, textTool]);

  // Editing taken away mid-tool: the tool goes back on its own, rather than staying armed and offering a
  // click that goes nowhere.
  useEffect(() => {
    if (!canEdit && armed.current !== 'select') setTool('select');
  }, [canEdit]);

  return { tool, selectTool, textTool, usedTextTool };
}
