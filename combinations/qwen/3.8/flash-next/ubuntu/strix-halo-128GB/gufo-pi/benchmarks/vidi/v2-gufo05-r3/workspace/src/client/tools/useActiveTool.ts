/**
 * The active tool (story 10).
 *
 * One place owns which tool is active, which shape kind the Shape tool will draw
 * next, and the keys that switch between them. A tool is a *mode*, not an object:
 * switching costs nothing, is not written to the board and is not synced — what
 * two people are drawing is theirs alone.
 *
 * `sticky` is the one entry that does not linger: it puts a note on the board and
 * hands the tool back to Select, because nobody wants to be left in a mode that
 * paints a note on every click. The others stay active until a drawing is done:
 * `toolCreated(id)` is what a tool calls when its object lands, and that selects
 * the new object and returns to Select (`tools.return_to_select`).
 *
 * Replaces story 9's `useTool`, which only knew Select and Text: the shortcuts
 * that lived in `useBoardKeys` are here now, so a story 11 or 12 tool is one entry
 * in `TOOL_SHORTCUTS` and one button, not another key handler.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import type { SelectionApi } from '../board/useSelection';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

export interface ActiveToolApi {
  tool: ToolId;
  /** The kind the Shape tool will draw next. */
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool finished its work: select what it made and go back to Select. */
  toolCreated(id: string): void;
}

/** Single-key tool switches. */
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

/** Tools this build has a key for but no drawing yet, so they are inert. */
export const UNBOUND_TOOLS: readonly ToolId[] = ['comment'];

/** The tools that make something, and so need the board to be editable. */
export function isCreateTool(tool: ToolId): boolean {
  return tool !== 'select';
}

/** Tools that draw a new object by dragging or clicking the board. */
export function isDrawingTool(tool: ToolId): boolean {
  return tool === 'shape' || tool === 'connector' || tool === 'pen';
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
}

/**
 * The active tool for one client.
 *
 * @param options.canEdit - False while the board cannot be changed: Select stays
 *   available, every creating tool is refused (and an active one falls back).
 * @param options.selection - What `toolCreated` puts the new object into.
 * @param options.onCreateSticky - Put a note at the viewport centre. Sticky is an
 *   action rather than a mode, so it is the caller's to perform.
 */
export interface ActiveToolOptions {
  /** False while the board cannot be changed (read-only, or no store yet). */
  canEdit?: boolean;
  /** Selection so `toolCreated(id)` can select the new object. */
  selection?: SelectionApi;
  /** Put a sticky note on the board (N): sticky is an action, not a mode. */
  onCreateSticky?(): void;
  /** Open the image file picker (I): image is an action, not a mode. */
  onOpenImagePicker?(): void;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolApi {
  const { canEdit = true, selection, onCreateSticky, onOpenImagePicker } = options;
  const [tool, setActiveTool] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  // The listener is installed once, so it reads the current values through a ref
  // instead of being torn down and re-installed on every render.
  const live = useRef({ tool, canEdit, selection, onCreateSticky, onOpenImagePicker });
  live.current = { tool, canEdit, selection, onCreateSticky, onOpenImagePicker };

  const setTool = useCallback((next: ToolId): void => {
    // A key this build has no drawing for yet does nothing at all: a tool that is
    // active but paints nothing would take the pointer off the board for no reason.
    if (UNBOUND_TOOLS.includes(next)) return;
    // Choosing a tool is always allowed; making something is not.
    if (isCreateTool(next) && !live.current.canEdit) return;
    if (next === 'sticky') {
      live.current.onCreateSticky?.();
      setActiveTool('select');
      return;
    }
    if (next === 'image') {
      live.current.onOpenImagePicker?.();
      setActiveTool('select');
      return;
    }
    setActiveTool(next);
  }, []);

  const toolCreated = useCallback((id: string): void => {
    // `click` rather than `setMany`: the object was created a moment ago and is not
    // in this screen's snapshot yet, and a fresh selection is what is wanted.
    live.current.selection?.click(id);
    setActiveTool('select');
  }, []);

  // Losing the right to edit while a creating tool is up must not leave a tool
  // that draws nothing on the board.
  useEffect(() => {
    if (!canEdit) {
      setActiveTool((current) => (isCreateTool(current) ? 'select' : current));
    }
  }, [canEdit]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') {
        // Only while a tool is up: `useBoardKeys` handles Escape's other jobs, and
        // taking the key away from it would break clearing the selection.
        if (live.current.tool !== 'select') {
          event.preventDefault();
          setActiveTool('select');
        }
        return;
      }
      const next = TOOL_SHORTCUTS[key];
      if (!next) return;
      event.preventDefault();
      setTool(next);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
