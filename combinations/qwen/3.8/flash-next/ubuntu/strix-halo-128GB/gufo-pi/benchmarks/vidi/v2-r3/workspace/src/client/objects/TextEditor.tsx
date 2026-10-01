/**
 * TextEditor (story 9): generalised from StickyTextEditor (story 2).
 * Supports configurable maxChars, fontPx, width. Enter newline, Escape/outside click ends,
 * minimal applyTextDiff, clamp to maxChars, undo boundaries.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/**
 * Three-way merge: base is the last common value, ours is the local edit,
 * theirs is the remote value. Returns the merged result.
 */
function threeWayMerge(base: string, ours: string, theirs: string): string {
  // Find common prefix
  let p = 0;
  while (p < base.length && p < ours.length && p < theirs.length && base[p] === ours[p] && base[p] === theirs[p]) p++;
  // Find common suffix (after prefix)
  let s = 0;
  while (
    s < base.length - p && s < ours.length - p && s < theirs.length - p &&
    base[base.length - 1 - s] === ours[ours.length - 1 - s] &&
    base[base.length - 1 - s] === theirs[theirs.length - 1 - s]
  ) s++;
  const baseMid = base.slice(p, base.length - s);
  const ourMid = ours.slice(p, ours.length - s);
  const theirMid = theirs.slice(p, theirs.length - s);

  if (ourMid === baseMid) return theirs; // only remote changed
  if (theirMid === baseMid) return ours; // only local changed
  // Both changed the middle; concatenate (ours first, then theirs)
  return ours.slice(0, p) + ourMid + theirMid + ours.slice(ours.length - s);
}

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController;
}

/**
 * The textarea shown while a text object is being edited.
 */
export function TextEditor({ ytext, maxChars, fontPx, width, onInput, onEnd, undoController }: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const syncedValueRef = useRef('');
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  // Edit start boundary
  useEffect(() => {
    undoController?.boundary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit start: value from the document, focus, caret at the end
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    syncedValueRef.current = text;
    el.focus();
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* jsdom */
    }
  }, [ytext]);

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let next = el.value;
    const clamped = clampToLimit(next, maxChars);
    if (clamped !== next) {
      const caret = Math.min(el.selectionStart ?? clamped.length, clamped.length);
      el.value = clamped;
      next = clamped;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* jsdom */
      }
    }
    // Three-way merge: local base (syncedValueRef) → editor value = user's delta.
    // Apply that delta to the current ytext (which may contain remote changes).
    const remoteText = ytext.toString();
    const base = syncedValueRef.current;
    let merged: string;
    if (next === base) {
      // No local change; keep remote
      merged = remoteText;
    } else if (remoteText === base) {
      // No remote change; use local
      merged = next;
    } else {
      // Both changed: three-way merge by computing local delta from base
      merged = threeWayMerge(base, next, remoteText);
    }
    applyTextDiff(ytext, merged, LOCAL_ORIGIN);
    syncedValueRef.current = ytext.toString();
    // Update editor if merge differs (remote chars appeared)
    if (merged !== el.value) {
      const caretPos = el.selectionStart ?? merged.length;
      el.value = merged;
      try {
        el.setSelectionRange(caretPos, caretPos);
      } catch {
        /* jsdom */
      }
    }
    onInputRef.current();
  }, [ytext, maxChars]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flush();
  }, [flush]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      flush();
      onEndRef.current(next);
    },
    [flush],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('selected');
        return;
      }
      // Intercept Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y
      if (undoController) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.undo();
          const el = ref.current;
          if (el) { el.value = ytext.toString(); }
          return;
        }
        if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.redo();
          const el = ref.current;
          if (el) { el.value = ytext.toString(); }
          return;
        }
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          undoController.redo();
          const el = ref.current;
          if (el) { el.value = ytext.toString(); }
          return;
        }
      }
      // Enter is left to the textarea (inserts newline)
    },
    [finish, undoController, ytext],
  );

  // Outside click ends editing
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      const textEl = el.closest('[data-text-id]');
      if (textEl && textEl.contains(target)) return;
      if (el.contains(target)) return;
      finish('unselected');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [finish]);

  // Remote changes observer: update textarea when ytext changes from another origin
  useEffect(() => {
    const observer = (event: any, txn: any) => {
      if (txn && txn.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const remoteVal = ytext.toString();
      // Merge remote into local
      const base = syncedValueRef.current;
      const localVal = el.value;
      let merged: string;
      if (localVal === base) {
        // No local edits: just adopt remote
        merged = remoteVal;
      } else {
        // Both changed: three-way merge
        merged = threeWayMerge(base, localVal, remoteVal);
      }
      const caretPos = el.selectionStart ?? merged.length;
      el.value = merged;
      syncedValueRef.current = remoteVal;
      try {
        el.setSelectionRange(caretPos, caretPos);
      } catch { /* jsdom */ }
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  // End-edit boundary
  useEffect(() => {
    return () => {
      undoController?.boundary();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const widthStyle = width === 'auto' ? undefined : width;

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      defaultValue=""
      spellCheck={false}
      onInput={handleInput}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      onBlur={flush}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: widthStyle ?? 'auto',
        minWidth: 40,
        minHeight: fontPx * 1.3,
        padding: 0,
        margin: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        color: '#1f1f1f',
        caretColor: '#1f1f1f',
        fontFamily: 'inherit',
        fontWeight: 'normal',
        lineHeight: 1.3,
        fontSize: fontPx,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
