// Which tool the pointer holds (stories 9-12), in one hook every story adds a
// tool to. Story 9 had two tools and a boolean would have done; story 10 adds a
// shape tool and a connector tool, so the tool is a name in a state now.
//
// This hook owns the state and nothing else. The keys are bound in useBoardKeys -
// V, S, T, L and Escape back to Select - because that hook already owns the one
// window keydown listener and the guard that keeps every keystroke the caret has
// away from the board. A listener per hook would have to duplicate that guard, and
// a key that fires while the user is typing is exactly the bug story 2 already had
// to fix once.
//
// Two rules hold the tool honest:
//   - a tool is a state of the SCREEN, never of the document: nothing here is
//     persisted and nothing here reaches another client;
//   - a tool that creates something hands the new object to `toolCreated`, which
//     selects it and gives the pointer back to Select, so the thing just drawn can
//     be adjusted without reaching for the toolbar (PRD `tools.return_to_select`).
//     The Pen tool is the one tool that asks for neither: it selects the stroke it
//     finished and stays held, because drawing the next line is what a person
//     holding a pen does next (story 11).
//
// A board that cannot be edited has no tools to hold, so setting one does nothing
// and holding one does not survive the board becoming uneditable.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SHAPE_KIND,
  SHAPE_KINDS,
  type ShapeKind,
} from '../../shared/config';

/** Every tool name this build knows, including the ones not shipped yet. */
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
 * The letter each tool answers to, from the cross-story convention: V select,
 * N sticky, T text, S shape, L connector, P pen, I image, C comment. `sticky` is
 * the odd one: N does not hold a tool, it makes a note where the view is (story 9),
 * so it is named here for the record and is deliberately not a tool to hold.
 */
const TOOL_KEYS: Readonly<Record<ToolId, string>> = {
  select: 'v',
  sticky: 'n',
  text: 't',
  shape: 's',
  connector: 'l',
  pen: 'p',
  image: 'i',
  comment: 'c',
};

/** Key (lower case) to tool. Keys no tool answers to are simply absent. */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = Object.freeze(
  Object.fromEntries((Object.entries(TOOL_KEYS) as [ToolId, string][]).map(([tool, key]) => [key, tool])),
);

/**
 * The tools this build ships, in the order the toolbar shows them. A key that
 * names a tool that is not here does nothing: a board left holding a tool with
 * nothing to render it would eat the next click and make nothing happen, which is
 * worse than a key that does nothing.
 */
export const SHIPPED_TOOLS: readonly ToolId[] = Object.freeze([
  'select',
  'shape',
  'text',
  'connector',
  'pen',
]);

/** The word the button says, before its key. */
const TOOL_NAMES: Readonly<Record<ToolId, string>> = {
  select: 'Select',
  sticky: 'Sticky note',
  text: 'Text',
  shape: 'Shape',
  connector: 'Connector',
  pen: 'Pen',
  image: 'Image',
  comment: 'Comment',
};

/** The accessible name of a tool button: what it is, and the key that holds it. */
export function toolLabel(tool: ToolId): string {
  return `${TOOL_NAMES[tool]} (${TOOL_KEYS[tool].toUpperCase()})`;
}

/** The tool a key names, or null when it names no tool this build can hold. */
export function toolIdForKey(key: string): ToolId | null {
  const tool = TOOL_SHORTCUTS[key.toLowerCase()];
  return tool !== undefined && SHIPPED_TOOLS.includes(tool) ? tool : null;
}

export interface ActiveToolState {
  tool: ToolId;
  /** The kind the next shape is drawn as; only the Shape menu can change it. */
  shapeKind: ShapeKind;
  /** Whether the tool may make a thing at all (a read-only board may not). */
  canCreate: boolean;
  /** Ignored while the board cannot be edited; a board always keeps Select. */
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /**
   * A thing was just created: it becomes the only selected object and the tool
   * goes back to Select. Given nothing - a create that was refused - it does
   * nothing at all, so a rejected drag leaves the tool held.
   */
  toolCreated(id: string | null): void;
}

export interface UseActiveToolOptions {
  /** Whether this board takes changes at all. Default true. */
  canEdit?: boolean;
  /** Select one object, the way the board's own selection state does. */
  select?(id: string): void;
}

export function useActiveTool(options: UseActiveToolOptions = {}): ActiveToolState {
  const canEdit = options.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  // The newest selection call, so a create that finishes mid-render never hands
  // the new object to the selection hook of an earlier render.
  const selectRef = useRef(options.select);
  selectRef.current = options.select;

  const setTool = useCallback(
    (next: ToolId): void => {
      if (!canEdit) return;
      // A tool this build does not ship cannot be held.
      setToolState(SHIPPED_TOOLS.includes(next) ? next : 'select');
    },
    [canEdit],
  );

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    if (SHAPE_KINDS.includes(kind)) setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string | null): void => {
    if (typeof id !== 'string' || id === '') return;
    selectRef.current?.(id);
    setToolState('select');
  }, []);

  // A board that stops being editable mid-session - the room lost it, the link
  // went - cannot be left holding a tool that would do nothing with the next
  // click. Select is the state that says "nothing is being placed".
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return {
    tool,
    shapeKind,
    canCreate: canEdit,
    setTool,
    setShapeKind,
    toolCreated,
  };
}
