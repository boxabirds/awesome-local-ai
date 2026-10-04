/**
 * Which tool this page is holding — the one place that answers that.
 *
 * Tool state is per-client and never written to the document: what *you* have picked
 * says nothing about anybody else's board (story 3's rule for the selection). Story 9
 * held Select and Text; story 10 adds the Shape tool with its shape kind and the
 * Connector tool, and the rule every creation tool follows: when a tool makes
 * something, the new thing is selected and the hand goes back to Select
 * (`toolCreated`), so it can be adjusted straight away.
 *
 * A tool that has no behaviour yet — the Image and Comment of settings' tool list — has a
 * shortcut that does nothing. Accepting it would leave the page holding a tool that cannot
 * draw, which is worse than an ignored key.
 *
 * One tool breaks the rule every creating tool follows, and does so on purpose: after the
 * pen finishes a stroke nothing calls `toolCreated`, so the page is still holding the pen
 * (PRD pen.stay_active). A sketch is usually more than one line, and the alternative —
 * reaching for the toolbar after every stroke — is the thing the PRD asks not to do.
 *
 * The keys live here because they belong to the tool, not to an object. They are
 * skipped while a person is typing (the target is a field, or the board has an object
 * open for editing), so `T` in a word is a letter and never a tool change.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { SHAPE_KINDS, TOOL_IDS, TOOL_SHORTCUTS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

export type ToolId = (typeof TOOL_IDS)[number];

/** The tools that do something when picked: everything story 12 has interfaces for. */
export const AVAILABLE_TOOLS: readonly ToolId[] = [
  'select',
  'sticky',
  'text',
  'shape',
  'connector',
  'pen',
];

export function toolHasInterface(id: ToolId): boolean {
  return AVAILABLE_TOOLS.includes(id);
}

export interface ActiveToolOptions {
  /** Whether this page may change the board at all (read-only guests get Select only). */
  canEdit?: boolean;
  /** `N`: the same thing the Sticky note button does (story 2's creation). */
  onCreateSticky?(): void;
  /** Make this object the only thing selected — what `toolCreated` does after a create. */
  select?(id: string): void;
}

export interface ActiveToolState {
  tool: ToolId;
  /** Which shape the Shape tool draws next (rectangle, ellipse or diamond). */
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** A creation finished: select it, and go back to Select. */
  toolCreated(id: string): void;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolState {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(SHAPE_KINDS[0]!);
  const current = useRef({ canEdit: true, tool, options });
  current.current = { canEdit: options.canEdit ?? true, tool, options };

  const toolCreated = useCallback((id: string) => {
    current.current.options.select?.(id);
    setToolState('select');
  }, []);

  const setTool = useCallback((next: ToolId) => {
    if (!toolHasInterface(next)) return; // unknown tool: ignored, nothing held
    // Picking the Sticky note is the button's one-shot action, not a tool you keep:
    // it makes a note and leaves you holding Select.
    if (next === 'sticky') {
      if (!current.current.canEdit) return;
      current.current.options.onCreateSticky?.();
      setToolState('select');
      return;
    }
    // A page that cannot edit the board can never be left holding a creating tool.
    if (next !== 'select' && !current.current.canEdit) return;
    setToolState((previous) => (previous === next ? previous : next));
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    if (!SHAPE_KINDS.includes(kind)) return;
    setShapeKindState(kind);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Typing a word is not a shortcut.
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        // Escape puts the tool back and creates nothing — including mid-drag, which
        // is the tool's own business: it drops the gesture when it unmounts. For the pen
        // that is the difference between a hand that left the surface (which keeps what it
        // drew) and a person who decided not to draw it (PRD pen.cancel).
        setToolState('select');
        return;
      }
      const target = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (!target) return; // unknown shortcut
      if (!toolHasInterface(target)) return;
      event.preventDefault();
      setTool(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  // A board that stops being editable takes the tool away mid-hand.
  useEffect(() => {
    if (!(options.canEdit ?? true)) setToolState('select');
  }, [options.canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
