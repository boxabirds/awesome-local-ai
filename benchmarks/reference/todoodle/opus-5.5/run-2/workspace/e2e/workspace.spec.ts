import { type BrowserContext, expect, type Page, type Request, test } from '@playwright/test';
import { THEME_TOKENS } from '../packages/shared/src/tokens';

const SAVE_TEXT = "Your link isn't saved yet — you'll lose access if you clear this browser.";

type Created = { id: string; secret: string; link: string };

/** Everything the page sent: URL, Referer and body, to prove the secret never leaks. */
type Sent = { url: string; method: string; referer?: string; body: string | null };

function recordRequests(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (req: Request) => {
    sent.push({ url: req.url(), method: req.method(), referer: req.headers().referer, body: req.postData() });
  });
  return sent;
}

/** In webkit the clipboard is forced to refuse, so the tests exercise the manual-copy fallback. */
async function prepareClipboard(context: BrowserContext, browserName: string) {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  } else {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
          write: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
      });
    });
  }
}

async function createFromHome(page: Page): Promise<Created & { elapsedMs: number }> {
  await page.goto('/');
  const start = Date.now();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/workspaces') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Start a new list' }).click(),
  ]);
  await expect(page.getByLabel('Workspace name')).toHaveValue('My Todoodle');
  const elapsedMs = Date.now() - start;
  const body = (await response.json()) as { workspace: { id: string }; secret: string };
  const origin = new URL(page.url()).origin;
  return { id: body.workspace.id, secret: body.secret, link: `${origin}/w#${body.secret}`, elapsedMs };
}

/** Saves the link from the first-run panel (clipboard in chromium, manual fallback in webkit). */
async function saveLinkFromPanel(page: Page, browserName: string, link: string) {
  const dialog = page.getByRole('dialog', { name: 'Save your link' });
  await expect(dialog.getByLabel('Workspace link')).toHaveValue(link);
  await dialog.getByRole('button', { name: 'Copy link & continue' }).click();
  if (browserName === 'chromium') {
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  } else {
    // Fallback: the field is focused with the whole link selected; a manual copy counts as saved.
    const field = dialog.getByLabel('Workspace link');
    await expect(field).toBeFocused();
    expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, link.length]);
    await field.evaluate((el) => el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true })));
    await dialog.getByRole('button', { name: 'Skip for now' }).click();
    await expect(dialog).toBeHidden();
  }
}

function expectNoLeak(sent: Sent[], secret: string, origin: string) {
  expect(sent.length).toBeGreaterThan(0);
  for (const req of sent) {
    expect(req.url, 'request URL').not.toContain(secret);
    expect(req.referer ?? '', 'Referer').not.toContain(secret);
    if (!req.url.startsWith('data:')) expect(new URL(req.url).origin).toBe(origin);
    if (req.body?.includes(secret)) {
      expect(`${req.method} ${new URL(req.url).pathname}`).toBe('POST /api/workspaces/open');
    }
  }
}

