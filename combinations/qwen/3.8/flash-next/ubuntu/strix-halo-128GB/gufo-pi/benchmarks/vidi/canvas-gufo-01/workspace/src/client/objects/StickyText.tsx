// Read-only rendering of a note's text: auto-shrinking type plus the
// remaining-characters counter (story 2). Kept separate from the editor so the
// non-editing state stays cheap.

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';

/** Largest font size (px) whose wrapped text fits the note box. */
export function fitFontSize(text: string, boxSize: number = STICKY_SIZE_WORLD, max: number = STICKY_FONT_MAX_PX, min: number = STICKY_FONT_MIN_PX): number {
  const inner = boxSize * 0.86;
  for (let size = max; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor(inner / (size * 0.55)));
    const lines = text
      .split('\n')
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0);
    if (lines * size * 1.25 <= inner) return size;
  }
  return min;
}

export function StickyText({ text }: { text: string }) {
  const remaining = STICKY_TEXT_MAX_CHARS - text.length;
  const size = fitFontSize(text);
  return (
    <div className="sticky-text" style={{ fontSize: `${size}px` }}>
      <span className="sticky-text-content">{text}</span>
      {remaining <= STICKY_COUNTER_THRESHOLD_CHARS ? (
        <span className={`sticky-counter${remaining <= 0 ? ' sticky-counter-over' : ''}`}>{remaining}</span>
      ) : null}
    </div>
  );
}
