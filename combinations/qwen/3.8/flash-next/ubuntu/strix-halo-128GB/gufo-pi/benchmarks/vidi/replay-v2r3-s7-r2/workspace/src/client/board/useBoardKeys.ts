/**
 * Selection keyboard commands (story 7).
 *
 * One handler for the whole board: select all, deselect, nudge, delete and open
 * for editing. Everything that could destroy other people's work is refused on
 * a read-only board, and nothing here runs while a text field owns the keyboard.
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { UseSelectionResult } from './useSelection';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

/** One key press, applied to the board. Exported so the rule table is testable. */
export function handleBoardKeyDown(options: BoardKeyOptions, e: KeyboardEvent): void {
  const { doc, selection, snapshot, canEdit } = options;
  // While a text field owns the keyboard, the board does nothing.
  if (selection.editingId !== null || isTextEntry(e.target)) return;

  const hasModifier = e.ctrlKey || e.metaKey;

  if (hasModifier && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    selection.setMany(allObjectIds(snapshot), false);
    return;
  }

  if (e.key === 'Escape') {
    selection.clear();
    return;
  }

  if (selection.ids.size === 0 || !canEdit) return;

  const arrow = ARROWS[e.key];
  if (arrow) {
    e.preventDefault(); // the page must not scroll instead of nudging
    const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
    const positions = new Map<string, Point>();
    for (const obj of snapshot) {
      if (!selection.ids.has(obj.id)) continue;
      positions.set(obj.id, { x: obj.x + arrow.x * step, y: obj.y + arrow.y * step });
    }
    if (positions.size > 0) moveObjects(doc, positions);
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
    return;
  }

  if (e.key === 'Enter' && selection.ids.size === 1) {
    const [id] = [...selection.ids];
    const obj = snapshot.find((o) => o.id === id);
    const spec = obj ? getObjectType(obj.type) : undefined;
    if (obj && spec?.editableText) {
      e.preventDefault();
      selection.startEdit(id);
    }
  }
}

/** Installs the handler once, reading the latest state through a ref. */
export function useBoardKeys(options: BoardKeyOptions): void {
  const live = useRef(options);
  live.current = options;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handleBoardKeyDown(live.current, e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