test.describe('secret-link workspaces', () => {
  test('WF-1 / TC-54 create -> workspace in under a second, Save your link, Share reopens', async ({ page, context, browserName }) => {
    await prepareClipboard(context, browserName);
    const created = await createFromHome(page);
    expect(created.elapsedMs).toBeLessThan(1000);
    await expect(page).toHaveURL(created.link);
    await expect(page.getByRole('dialog', { name: 'Save your link' })).toBeVisible();
    await saveLinkFromPanel(page, browserName, created.link);
    // The empty Inbox (hidden from the accessibility tree while the modal panel was open).
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Share' }).click();
    const share = page.getByRole('dialog', { name: 'Share' });
    await expect(share.getByLabel('Workspace link')).toHaveValue(created.link);
    await expect(share.getByRole('button', { name: 'Done' })).toBeVisible();
    await share.getByRole('button', { name: 'Done' }).click();
    await expect(share).toBeHidden();
    await expect(page.getByRole('button', { name: /^Link$/ })).toHaveCount(0);
  });

  test('WF-2 / TC-55 the link opens the same workspace in a fresh context; reload keeps it', async ({ page, browser }) => {
    const created = await createFromHome(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
    await page.getByLabel('Workspace name').fill('Trip');
    await page.getByLabel('Workspace name').press('Enter');
    await expect(page).toHaveTitle('Todoodle - Trip');

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(created.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('Trip');
    await page2.reload();
    await expect(page2).toHaveURL(created.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('Trip');
    await expect(page2).toHaveTitle('Todoodle - Trip');
    await other.close();
  });

  test('WF-3 / TC-56 an unknown link -> Workspace not found; Start creates a new one', async ({ page }) => {
    const random = 'A'.repeat(40) + 'xyz';
    await page.goto(`/w#${random}`);
    await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
    await expect(page.getByText("Links are long — check it wasn't cut off when it was copied.")).toBeVisible();
    await page.getByRole('button', { name: 'Start a new list' }).click();
    await expect(page.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    await expect(page.getByRole('dialog', { name: 'Save your link' })).toBeVisible();
    expect(page.url()).not.toContain(random);
  });

  test('WF-4 / TC-57 a rename persists across reload and for another person', async ({ page, browser }) => {
    const created = await createFromHome(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
    const name = page.getByLabel('Workspace name');
    await name.fill('  Groceries  ');
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok()),
      name.press('Enter'),
    ]);
    await expect(name).toHaveValue('Groceries');
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Groceries');

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(created.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('Groceries');
    // Their later loads read the name through GET /api/w/:id.
    const [get] = await Promise.all([
      page2.waitForResponse((r) => r.url().endsWith(`/api/w/${created.id}`) && r.request().method() === 'GET'),
      page2.goto(`/w/${created.id}`),
    ]);
    expect(((await get.json()) as { workspace: { name: string } }).workspace.name).toBe('Groceries');
    await other.close();
  });

  test('WF-5 / TC-58 across the workflows the secret never leaves the origin or lands in a URL', async ({ page, browser, context, browserName, baseURL }) => {
    await prepareClipboard(context, browserName);
    const origin = new URL(baseURL ?? '').origin;
    const sent = recordRequests(page);
    const created = await createFromHome(page);
    await saveLinkFromPanel(page, browserName, created.link);
    await page.getByLabel('Workspace name').fill('Leaky?');
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'PATCH'),
      page.getByLabel('Workspace name').press('Enter'),
    ]);
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Leaky?');
    await page.goto(`/w/${created.id}`);
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('dialog').getByLabel('Workspace link')).toHaveValue(created.link);

    const other = await browser.newContext();
    const page2 = await other.newPage();
    const sent2 = recordRequests(page2);
    await page2.goto(created.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('Leaky?');
    await page2.goto('/w#' + 'B'.repeat(43));
    await expect(page2.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();

    expectNoLeak(sent, created.secret, origin);
    expectNoLeak(sent2, created.secret, origin);
    expect(sent2.some((r) => r.body?.includes(created.secret))).toBe(true);
    await expect(page).not.toHaveTitle(new RegExp(created.secret));
    await other.close();
  });

  test('WF-6 / TC-63 on /w/:id the Share link equals the creation link and works elsewhere', async ({ page, browser }) => {
    const created = await createFromHome(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
    await page.goto(`/w/${created.id}`);
    await expect(page.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    await page.getByRole('button', { name: 'Share' }).click();
    const field = page.getByRole('dialog', { name: 'Share' }).getByLabel('Workspace link');
    await expect(field).toHaveValue(created.link);

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(await field.inputValue());
    await expect(page2.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    await other.close();
  });

  test('WF-7 / TC-88 after saving, the banner stays gone across reload; a fresh browser sees it', async ({ page, context, browser, browserName }) => {
    await prepareClipboard(context, browserName);
    const created = await createFromHome(page);
    await expect(page.getByText(SAVE_TEXT)).toBeVisible();
    await saveLinkFromPanel(page, browserName, created.link);
    await expect(page.getByText(SAVE_TEXT)).toBeHidden();
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    await expect(page.getByText(SAVE_TEXT)).toBeHidden();

    const other = await browser.newContext();
    const page2 = await other.newPage();
    await page2.goto(created.link);
    await expect(page2.getByText(SAVE_TEXT)).toBeVisible();
    await other.close();
  });

  test('WF-8 / TC-89 Email it to me makes no request and no secret lands in web storage', async ({ page }) => {
    const created = await createFromHome(page);
    const dialog = page.getByRole('dialog', { name: 'Save your link' });
    const email = dialog.getByRole('link', { name: 'Email it to me' });
    await expect(email).toHaveAttribute('href', `mailto:?subject=Your%20Todoodle%20link&body=${encodeURIComponent(created.link)}`);
    // Keep the test browser from handing mailto: to an OS handler; the click itself still runs.
    await page.evaluate(() =>
      document.addEventListener('click', (e) => {
        if ((e.target as Element).closest('a[href^="mailto:"]')) e.preventDefault();
      }),
    );
    const sent = recordRequests(page);
    await email.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(SAVE_TEXT)).toBeHidden();
    await page.waitForTimeout(300);
    expect(sent).toEqual([]);
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    expect(stored).not.toContain(created.secret);
    expect(stored).toContain(`tdl:v1:linkSaved:${created.id}`);
  });

  test('WF-9 / TC-86 the boot open starts before the Workspace chunk has downloaded', async ({ page, browser }) => {
    const created = await createFromHome(page);
    const fresh = await browser.newContext();
    const page2 = await fresh.newPage();
    let openStartedAt = Number.POSITIVE_INFINITY;
    let chunkFinishedAt = 0;
    page2.on('request', (req) => {
      if (req.url().endsWith('/api/workspaces/open')) openStartedAt = Math.min(openStartedAt, performance.now());
    });
    page2.on('requestfinished', (req) => {
      if (/\/assets\/Workspace-[^/]+\.js$/.test(req.url())) chunkFinishedAt = performance.now();
    });
    await page2.goto(created.link);
    await expect(page2.getByLabel('Workspace name')).toHaveValue('My Todoodle');
    expect(chunkFinishedAt).toBeGreaterThan(0);
    expect(openStartedAt).toBeLessThan(chunkFinishedAt);
    await fresh.close();
  });

  for (const scheme of ['dark', 'light'] as const) {
    test(`WF-10 / TC-87 ${scheme} appearance uses the ${scheme} --background token`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/');
      const hex = THEME_TOKENS[scheme].background;
      const rgb = `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      await expect(page.locator('body')).toHaveCSS('background-color', rgb);
      await ctx.close();
    });
  }
});
