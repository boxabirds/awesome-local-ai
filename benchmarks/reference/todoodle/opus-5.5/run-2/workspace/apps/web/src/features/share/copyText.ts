export type CopyResult = 'copied' | 'fallback';

function fallback(field?: HTMLInputElement | null): CopyResult {
  if (field) {
    field.focus();
    field.select();
  }
  return 'fallback';
}

/**
 * Copies text to the clipboard. A promise is written through ClipboardItem so the copy keeps the
 * click's user gesture while the text is still being fetched (Safari requires this). Any failure
 * (missing API, rejection, rejected text promise) selects `fallbackField` for a manual copy and
 * resolves 'fallback'. Never throws. Call only from event handlers.
 */
export async function copyText(
  text: string | Promise<string>,
  fallbackField?: HTMLInputElement | null,
): Promise<CopyResult> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (typeof text === 'string') {
      if (!clipboard?.writeText) return fallback(fallbackField);
      await clipboard.writeText(text);
      return 'copied';
    }
    text.catch(() => {});
    if (typeof ClipboardItem === 'undefined' || !clipboard?.write) return fallback(fallbackField);
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
    blob.catch(() => {});
    await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    await text;
    return 'copied';
  } catch {
    return fallback(fallbackField);
  }
}
