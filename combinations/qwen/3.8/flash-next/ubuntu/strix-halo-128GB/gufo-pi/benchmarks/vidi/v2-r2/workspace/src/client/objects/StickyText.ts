import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '@shared/config';

export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) return next;
  // Be careful not to split a surrogate pair at the boundary
  let end = max;
  if (end > 0) {
    const code = next.charCodeAt(end - 1);
    // High surrogate: if we'd cut right after it, we'd leave a lone high surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      end--;
    }
  }
  return next.slice(0, end);
}

export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current[prefixLen] === next[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (but not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    current[current.length - 1 - suffixLen] === next[next.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteCount = current.length - prefixLen - suffixLen;
  const insertStr = next.slice(prefixLen, next.length - suffixLen);

  const perform = () => {
    if (deleteCount > 0) {
      ytext.delete(prefixLen, deleteCount);
    }
    if (insertStr.length > 0) {
      ytext.insert(prefixLen, insertStr);
    }
  };

  const doc = ytext.doc;
  if (doc) {
    doc.transact(perform, origin);
  } else {
    perform();
  }
}

export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

export function fitFontSize(
  el: HTMLElement,
  box: number,
): { fontPx: number; overflow: boolean } {
  // Binary search for the largest font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
  // where scrollHeight <= box.
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let bestFit = STICKY_FONT_MIN_PX;

  // Try max first
  el.style.fontSize = `${hi}px`;
  if (el.scrollHeight <= box) {
    return { fontPx: hi, overflow: false };
  }

  // Try min
  el.style.fontSize = `${lo}px`;
  if (el.scrollHeight > box) {
    return { fontPx: lo, overflow: true };
  }

  // Binary search
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      bestFit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { fontPx: bestFit, overflow: false };
}
