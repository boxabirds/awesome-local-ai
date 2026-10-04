/**
 * Where the caret belongs after the text it sits in changes underneath it — the
 * problem that appears the moment somebody else can edit the same text.
 *
 * `oldValue → newValue` is read as one change in the middle: what the two
 * strings share at the start stays where it is, and what they share at the end
 * slides along by the width of the change. A caret before the changed part does
 * not move, a caret after it moves with the text, and a caret *inside* it lands
 * at the start of the changed part — the least surprising place for text that
 * was replaced, or for text somebody else inserted where you were typing.
 */
export function mapCaretPosition(oldValue: string, newValue: string, position: number): number {
  const clamp = (value: number) => Math.max(0, Math.min(value, oldValue.length));
  const from = clamp(position);

  let start = 0;
  while (
    start < oldValue.length &&
    start < newValue.length &&
    oldValue[start] === newValue[start]
  ) {
    start++;
  }

  let endOld = oldValue.length;
  let endNew = newValue.length;
  while (endOld > start && endNew > start && oldValue[endOld - 1] === newValue[endNew - 1]) {
    endOld--;
    endNew--;
  }

  if (from <= start) return from;
  if (from >= endOld) {
    // After the change: slide along with the text it sat in front of.
    const shifted = from + (newValue.length - oldValue.length);
    return Math.max(start, Math.min(shifted, newValue.length));
  }
  // Inside the replaced region.
  return start;
}
