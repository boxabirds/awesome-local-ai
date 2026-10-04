import { useCallback, useEffect, useRef, useState } from 'react';
import { isTextEntryTarget } from '../board/useBoardKeys';
import type { ShapeKind } from '../../shared/config';
import { isShapeKind } from '../../shared/config';

/** Every tool the board names, including the ones later stories will fill in. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/**
 * The single-letter shortcuts, letter first.
 *
 * This is the board's whole keyboard vocabulary in one place, which is why it is exported: the
 * toolbar prints the letter in the button's label, and a shortcut that only existed inside a
 * `switch` would be a shortcut nobody could check. Story 10 adds `s` and `l`; the rest are the
 * keys the other stories of this PRD will want, written down once so that two stories do not
 * discover each other's letter in the same release.
 */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

/** The letter a tool is reached by, or `null` for a tool nobody gave a key. */
export function shortcutFor(tool: ToolId): string | null {
  for (const [key, value] of Object.entries(TOOL_SHORTCUTS)) {
    if (value === tool) {
      return key;
    }
  }
  return null;
}

/** The tools that put something on the board, and so need a board they may write to. */
export const WRITING_TOOLS: readonly ToolId[] = [
  'sticky',
  'text',
  'shape',
  'connector',
  'pen',
  'image',
  'comment',
];

/**
 * The tools this build has a button, a component and a behaviour for.
 *
 * `sticky` is missing on purpose. It is the one tool whose key does something other than arm
 * itself: N makes a note where the board is looking at (story 2), which is a friendlier thing than
 * a tool that has to be pointed, and a board with two answers to one key is a board where one of
 * them is a lie. It is still in {@link TOOL_SHORTCUTS} because the map is the keyboard's map, not
 * the set of armed tools. `pen` joins the list in story 11, and is the first tool that does not put
 * itself away when it has made a thing. `image` and `comment` are missing because nothing in this
 * build draws them: a shortcut that armed a tool with no behaviour behind it would leave the
 * pointer doing nothing at all, which is worse than the key doing nothing.
 */
export const DEFAULT_AVAILABLE_TOOLS: readonly ToolId[] = [
  'select',
  'text',
  'shape',
  'connector',
  'pen',
];

/** The tool a board starts in, and returns to: pointing at things rather than making them. */
export const DEFAULT_TOOL: ToolId = 'select';
/** The kind a Shape tool with nothing chosen yet draws. */
export const DEFAULT_SHAPE_KIND: ShapeKind = 'rect';

export interface ActiveToolOptions {
  /**
   * Whether this board may be written to. A board that cannot be does not take a writing tool:
   * the key is left to the browser rather than being swallowed by a tool that could not have been
   * used, which is the rule story 9 set for T.
   */
  canEdit?: boolean;
  /** The tools to offer; anything else is not armed by a click or by a key. */
  availableTools?: readonly ToolId[];
  /**
   * Whether this person is typing into an object right now. While they are, the letters and Escape
   * belong to the text: the same rule the board's own keys follow, and for the same reason - a
   * shortcut that fires while a caret is blinking in a field is a shortcut that typed over the caret.
   */
  editing?: boolean;
  /**
   * Make this object the selection. `toolCreated` needs it and cannot decide it alone: the
   * selection belongs to the board (story 7), and this hook only knows that the board should have
   * the new object in it. Left out, `toolCreated` still puts the tool back to Select.
   */
  onSelect?(id: string): void;
}

export interface ActiveTool {
  tool: ToolId;
  /** Which shape the Shape tool will draw next; remembered between drawings. */
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** A thing was just made by a tool: it becomes the selection, and the tool goes back to Select. */
  toolCreated(id: string): void;
}

