import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/features/share/copyText';

const LINK = 'https://todoodle.test/w#XndWJwDqchaBV0DPQNeYWVlBHgWT2qCwxEKIdI-7ZoQ';

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => clipboard });
}

function field() {
  const input = document.createElement('input');
  input.value = LINK;
  document.body.append(input);
  return input;
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it("TC-92 a string goes through writeText -> 'copied'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    expect(await copyText(LINK)).toBe('copied');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
  });

  it("TC-92 a promise goes through write(ClipboardItem) -> 'copied'", async () => {
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      const blob = await items[0]!.items['text/plain'];
      expect(await (blob as Blob).text()).toBe(LINK);
    });
    const writeText = vi.fn();
    stubClipboard({ write: write as unknown as Clipboard['write'], writeText });
    expect(await copyText(Promise.resolve(LINK))).toBe('copied');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]![0]).toBeInstanceOf(FakeClipboardItem);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("TC-92 writeText rejecting -> 'fallback', field focused and fully selected", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    const input = field();
    expect(await copyText(LINK, input)).toBe('fallback');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it("TC-92 clipboard undefined -> 'fallback' with selection", async () => {
    stubClipboard(undefined);
    const input = field();
    expect(await copyText(LINK, input)).toBe('fallback');
    expect(document.activeElement).toBe(input);
  });

  it("TC-92 ClipboardItem missing -> 'fallback' for a promise", async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const write = vi.fn();
    stubClipboard({ write, writeText: vi.fn() });
    expect(await copyText(Promise.resolve(LINK))).toBe('fallback');
    expect(write).not.toHaveBeenCalled();
  });

  it("TC-92 a rejecting text promise -> 'fallback', never throws", async () => {
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      await items[0]!.items['text/plain'];
    });
    stubClipboard({ write: write as unknown as Clipboard['write'] });
    const input = field();
    await expect(copyText(Promise.reject(new Error('404')), input)).resolves.toBe('fallback');
    expect(document.activeElement).toBe(input);
  });

  it("TC-92 write resolving although the text promise rejected is still 'fallback'", async () => {
    stubClipboard({ write: vi.fn().mockResolvedValue(undefined) });
    await expect(copyText(Promise.reject(new Error('network')))).resolves.toBe('fallback');
  });

  it("TC-92 without a field, failure resolves 'fallback' with no side effects", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const before = document.activeElement;
    expect(await copyText(LINK)).toBe('fallback');
    expect(document.activeElement).toBe(before);
  });
});
