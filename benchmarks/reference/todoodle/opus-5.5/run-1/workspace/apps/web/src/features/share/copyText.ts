export type CopyResult = 'copied' | 'fallback';

function selectField(field?: HTMLInputElement | null): void {
  if (!field) return;
  field.focus();
  field.select();
}

/**
 * Copies text to the clipboard. A string uses writeText; a promise uses write(ClipboardItem), which
 * keeps Safari's user-gesture requirement satisfied while the text is still being fetched.
 * On any failure it focuses and selects `fallbackField` (if given) for a manual copy and resolves
 * 'fallback'. Never throws. Call it only from event handlers.
 */
export async function copyText(text: string | Promise<string>, fallbackField?: HTMLInputElement | null): Promise<CopyResult> {
  // A rejecting promise must never surface as an unhandled rejection.
  if (typeof text !== 'string') text.catch(() => {});
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (typeof text === 'string') {
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(text);
    } else {
      if (typeof ClipboardItem === 'undefined' || !clipboard?.write) throw new Error('ClipboardItem unavailable');
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      await text;
    }
    return 'copied';
  } catch {
    selectField(fallbackField);
    return 'fallback';
  }
}
