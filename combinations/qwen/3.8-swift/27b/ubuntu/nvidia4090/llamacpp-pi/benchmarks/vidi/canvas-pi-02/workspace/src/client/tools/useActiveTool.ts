// Board tool state (story 10, tools.shortcuts): the active tool, the Shape
// tool's selected kind, and the plain-key shortcuts (V select, T text, S
// shape, L connector, P pen, Escape → Select).
//
// The Text/Shape/Connector tools are one-shot: toolCreated(id) selects the
// new object and switches back to Select (tools.one_shot). The Pen tool is
// STICKY: it stays active after each finished stroke until Escape or another
// tool (pen.stay_active, story 11). The 'n' shortcut (sticky at view centre)
// is an ACTION, not a tool switch — it stays in useBoardKeys (story 2
// behaviour). Image/Comment ids are declared for the toolbar layout but not
// usable in this build.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

/** The board's tool ids (the union for the toolbar layout). */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Plain-key tool shortcuts (tools.shortcuts). 'n' is deliberately absent:
 *  it creates a sticky at the view centre without switching tools. */
const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
};

/** The tools usable in this build (image/comment come later). */
const AVAILABLE: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

export interface ActiveToolOptions {
  /** False while the board is locked (load failed): creation tools cannot
   *  be activated (tools.not_editable). */
  canEdit: boolean;
  /** True while a text editor owns the keyboard (shortcuts are inactive). */
  isEditing(): boolean;
  /** Selects a single object (toolCreated selects the new one). */
  select(id: string): void;
  /** Story 12 (image.picker): the 'i' shortcut opens the image picker
   *  (one-shot action, like 'n' for stickies — never a tool switch). */
  onImageShortcut?(): void;
}

export interface ActiveToolApi {
  /** The active tool. */
  readonly tool: ToolId;
  /** The Shape tool's selected kind (the default is 'rect'). */
  readonly shapeKind: ShapeKind;
  /** Switches the tool (guards: unknown tools and locked boards). */
  setTool(t: ToolId): void;
  /** Sets the Shape tool's kind. */
  setShapeKind(k: ShapeKind): void;
  /** One-shot completion: selects the created object and returns to Select
   *  (tools.one_shot). */
  toolCreated(id: string): void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useActiveTool(opts: ActiveToolOptions): ActiveToolApi {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setTool = useCallback((t: ToolId): void => {
    if (!AVAILABLE.has(t)) return; // image/comment are not usable yet
    if (t !== 'select' && !optsRef.current.canEdit) return; // tools.not_editable
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind): void => {
    setShapeKindState(SHAPE_KINDS.includes(k) ? k : 'rect');
  }, []);

  // A board that becomes non-editable (load failure) reverts an active
  // creation tool to Select (tools.not_editable).
  useEffect(() => {
    if (!opts.canEdit && tool !== 'select') setToolState('select');
  }, [opts.canEdit, tool]);

  const toolCreated = useCallback((id: string): void => {
    optsRef.current.select(id);
    setToolState('select');
  }, []);

  // Plain-key shortcuts (never with modifiers, so Ctrl+V paste etc. are
  // untouched); inactive while an editor owns the keyboard.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (optsRef.current.isEditing()) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === 'escape') {
        // Escape returns to Select from any creation tool (tools.shortcuts).
        setToolState((t) => (t === 'select' ? t : 'select'));
        return;
      }
      // Story 12: 'i' opens the image picker (an action, not a tool).
      if (key === 'i') {
        if (optsRef.current.canEdit) optsRef.current.onImageShortcut?.();
        return;
      }
      const next = TOOL_SHORTCUTS[key];
      if (next === undefined) return;
      if (next === 'select') {
        setToolState('select');
        return;
      }
      if (optsRef.current.canEdit) setToolState(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
