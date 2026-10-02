// Which tool the board is in, and the keys that change it (design section 5.1).
//
// It is deliberately a plain value rather than a mode with behaviour attached:
// the tool chooses what the next creation becomes and nothing else — not where
// the camera is, not what is selected, not what is being edited — so leaving it
// is one assignment whatever else happens to be going on. The board stays in
// Select mode after anything the Text tool creates, so there is no "back to
// Select" step for a key to perform and no stale mode to reset — except for the
// Pen tool, which is left where it is after every stroke, because a pen that was
// put away after each line would be a pen that had to be picked up again to finish
// a drawing. That is the tool's own behaviour, not this state's: this only says
// which tool the board is in, and the board says what happens next.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

/** The tools a key or the toolbar can put the board in. */
export type BoardTool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

/** What a key press means to the board's tool state. */
export type ToolKey = BoardTool | 'sticky' | 'exit' | null;

/**
 * The key that selects a tool, as the design's "Key" column has it.
 *
 * 'n' is not in it: it makes a sticky note, which is an action rather than a
 * tool, so it stays a key of its own that the board carries out.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, BoardTool>> = Object.freeze({
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
});

/**
 * The key that selects a tool, or null for every other key.
 *
 * 'n' is not a tool: it makes a sticky note, which is an action, so it is
 * reported to the board to carry out and leaves the tool where it was — except
 * that making a note is a creation, and a board that has just created something
 * is in Select again.
 */
export function toolKey(key: string, modifiers?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ToolKey {
  if (modifiers?.ctrlKey === true || modifiers?.metaKey === true || modifiers?.altKey === true) return null;
  if (key === 'n' || key === 'N') return 'sticky';
  if (key === 'Escape') return 'exit';
  const tool = TOOL_SHORTCUTS[key.toLowerCase()];
  return tool ?? null;
}

export interface UseToolResult {
  tool: BoardTool;
  /** Put the board in a tool, leaving whatever was being edited alone. */
  setTool(next: BoardTool): void;
  /** The kind the Shape tool will draw next, remembered between drawings. */
  shapeKind: ShapeKind;
  /** Choose a kind from the Shape menu. It does not leave the tool it is in. */
  setShapeKind(kind: ShapeKind): void;
  /** V / T / S / L / P / N / Escape. Nothing else, and nothing at all while something
   * has the keyboard for typing: a letter a person is typing is not a shortcut. */
  onKeyDown(e: KeyboardEvent): void;
}
/** Whether the keyboard belongs to something being typed into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * The board's tool state.
 *
 * `canEdit` is a parameter rather than the caller's business because a tool that
 * cannot be used must not merely look unused: a board that failed to load has no
 * Text tool to be in, so it is put back in Select and T does nothing at all until
 * the board can be written again.
 */
export function useTool(canEdit = true, onCreateSticky?: () => void): UseToolResult {
  const [tool, setToolState] = useState<BoardTool>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const can = canEdit !== false;

  const setTool = useCallback((next: BoardTool) => {
    setToolState(next);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    setShapeKindState(kind);
  }, []);

  useEffect(() => {
    if (!can) setToolState('select');
  }, [can]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const key = toolKey(e.key, e);
      if (key === null) return;
      // 'v' typed into a text object is the letter v: the editor keeps its keys,
      // and so do its Delete, Backspace and Enter, untouched.
      if (isTypingTarget(e.target)) return;
      if (!can) return;
      if (key === 'sticky') {
        setToolState('select');
        onCreateSticky?.();
        return;
      }
      if (key === 'exit') {
        // Escape leaves the tool and creates nothing; when a text object was
        // being edited this key never reaches here at all, because the editor
        // takes it first and the target is its own textarea.
        setToolState('select');
        return;
      }
      setToolState(key);
    },
    [can, onCreateSticky],
  );

  return { tool, setTool, shapeKind, setShapeKind, onKeyDown };
}

/**
 * The tool keys on a listener of their own, for the one keyboard path that must
 * not be disturbed by anything else on the page: an object's own editor stops the
 * key event it handles, and the sticky editor keeps its Ctrl+Z, Delete and Escape
 * behaviour exactly as story 8 left it.
 */
export function useToolKeys(canEdit: boolean, onCreateSticky?: () => void): ReturnType<typeof useTool> {
  const result = useTool(canEdit, onCreateSticky);
  const handler = useRef(result.onKeyDown);
  handler.current = result.onKeyDown;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => handler.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return result;
}
