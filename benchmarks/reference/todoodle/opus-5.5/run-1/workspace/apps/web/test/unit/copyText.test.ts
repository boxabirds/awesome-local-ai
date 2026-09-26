import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/features/share/copyText';
import { stubClipboard } from '../support/clipboard.ts';

const LINK = 'http://localhost:3000/w#q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c';

function field(): HTMLInputElement {
  const input = document.createElement('input');
  input.value = LINK;
  document.body.append(input);
  return input;
}

function isFullySelected(input: HTMLInputElement): boolean {
  return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('TC-92 copyText', () => {
  it('a string uses writeText -> copied', async () => {
    const clip = stubClipboard('ok');
    expect(await copyText(LINK)).toBe('copied');
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(clip.write).not.toHaveBeenCalled();
  });

  it('a promise uses write(ClipboardItem) -> copied', async () => {
    const clip = stubClipboard('ok');
    expect(await copyText(Promise.resolve(LINK))).toBe('copied');
    expect(clip.write).toHaveBeenCalledOnce();
    expect(clip.written).toEqual([LINK]);
    expect(clip.writeText).not.toHaveBeenCalled();
  });

  it.each(['rejects', 'undefined'] as const)('writeText %s -> fallback, field focused and fully selected', async (mode) => {
    stubClipboard(mode);
    const input = field();
    expect(await copyText(LINK, input)).toBe('fallback');
    expect(isFullySelected(input)).toBe(true);
  });

  it('missing ClipboardItem with a promise -> fallback', async () => {
    const clip = stubClipboard('no-clipboard-item');
    const input = field();
    expect(await copyText(Promise.resolve(LINK), input)).toBe('fallback');
    expect(clip.write).not.toHaveBeenCalled();
    expect(isFullySelected(input)).toBe(true);
  });

  it('a rejecting promise -> fallback, never throws, no unhandled rejection', async () => {
    stubClipboard('ok');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(copyText(Promise.reject(new Error('404')))).resolves.toBe('fallback');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('without a fallback field it resolves fallback with no side effects', async () => {
    stubClipboard('rejects');
    const before = document.activeElement;
    await expect(copyText(LINK)).resolves.toBe('fallback');
    expect(document.activeElement).toBe(before);
  });
});
