// Reading the system clipboard from a test (story 5, TC-26/TC-27/TC-30).
//
// The honest assertion for "the link is on the clipboard" is to read the
// clipboard back, not to spy on the write. `navigator.clipboard.readText()` does
// that, and the permissions are granted for the board's own origin — which is a
// secure context (`http://127.0.0.1`, the only host these tests run against;
// `localhost`/`127.0.0.1` are potentially trustworthy in all three engines, and
// WebKit rejects the API outright on a non-secure origin, so the harness binds
// 127.0.0.1 and the spec navigates absolutely).
//
// Not every engine honours `clipboard-read` even when it was granted — Chromium
// does, Firefox and WebKit may reject the read while the WRITE (which is what the
// product does) succeeded. In that case the same bytes are read the way a person
// would: paste into a field. That path needs no read permission, so the test still
// measures what actually landed on the system clipboard.

import { type BrowserContext, type Page } from '@playwright/test';

const PASTE_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Grant what the Share panel needs, for the board's own origin. The default is the
 * address the running `wrangler dev` published, which is what these tests navigate
 * to; a test that talks to a second Worker passes that one explicitly.
 */
export async function grantClipboardPermissions(
  context: BrowserContext,
  originUrl: string = process.env['PLAYWRIGHT_BASE_URL'] ?? '',
): Promise<void> {
  if (!originUrl) throw new Error('no board origin to grant clipboard rights for');
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(originUrl).origin,
    });
  } catch (error) {
    // Firefox and WebKit have no clipboard permission to hand out — there is no
    // prompt to pre-answer ("Unknown permission" / "not supported"), and the API's
    // behaviour differs per engine anyway. Chromium is the engine that asserts a
    // real read-back (TC-26); the others are here to prove the fallback works when
    // the browser refuses, which needs no granting at all.
    const message = (error as Error).message ?? '';
    if (!/unknown permission|not supported|unsupported/i.test(message)) throw error;
  }
}

export async function readClipboard(page: Page): Promise<string> {
  const direct = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  });
  if (typeof direct === 'string') return direct;

  const field = await page.evaluateHandle(() => {
    const el = document.createElement('textarea');
    el.setAttribute('data-testid', 'clipboard-probe');
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
    document.body.appendChild(el);
    return el;
  });
  const element = field.asElement();
  if (!element) throw new Error('could not add a clipboard probe field to the page');
  await element.click();
  await page.keyboard.press(`${PASTE_MODIFIER}+KeyV`);
  const value = await field.evaluate((el: HTMLTextAreaElement) => el.value);
  await field.evaluate((el: HTMLTextAreaElement) => el.remove());
  return value;
}
