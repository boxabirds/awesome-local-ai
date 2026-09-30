import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from '../../shared/config';

/** Keeps at most `max` characters (default STICKY_TEXT_MAX_CHARS). */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  return next.length > max ? next.slice(0, max) : next;
}

/** True when `length` is within STICKY_COUNTER_THRESHOLD_CHARS of the limit. */
export function counterVisible(length: number): boolean {
  return STICKY_TEXT_MAX_CHARS - length <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Updates `ytext` to `next` with the minimal change: common prefix + common
 * suffix computed in code points, so at most one delete and one insert inside
 * one transaction. Boundaries always land on code-point boundaries, so emoji
 * surrogate pairs are never split. Required (not a full replace) so concurrent
 * typing by others (story 3) is never destroyed.
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();
  if (current === next) return;

  const cur = [...current];
  const nxt = [...next];
  const minCp = Math.min(cur.length, nxt.length);

  let prefixCp = 0;
  while (prefixCp < minCp && cur[prefixCp] === nxt[prefixCp]) prefixCp++;
  let suffixCp = 0;
  while (
    suffixCp < minCp - prefixCp &&
    cur[cur.length - 1 - suffixCp] === nxt[nxt.length - 1 - suffixCp]
  ) {
    suffixCp++;
  }

  // Code-unit indices of the (code-point aligned) boundaries.
  const prefixIdx = cur.slice(0, prefixCp).join('').length;
  const suffixIdx = suffixCp === 0 ? 0 : cur.slice(cur.length - suffixCp).join('').length;

  const delLen = current.length - prefixIdx - suffixIdx;
  const ins = next.slice(prefixIdx, next.length - suffixIdx);

  const doc = ytext.doc;
  doc!.transact(() => {
    if (delLen > 0) ytext.delete(prefixIdx, delLen);
    if (ins.length > 0) ytext.insert(prefixIdx, ins);
  }, origin);
}

/**
 * Finds the largest integer font size in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
 * (board units, so it scales with zoom) at which `el`'s text fits inside a
 * `box` × `box` content area. Leaves `el` at the chosen size and reports
 * whether the text still overflows at the chosen size.
 *
 * Measurement uses an off-screen, height:auto probe with the same width,
 * font and wrapping as `el`'s content box: the note's text div has a fixed
 * height, so its own scrollHeight is always ≥ that height and cannot be used
 * to detect overflow.
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  const cs = getComputedStyle(el);
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.width = `${box}px`;
  probe.style.whiteSpace = cs.whiteSpace;
  probe.style.wordBreak = cs.wordBreak;
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.lineHeight = cs.lineHeight;
  probe.style.textAlign = cs.textAlign;
  probe.textContent = el.textContent ?? '';
  document.body.appendChild(probe);

  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let fontPx = STICKY_FONT_MIN_PX;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = `${mid}px`;
    if (probe.scrollHeight <= box) {
      fontPx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const overflow = probe.scrollHeight > box;
  probe.remove();

  el.style.fontSize = `${fontPx}px`;
  return { fontPx, overflow };
}