/**
 * Which tool is up, which shape the Shape tool is set to, and the two rules that go with them.
 *
 * Both rules are here rather than in the toolbar because neither is a fact about a button. The
 * first is that a tool which writes to the board is not available on a board that cannot be
 * written to - so the toolbar can show it pressed and the pointer can be pointing at nothing,
 * which is what a board that refused the tool must not do. The second is that a tool which has
 * made its thing is done with: the new object is selected so it can be adjusted, and the tool
 * returns to Select, so the next click is a click on the board and not a second object nobody
 * meant to draw. That is what {@link ActiveTool.toolCreated} is for, and every creating tool calls
 * it rather than deciding the same thing separately.
 *
 * The keys are listened for on the window, alongside the selection's keys (story 7) and the
 * editor's own. Two handlers answer V and T, and that is not a contradiction: both of them route
 * to this hook, so both of them arrive at the same tool, and the second call is a state change to
 * the value the state already holds. `n` is answered once, by the selection's handler, because
 * what it does is make a note.
 */
export function useActiveTool(options: ActiveToolOptions = {}): ActiveTool {
  const { canEdit = true, availableTools = DEFAULT_AVAILABLE_TOOLS, editing = false, onSelect } =
    options;
  const [tool, setToolState] = useState<ToolId>(DEFAULT_TOOL);
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  // The keys are handled in a listener that is installed once, so it reads the current rules from
  // a ref instead of from a copy of them taken on the day it was installed.
  const rulesRef = useRef({ canEdit, availableTools, editing });
  useEffect(() => {
    rulesRef.current = { canEdit, availableTools, editing };
  });

  const setTool = useCallback(
    (wanted: ToolId): void => {
      const rules = rulesRef.current;
      if (!rules.availableTools.includes(wanted)) {
        // Not a tool this board has. Ignored rather than refused loudly: a key the board has no
        // tool for should stay the browser's key, and a click on a button that is not there is not
        // something this can be blamed for.
        return;
      }
      if (WRITING_TOOLS.includes(wanted) && !rules.canEdit) {
        // A board that cannot be written to keeps Select up. The tool that was up before stays
        // where it was asked for, which is nowhere: what is on screen is a tool that works.
        setToolState('select');
        return;
      }
      setToolState(wanted);
    },
    [],
  );

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    // An unknown kind is not remembered: the tool would draw nothing, and a tool that draws nothing
    // looks broken rather than misinformed.
    if (isShapeKind(kind)) {
      setShapeKindState(kind);
    }
  }, []);

  // The board stopped being writable while a writing tool was up - a connection dropped into a
  // state where the document cannot be trusted. The tool comes down by itself: a pointer that is
  // about to draw a shape on a board that will not take it is a promise this cannot keep.
  useEffect(() => {
    if (!canEdit) {
      setToolState((current) => (WRITING_TOOLS.includes(current) ? 'select' : current));
    }
  }, [canEdit]);

  const toolCreated = useCallback(
    (id: string): void => {
      if (typeof id !== 'string' || id === '') {
        // Nothing was made, so there is nothing to select. The tool is put back anyway: the tool
        // asked to be done with, and a half-made thing is still a thing that is finished.
        setToolState('select');
        return;
      }
      onSelect?.(id);
      setToolState('select');
    },
    [onSelect],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Somebody is writing. The letters belong to the text, all of them, including the ones that
      // name tools - which is the difference between a shortcut and a nuisance. Asked twice, once of
      // the event and once of the board, because a field that is open somewhere on the board does not
      // always have the keyboard of the element the key was pressed on.
      if (isTextEntryTarget(event.target) || rulesRef.current.editing) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        // With a modifier down the key belongs to the browser: Cmd-T is a new tab, and a board that
        // took it would be a board that stole a key nobody offered it.
        return;
      }
      if (event.key === 'Escape') {
        // Whatever was being armed is finished with. This is the same answer the selection's Escape
        // gives, and an unfinished drag is dropped by the tool that owns it (design, tools.active_tool).
        setToolState('select');
        return;
      }
      const toolFor = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (toolFor === undefined) {
        return;
      }
      const rules = rulesRef.current;
      if (!rules.availableTools.includes(toolFor)) {
        return;
      }
      if (WRITING_TOOLS.includes(toolFor) && !rules.canEdit) {
        return;
      }
      event.preventDefault();
      setToolState(toolFor);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
