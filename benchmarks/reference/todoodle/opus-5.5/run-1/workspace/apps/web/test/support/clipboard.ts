import { vi } from 'vitest';

/** D9 clipboard capabilities. */
export type ClipboardMode = 'ok' | 'rejects' | 'undefined' | 'no-clipboard-item';

export type ClipboardStub = {
  writeText: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  /** Text written through write(ClipboardItem), once its promise settled. */
  written: string[];
};

class FakeClipboardItem {
  readonly items: Record<string, Promise<Blob> | Blob | string>;
  constructor(items: Record<string, Promise<Blob> | Blob | string>) {
    this.items = items;
  }
}

/**
 * Installs a navigator.clipboard stub (and ClipboardItem unless the mode removes it).
 * Call it after renderApp: userEvent.setup() installs its own clipboard stub.
 */
export function stubClipboard(mode: ClipboardMode): ClipboardStub {
  const written: string[] = [];
  const writeText = vi.fn(async (_text: string) => {
    if (mode === 'rejects') throw new DOMException('Denied', 'NotAllowedError');
  });
  const write = vi.fn(async (items: FakeClipboardItem[]) => {
    if (mode === 'rejects') throw new DOMException('Denied', 'NotAllowedError');
    for (const item of items) {
      const blob = await item.items['text/plain'];
      written.push(typeof blob === 'string' ? blob : await (blob as Blob).text());
    }
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: mode === 'undefined' ? undefined : { writeText, write },
  });
  vi.stubGlobal('ClipboardItem', mode === 'no-clipboard-item' || mode === 'undefined' ? undefined : FakeClipboardItem);
  return { writeText, write, written };
}
