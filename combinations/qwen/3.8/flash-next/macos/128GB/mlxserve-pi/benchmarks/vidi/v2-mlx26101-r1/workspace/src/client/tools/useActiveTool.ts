// The tool this tab is holding, and the keyboard that changes it (stories 9 and 10).
//
// Which tool one person is holding is theirs alone: it is React state, never a write
// to the shared document, so it must never appear on anyone else's screen. What this
// module adds over story 9's two tools is the *shape kind* (the Shape button's small
// menu remembers Rectangle / Ellipse / Diamond) and the rule every tool obeys:
// `toolCreated(id)` makes what was just drawn the only selected object and hands the
// board back to Select, so a new shape or arrow can be adjusted straight away
// (tools.return_to_select). The Pen tool (story 11) is the one tool that does not obey that
// rule, and it escapes it by never calling it: a sketch is several strokes long, and a tool that
// handed the board back after each one would make a person pick the pen up as many times as they
// drew (pen.stay_active). No flag exists here for it — the absence of a call is the mechanism.
//
// The keyboard half owns the tool letters — V select, T text, N a sticky note, S the
// Shape tool, L the Connector tool, P the Pen — and Escape's return to Select. Every one of them
// is ignored while a text field owns the keyboard, which is the shared guard in
// `../board/typingGuard`: typing the word "save" into a shape label must not colour a
// shape, switch a tool and create a note, one letter at a time. The letters are chosen
// to be free: no browser takes them without a modifier, and a modifier chord (Cmd+S,
// Cmd+T) is never a tool letter here.
//
// `canEdit` is the only lock a tool respects: a board that could not be loaded cannot
// hold a creating tool, so asking for one is ignored and — if the board *becomes*
// uneditable mid-tool — the tool falls back to Select.

import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import { DEFAULT_SHAPE_KIND } from '../../shared/config';
import { typingOwnsKeys, useWindowKeyDown } from '../board/typingGuard';
import type { SelectionApi } from '../board/useSelection';

/**
 * The tools this app has. Story 12 adds `image` and `comment` to this
 * union; `select` is what every tool returns to, and `sticky` is deliberately not a
 * tool — the Sticky note button and N are one-shot actions, not a mode.
 */
export type ToolId = 'select' | 'text' | 'shape' | 'connector' | 'pen';

export interface ActiveToolApi {
  /** The tool currently held. */
  tool: ToolId;
  /** Which kind the Shape tool will draw next (Rectangle until the menu says else). */
  shapeKind: ShapeKind;
  /** Hold `tool`. Asking for a creating tool while the board cannot be edited is ignored. */
  setTool(t: ToolId): void;
  /** Remember the kind the Shape menu offers (kept after a shape is drawn). */
  setShapeKind(kind: ShapeKind): void;
  /**
   * The tool just created `id`: it becomes the only selected object and the board
   * returns to Select (tools.return_to_select). Returns nothing: by then the tool has
   * no business left to do.
   */
  toolCreated(id: string): void;
}

export interface ActiveToolOptions {
  /** Whether this board can be edited at all (`load_failed` locks the tools out). */
  canEdit: boolean;
  /** The tab's selection, so a created object can be selected by `toolCreated`. */
  selection: SelectionApi;
  /** N / the toolbar button: create a sticky note at the centre of the view. */
  onCreateSticky?(): void;
}

/** A letter that names a tool, with no modifier in the way. */
const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
};

/**
 * The active tool, its shape kind and its keyboard. The listener is bound once per
 * mount and reads the current values through a closure that is refreshed every render
 * (see `useWindowKeyDown`), so holding a tool never re-subscribes the window.
 */
export function useActiveTool(opts: ActiveToolOptions): ActiveToolApi {
  const { canEdit, selection, onCreateSticky } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  const setTool = useCallback(
    (t: ToolId): void => {
      // Only a tool that would create something needs an editable board; Select is
      // always available, and is what a board that cannot be edited is stuck with.
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  // A board that stops being editable mid-tool drops any creating tool.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const toolCreated = useCallback(
    (id: string): void => {
      selection.setMany([id], false);
      setToolState('select');
    },
    [selection],
  );

  // The listener reads the current `canEdit`, `onCreateSticky` and `tool` through the
  // closure `useWindowKeyDown` refreshes on every render, so holding a tool never
  // re-subscribes the window and no keystroke sees a stale value.
  useWindowKeyDown((e) => {
    // A keystroke that belongs to somebody's text is not a shortcut, and never was:
    // the guard also covers the tail of a burst whose field has just been deleted
    // under us. Escape and the chords are not characters, so leaving an edit with
    // Escape and then pressing a tool letter still works.
    if (typingOwnsKeys(e)) return;

    const key = e.key;

    if (key === 'Escape') {
      // Escape ends the tool — including an unfinished drag, whose listeners leave
      // with the tool and so create nothing at all (TC-22). The selection's own
      // Escape (story 7, in useBoardKeys) runs from its own listener: both see the
      // key, and the two together are "put the board down".
      if (tool !== 'select') {
        e.preventDefault();
        setToolState('select');
      }
      return;
    }

    if (key === 'n' || key === 'N') {
      // The same action as the story 2 button, and only on a board that can be drawn
      // on: this creates an object, unlike a tool letter.
      if (!canEdit || !onCreateSticky) return;
      e.preventDefault();
      onCreateSticky();
      return;
    }

    // A chord is not a tool letter. Cmd+S is the browser's save, Cmd+T a new tab and
    // Cmd+L its address bar: taking the letter out of a chord would steal all three, and
    // the same is true of Ctrl and Alt. Shift is not a chord here — Shift+S is 'S'.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const toolFor = TOOL_KEYS[key.length === 1 ? key.toLowerCase() : ''];
    if (toolFor === undefined) return;
    // V always works, even on a board that cannot be edited: it only ever *stops*
    // something. The creating tools are offered only when they could be used.
    if (toolFor !== 'select' && !canEdit) return;
    e.preventDefault();
    setToolState(toolFor);
  });

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
