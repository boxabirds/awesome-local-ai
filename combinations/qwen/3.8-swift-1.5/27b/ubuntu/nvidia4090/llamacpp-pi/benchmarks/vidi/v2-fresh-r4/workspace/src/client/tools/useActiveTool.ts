/**
 * Active board tool state (story 10; replaces the story 9 `isTextTool` flag).
 *
 * Cross-story tool conventions:
 *   - `ToolId` is the union of all tool ids across stories.
 *   - `TOOL_SHORTCUTS` maps single letters to tools.
 *   - `Escape` always returns to the Select tool.
 *   - `toolCreated` selects the new object, switches back to Select and closes
 *     the undo capture window (one undo step = one created object).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Single-letter tool shortcuts (cross-story convention). */
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

export interface UseActiveToolOpts {
  /** Select an object id (used by `toolCreated`). */
  select(id: string): void;
  /**
   * The `n` shortcut creates a sticky note directly (story 2 behaviour); it
   * is not a persistent tool, so it is handled here via this callback.
   */
  onStickyNote?(): void;
  /**
   * The `i` shortcut opens the image file picker (story 12); it is not a
   * persistent tool, so it is handled here via this callback.
   */
  onImagePicker?(): void;
}

export interface ActiveToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Select the created object, return to Select, close the undo window. */
  toolCreated(id: string): void;
}

/**
 * Manage the active tool with keyboard shortcuts: `s` shape, `l` connector,
 * `v`/`t` as before, `n` creates a sticky note, `Escape` cancels back to
 * Select. Shortcuts are ignored while an input/textarea/contenteditable has
 * focus and with modifier keys held.
 */
export function useActiveTool(opts: UseActiveToolOpts): ActiveToolState {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (toolRef.current === 'shape' || toolRef.current === 'connector' || toolRef.current === 'pen') {
          e.preventDefault();
          setToolState('select');
        }
        return;
      }

      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (!t) return;
      // `n` creates a sticky note (not a persistent tool).
      if (t === 'sticky') {
        optsRef.current.onStickyNote?.();
        return;
      }
      // `i` opens the image picker (not a persistent tool, story 12).
      if (t === 'image') {
        optsRef.current.onImagePicker?.();
        return;
      }
      // Tools from stories not in this build are no-ops.
      if (t === 'comment') return;
      e.preventDefault();
      setToolState(t);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const setTool = useCallback((t: ToolId) => setToolState(t), []);
  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.select(id);
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
