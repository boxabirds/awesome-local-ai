// contentEditable binding between a DOM node and a Y.Text (story 2). Local
// keystrokes go to the CRDT; remote changes are written back into the DOM
// without fighting the caret, and IME composition is never interrupted.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { fitFontSize } from './StickyText';

interface Props {
  yText: Y.Text;
  className?: string;
  onBlur?: () => void;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function StickyTextEditor({ yText, className, onBlur }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastLocal = useRef<string>('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const initial = yText.toString();
    lastLocal.current = initial;
    el.textContent = initial;
    // Opening a note for editing puts the caret at the end and takes focus, so
    // typing starts immediately.
    el.focus();
    setCaret(el, initial.length);

    const onRemote = (): void => {
      if (composing.current) return;
      const next = yText.toString();
      const node = el.firstChild;
      const current = el.textContent ?? '';
      if (current === next) return;
      const caretBefore = caretOffset(el);
      const prefix = commonPrefixLength(current, next);
      const suffix = (() => {
        let n = 0;
        while (
          n < current.length - prefix &&
          n < next.length - prefix &&
          current[current.length - 1 - n] === next[next.length - 1 - n]
        ) {
          n++;
        }
        return n;
      })();
      const replacement = next.slice(prefix, next.length - suffix);
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        el.textContent = next;
      } else {
        const textNode = node as Text;
        const value = textNode.data;
        textNode.data = value.slice(0, prefix) + replacement + value.slice(value.length - suffix);
      }
      const consumedLocal = next.slice(0, prefix) + replacement;
      const caretAfter = Math.min(
        consumedLocal.length,
        Math.max(prefix, caretBefore + (next.length - current.length)),
      );
      setCaret(el, caretAfter);
      lastLocal.current = next;
    };

    yText.observe(onRemote);
    return () => {
      yText.unobserve(onRemote);
    };
  }, [yText]);

  const pushLocal = (): void => {
    const el = ref.current;
    if (!el || composing.current) return;
    let next = el.textContent ?? '';
    if (next.length > STICKY_TEXT_MAX_CHARS) {
      next = next.slice(0, STICKY_TEXT_MAX_CHARS);
      el.textContent = next;
      setCaret(el, next.length);
    }
    const current = yText.toString();
    if (current === next) {
      lastLocal.current = next;
      return;
    }
    const prefix = commonPrefixLength(current, next);
    const suffix = (() => {
      let n = 0;
      while (
        n < current.length - prefix &&
        n < next.length - prefix &&
        current[current.length - 1 - n] === next[next.length - 1 - n]
      ) {
        n++;
      }
      return n;
    })();
    yText.doc?.transact(() => {
      const deleteCount = current.length - prefix - suffix;
      if (deleteCount > 0) yText.delete(prefix, deleteCount);
      const inserted = next.slice(prefix, next.length - suffix);
      if (inserted.length > 0) yText.insert(prefix, inserted);
    }, LOCAL_ORIGIN);
    lastLocal.current = next;
  };

  const size = fitFontSize(lastLocal.current || yText.toString());

  return (
    <div
      ref={ref}
      className={`sticky-editor ${className ?? ''}`}
      style={{ fontSize: `${size}px` }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      spellCheck
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        pushLocal();
      }}
      onBeforeInput={(event) => {
        if (!composing.current && (event.target as HTMLElement).textContent === '' && yText.toString().length >= STICKY_TEXT_MAX_CHARS) {
          event.preventDefault();
        }
      }}
      onInput={pushLocal}
      onBlur={() => onBlur?.()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          (event.currentTarget as HTMLElement).blur();
        }
      }}
    />
  );
}

function caretOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return root.textContent?.length ?? 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return root.textContent?.length ?? 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

function setCaret(root: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const node = root.firstChild;
  if (!node) return;
  const max = node.textContent?.length ?? 0;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, max));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
