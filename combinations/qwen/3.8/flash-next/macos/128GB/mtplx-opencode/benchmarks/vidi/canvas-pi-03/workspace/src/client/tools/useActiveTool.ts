// The board's tool layer (story 10, contract `tools.active_tool`).
//
// A tool is a mode of the WHOLE board, not of one object: while the Shape tool
// is armed a press-drag anywhere draws a shape instead of moving what is
// already there, and it stays armed until the shape is placed or Escape is
// pressed. This is story 9's `board/tools.ts` grown to the family of tools the
// PRD describes, in one place, because the rules are shared:
//
//  - a tool never changes while the board cannot be edited;
//  - a shortcut is a BARE key: Ctrl/Cmd/Alt + letter belongs to the browser;
//  - a tool that finishes spends itself (`toolCreated` → Select + select).
//
// `n` is deliberately NOT in TOOL_SHORTCUTS: on this board `n` creates a sticky
// note (story 2), which is an action, not a mode, and the tool layer must not
// swallow it. The same goes for the tools this story does not implement.

import { useCallback, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

/** Every mode the palette can show. Only the ones with a working gesture do
 * anything yet; the rest are declared so the palette and the shortcuts have
 * one vocabulary. */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** The tools a bare key selects. Keys with no entry are never a shortcut. */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  V: 'select',
  Escape: 'select',
  t: 'text',
  T: 'text',
  s: 'shape',
  S: 'shape',
  l: 'connector',
  L: 'connector',
};

/** True while a tool owns the pointer: a press belongs to the tool, not to the
  object underneath it, and the board does not pan under it. */
export function isCreationTool(tool: ToolId): boolean {
  return tool === 'text' || tool === 'shape' || tool === 'connector';
}

/** The tool a key selects, or null when the key is not a tool shortcut.
 * A combination with Ctrl/Cmd/Alt is never a shortcut (Ctrl+T is the browser's
 * new tab), and a key that is not listed is ignored. */
export function toolForKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ToolId | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return TOOL_SHORTCUTS[event.key] ?? null;
}

export interface ActiveToolOptions {
  /** False while the board could not be loaded: it has no tools at all. */
  canEdit: boolean;
  /** Make `id` the selection (null clears it). */
  select(id: string | null): void;
}

export interface ActiveToolState {
  /** The armed tool. `'select'` unless a creation tool was armed. */
  tool: ToolId;
  /** Which shape the Shape tool draws. Persists between shapes (a Shape tool
   * stays a Shape tool), and is not board data. */
  shapeKind: ShapeKind;
  /** Arm a tool. Ignored (and forced back to Select) when the board cannot be
   * edited. Arming Select also drops the selection's edit mode? No — it only
   * changes the mode; selection is the caller's business. */
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** A creation gesture finished: `id` becomes the selection and the board
   * returns to Select (contract `tools.return_to_select`). A creation that was
   * REJECTED never gets here — the tool stays armed. */
  toolCreated(id: string): void;
  /** Feed a keydown to the tool layer. True when the key was a tool shortcut
   * (the caller then stops handling that key). */
  fromKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean;
}

/**
 * The board's tool state, owned by one client and never written to the Y.Doc.
 * Arming a tool creates nothing by itself — the pointer does — so this stays
 * two strings plus the rules that guard them.
 */
export function useActiveTool(options: ActiveToolOptions): ActiveToolState {
  const [tool, set] = useState<ToolId>('select');
  const [shapeKind, setKind] = useState<ShapeKind>('rect');

  // Read fresh on every call so the callbacks stay stable (the board binds its
  // keydown handler once).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setTool = useCallback((next: ToolId) => {
    // A read-only board has no tools: an armed tool falls back to Select
    // instead of sitting there waiting for a click that cannot happen.
    if (!optionsRef.current.canEdit) {
      set('select');
      return;
    }
    set(next);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    setKind(kind);
  }, []);

  const toolCreated = useCallback((id: string) => {
    const { select } = optionsRef.current;
    select(id);
    set('select');
  }, []);

  const fromKey = useCallback((event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => {
    const next = toolForKey(event);
    if (next === null) return false;
    if (!optionsRef.current.canEdit) return false;
    set(next);
    return true;
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated, fromKey };
}
