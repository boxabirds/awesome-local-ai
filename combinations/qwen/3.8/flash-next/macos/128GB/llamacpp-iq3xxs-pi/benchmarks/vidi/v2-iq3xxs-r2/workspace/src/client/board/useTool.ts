import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The board's tool mode (story 9, `text.tool_mode`).
 *
 * A tool is not a mode the document knows about: which tool this tab is on, like its
 * selection, belongs to this tab alone, and a board with six people has six tools on it.
 * Nothing here writes to the document — creating the text is the board's business, and the
 * tool only decides *where* the next click goes.
 */

/** The two pointer modes; the Sticky note button is an action, not a mode (see below). */
export type Tool = 'select' | 'text';

/** What the board looks like when it opens, after Escape, and after a text is placed. */
export const DEFAULT_TOOL: Tool = 'select';

/** The single letters that choose a tool — and one that does something else entirely. */
export type ToolShortcut = Tool | 'sticky';

/**
 * Which tool the key `key` asks for, or null when it asked for none of them. Uppercase
 * counts: Shift+T is still the Text tool.
 *
 * `n` is listed here because it belongs to the same family — the story 2 Sticky note button,
 * which this story gives a shortcut of its own — and a key that changes the tool and a key
 * that creates an object must be translated by one map, not by two that can disagree about
 * what `v` means. It is not a `Tool`: the Sticky note button stays an action that creates one
 * note, and pressing `n` while the Text tool is up switches back to Select first (TC-17), or
 * the next click would plant a text where that note's heading is being typed.
 */
export function toolForShortcut(key: string): ToolShortcut | null {
  switch (key.toLowerCase()) {
    case 'v':
      return 'select';
    case 't':
      return 'text';
    case 'n':
      return 'sticky';
    default:
      return null;
  }
}

/** What the board may do with the tool. */
export interface ToolControls {
  readonly tool: Tool;
  setTool(tool: Tool): void;
  /**
   * A plain `v`, `t` or `n` typed at the board (`text.tool_mode`, and the Sticky note
   * shortcut this story introduces). True when `key` was one of those, so the caller knows
   * whether the key is spent.
   */
  press(key: string): boolean;
}

export interface ToolOptions {
  /** A board that could not be loaded takes the Text tool away (TC-15). */
  readonly canEdit: boolean;
  /** What `n` does: create a note where the board keeps notes. */
  onCreateSticky(): void;
}

/**
 * The current tool, in React state — never in the document.
 *
 * `press` returns whether the key was a tool shortcut, because a key the keyboard hook has
 * to pass on (a `t` typed into a text, an arrow, a `v` in somebody's name field) must stay
 * un-prevented for whatever it belongs to.
 *
 * `canEdit` rules the Text tool twice over: `t` is recognised but refused while the board
 * cannot be written to (a tool whose whole job is to write something would otherwise sit
 * active over a board that answers nothing), and a Text tool that was up when the board
 * stopped being editable is taken back to Select.
 */
export function useTool({ canEdit, onCreateSticky }: ToolOptions): ToolControls {
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL);

  useEffect(() => {
    if (!canEdit) setTool(DEFAULT_TOOL);
  }, [canEdit]);

  const press = useCallback(
    (key: string): boolean => {
      const shortcut = toolForShortcut(key);
      if (shortcut === null) return false;
      if (shortcut === 'text') {
        // Recognised, and refused: the key is spent, the tool is not.
        if (canEdit) setTool('text');
        return true;
      }
      // Both `v` and `n` leave the Text tool behind: `n` because a tool still up after it
      // made a note would write its next click over that note.
      setTool(DEFAULT_TOOL);
      if (shortcut === 'sticky') onCreateSticky();
      return true;
    },
    [canEdit, onCreateSticky],
  );

  return useMemo(() => ({ tool, setTool, press }), [tool, press]);
}
