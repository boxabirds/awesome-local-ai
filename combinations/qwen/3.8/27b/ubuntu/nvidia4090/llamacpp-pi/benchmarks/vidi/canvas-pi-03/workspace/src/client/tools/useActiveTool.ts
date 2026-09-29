import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '@/shared/objects/shape';

/**
 * Active tool (story 9 text.tool, extended by stories 10-11).
 *
 * The tool is per-client state (never persisted). 'select' is the default;
 * 'text', 'shape', 'connector' and 'pen' are the activatable creation tools.
 * The ids 'image' / 'comment' are RESERVED for stories 12-13: they are
 * accepted by the tool state so future toolbars can reference them, but this
 * build cannot activate them (no button, no shortcut, no tool surface).
 * Unlike the other creation tools, the Pen stays active after each stroke
 * (pen.active: a stroke never calls toolCreated).
 *
 * While the board cannot be edited (story 4 load-failure), an active
 * creation tool reverts to Select and the buttons are disabled
 * (text.not_editable — the same rule applies to every creation tool).
 *
 * Keyboard shortcuts (story 10, tools.keys): V → Select (every state),
 * T → Text, S → Shape, L → Connector, P → Pen (creation tools only while
 * editable), Escape → Select. Single keys are ignored while any modifier is
 * held or focus is in an input/textarea/contenteditable. N (sticky at centre)
 * stays in useBoardKeys: it is a direct action, not a tool.
 */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

const ACTIVATABLE: ReadonlySet<ToolId> = new Set<ToolId>(['text', 'shape', 'connector', 'pen']);

const SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
};

export interface ActiveToolOptions {
  /** Story 4: creation tools cannot be (or stay) active while locked. */
  canEdit?: boolean;
  /** Called by `toolCreated` before returning to Select (select the new object). */
  onSelectCreated?: (id: string) => void;
}

export interface ActiveTool {
  tool: ToolId;
  /** The shape kind the Shape tool will create (Toolbar kind menu). */
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /**
   * Story 10: a creation tool just produced `id` — select it (replacing the
   * selection) and return to Select (text.create / shape.tool).
   */
  toolCreated(id: string): void;
}

export function useActiveTool(opts: ActiveToolOptions = {}): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setTool = useCallback((t: ToolId) => {
    if (t !== 'select' && !ACTIVATABLE.has(t)) return; // reserved ids
    if (t !== 'select' && optsRef.current.canEdit === false) {
      setToolState('select');
      return;
    }
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.onSelectCreated?.(id);
    setToolState('select');
  }, []);

  // Edit lock: an active creation tool reverts to Select (text.not_editable).
  useEffect(() => {
    if (opts.canEdit === false && tool !== 'select') {
      setToolState('select');
    }
  }, [opts.canEdit, tool]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return; // the input owns the keys
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }
      const id = SHORTCUTS[String(e.key).toLowerCase()];
      if (id === undefined) return;
      if (id === 'select') {
        setToolState('select');
        return;
      }
      setTool(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
