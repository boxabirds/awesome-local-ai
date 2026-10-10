import { useCallback, useMemo, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';
import { DEFAULT_SHAPE_KIND } from '../../shared/objects/shape';
import { useTool, type Tool, type ToolControls } from '../board/useTool';

/**
 * The tool this tab's pointer is on, and the one-letter keys that choose it
 * (`tools.active_tool`).
 *
 * Story 9 started this hook as `useTool`, with the two tools it needed; story 10 adds the
 * Shape and Connector tools to it and keeps the design's name for the hook here. What is
 * shared with `useTool` stays there (the state, and the rules about what a board that cannot
 * be edited may switch to); what is added here is the Shape menu's kind and the rule that a
 * tool which has just made something hands the pointer back to Select holding that thing
 * selected (`tools.return_to_select`).
 *
 * Like the selection, a tool is local: nothing in this file touches the document, and a
 * board with six people has six tools on it.
 */

/**
 * Every tool id in the product, including the ones this build has not got to yet — the
 * shortcuts below are the cross-story convention, so `i` and `c` are already spoken for even
 * while nothing answers them.
 */
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
 * The single letters that ask for a tool, in the order the PRD lists them. `sticky` is in
 * the map because it belongs to the same family — a letter that puts something on the board
 * — but it is an action, not a mode: it makes one note and leaves the tool where it was.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

/**
 * The tools that are modes the pointer can sit in, as opposed to `sticky`, which acts.
 *
 * `pen` is in the list even though it is the one tool that does not hand the pointer back to
 * Select when it has made something (`pen.stay_active`): being a mode and going away afterwards
 * are two different things, and only the second one is what this list is about.
 */
export const POINTER_TOOL_IDS: readonly ToolId[] = ['select', 'text', 'shape', 'connector', 'pen'];

/**
 * Which tool the key `key` asks for, or null when it asked for none of them. Uppercase
 * counts: Shift+S is still the Shape tool. A letter reserved for a tool this build does not
 * have answers null, so the key keeps belonging to whatever it was pressed in.
 */
export function toolIdForShortcut(key: string): ToolId | null {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const id = TOOL_SHORTCUTS[key.toLowerCase()];
  return id ?? null;
}

/** Is `id` a tool this build can put the pointer on? */
export function isPointerTool(id: ToolId | null): id is Tool {
  return id !== null && (POINTER_TOOL_IDS as readonly string[]).includes(id);
}

export interface ActiveToolOptions {
  /** A board that could not be loaded refuses the tools that would write to it (TC-15). */
  readonly canEdit: boolean;
  /** What `n` does: create a note where the board keeps notes. */
  onCreateSticky(): void;
  /** Makes this just-created object the whole selection (`toolCreated`). */
  onSelectOnly(id: string): void;
  /**
   * What `i` and the Image button do (`image.pick`): open the system's file picker. Story 12's
   * Image tool is not a pointer mode — no later click puts anything down — so it has no place
   * in `Tool`, and its letter only ever means this one action.
   */
  onImageTool?(): void;
}

export interface ActiveToolControls extends ToolControls {
  /** Which kind of shape the next Shape drag makes; the Shape menu sets it (TC-24). */
  readonly shapeKind: ShapeKind;
  setShapeKind(kind: ShapeKind): void;
  /**
   * The tool that just made `id` is finished with: it becomes the only selected object and
   * the pointer goes back to Select (`tools.return_to_select`, TC-22).
   */
  toolCreated(id: string): void;
  /**
   * The Image button, or `i` — the same thing either way, which is what a one-letter shortcut
   * table is for (`tools.active_tool`).
   */
  imageTool(): void;
}

/**
 * The current tool plus the two things story 10 adds to it. `tool` is a `Tool`, not a
 * `ToolId`: the ids of tools this build does not have are not reachable through this hook,
 * only through the shortcut map above.
 */
export function useActiveTool({
  canEdit,
  onCreateSticky,
  onSelectOnly,
  onImageTool,
}: ActiveToolOptions): ActiveToolControls {
  const { tool, setTool, press: pressToolShortcut } = useTool({ canEdit, onCreateSticky });
  // Not persisted: which kind of shape this tab is about to draw is as local, and as
  // short-lived, as the tool itself.
  const [shapeKind, setShapeKind] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  const toolCreated = useCallback(
    (id: string): void => {
      // Selected first, tool switched second: the new object is what the selection bar and
      // the shape toolbar are about the moment the click that made it is over.
      onSelectOnly(id);
      setTool('select');
    },
    [onSelectOnly, setTool],
  );

  /**
   * `i` is spent on the Image tool even though no pointer ever sits on it. The letter is in
   * the shortcut table so that `v`, `n` and `i` are all translated by one map, and a letter
   * that opened a picker in one build and did nothing in another would be a letter nobody
   * could rely on. The tool goes back to Select on the way there, because `image.pick` asks
   * for that: a Pen still up when the picker closed would draw a stroke across the new image.
   */
  const imageTool = useCallback((): void => {
    setTool('select');
    onImageTool?.();
  }, [onImageTool, setTool]);

  const press = useCallback(
    (key: string): boolean => {
      if (toolIdForShortcut(key) === 'image') {
        imageTool();
        return true;
      }
      return pressToolShortcut(key);
    },
    [imageTool, pressToolShortcut],
  );

  return useMemo(
    () => ({ tool, setTool, press, shapeKind, setShapeKind, toolCreated, imageTool }),
    [tool, setTool, press, shapeKind, setShapeKind, toolCreated, imageTool],
  );
}
