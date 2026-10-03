/**
 * Is this element the one taking text right now?
 *
 * Three parts of the board have to answer it — the keyboard shortcuts, the wheel-and-key view
 * gestures, and a paste that might be a picture — and they all want the same answer: a caret
 * somewhere means the key or the clipboard belongs to that caret, not to the board. A focused
 * note is a textarea; a shape's label and a run of text are `contenteditable` (`text.edit_inplace`,
 * `shape.label`).
 *
 * `isContentEditable` is the browser's own answer and covers the case where the caret is on a
 * descendant of the editable host. It is asked of the markup as well because that property is a
 * report about a live editing engine: an environment without one — a test runner's DOM — answers
 * `undefined` for every element, which would switch the guard off exactly where it is needed.
 * React writes `contenteditable="true"` as an attribute, so reading the attribute reads what the
 * page really did.
 */
export function takesTextKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  // `closest`, because a caret sits *inside* the editing host rather than on it.
  return (
    target.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]') !==
    null
  );
}
