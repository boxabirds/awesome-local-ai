# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-05.spec.ts >> on a phone the sidebar is a drawer behind a menu button @ref prd:mobile_drawer
- Location: tests/story-05.spec.ts:315:1

# Error details

```
TimeoutError: locator.tap: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('#nav-drawer').getByRole('link', { name: /^Inbox/ })

```

# Page snapshot

```yaml
- generic:
  - generic:
    - status "Changes by others"
    - generic [aria-hidden]:
      - banner:
        - generic:
          - button [expanded]
          - group:
            - generic:
              - textbox: My Todoodle
          - button
          - button: Share
      - group:
        - generic:
          - main:
            - generic:
              - heading [level=1]: Inbox
              - generic:
                - paragraph: Your Inbox is clear. Tap + to add a task.
              - button
    - region "Notifications alt+T"
  - dialog [ref=e2]:
    - heading "Lists" [level=2] [ref=e3]
    - navigation "Lists" [ref=e4]:
      - button "Inbox" [active] [ref=e6]
```

# Test source

```ts
  225 | test('a task being saved is marked busy @ref prd:save_status_accessible', async ({ page }) => {
  226 |   requires(5);
  227 |   await createWorkspace(page);
  228 |   let release!: () => void;
  229 |   const held = new Promise<void>((r) => { release = r; });
  230 |   await page.route('**/api/**', async (r) => {
  231 |     if (r.request().method() === 'POST') await held;
  232 |     await r.continue();
  233 |   });
  234 |   await openQuickAdd(page);
  235 |   await nameInput(page).fill('Pending');
  236 |   await nameInput(page).press('Enter');
  237 |   await expect(taskRow(page, 'Pending')).toHaveAttribute('aria-busy', 'true');
  238 |   release();
  239 |   await expect(taskRow(page, 'Pending')).not.toHaveAttribute('aria-busy', 'true');
  240 | });
  241 | 
  242 | test("a failed list load says Couldn't load your tasks. with Try again @ref prd:load_failure_retry", async ({ page }) => {
  243 |   requires(5);
  244 |   const link = await workspaceWithTasks(page, 'Survivor');
  245 |   let failing = true;
  246 |   await page.route(TASKS_GET, (r) => (failing && r.request().method() === 'GET' ? unavailable(r) : r.continue()));
  247 |   await page.goto('/');
  248 |   await page.goto(link);
  249 |   await expect(page.getByRole('alert').filter({ hasText: "Couldn't load your tasks." })).toBeVisible();
  250 |   failing = false;
  251 |   await page.getByRole('button', { name: 'Try again' }).click();
  252 |   await expect(taskRow(page, 'Survivor')).toBeVisible();
  253 | });
  254 | 
  255 | test('placeholder rows show while the list loads, sidebar still usable @ref prd:loading_placeholder', async ({ page }) => {
  256 |   requires(5);
  257 |   const link = await workspaceWithTasks(page, 'Later');
  258 |   let release!: () => void;
  259 |   const held = new Promise<void>((r) => { release = r; });
  260 |   await page.route(TASKS_GET, async (r) => { await held; await r.continue(); });
  261 |   await page.goto('/');
  262 |   await page.goto(link);
  263 |   await expect(page.locator('[aria-busy="true"]').first()).toBeAttached();
  264 |   await expect(inboxLink(page)).toBeVisible();
  265 |   release();
  266 |   await expect(taskRow(page, 'Later')).toBeVisible();
  267 | });
  268 | 
  269 | test('? lists the keyboard shortcuts and Escape closes it @ref prd:shortcut_help', async ({ page }) => {
  270 |   requires(5);
  271 |   await createWorkspace(page);
  272 |   await page.locator('body').click({ position: { x: 5, y: 5 } });
  273 |   await page.keyboard.press('Shift+?');
  274 |   const panel = page.getByRole('dialog');
  275 |   await expect(panel).toBeVisible();
  276 |   await expect(panel.getByText(/Add task/)).toBeVisible();
  277 |   await expect(panel.getByText(/^Q$/i).first()).toBeVisible();
  278 |   await page.keyboard.press('Escape');
  279 |   await expect(panel).toBeHidden();
  280 | });
  281 | 
  282 | test('the task list is one Tab stop @ref prd:list_single_tab_stop', async ({ page }) => {
  283 |   requires(5);
  284 |   await workspaceWithTasks(page, 'One', 'Two', 'Three');
  285 |   const tabbable = taskRows(page).and(page.locator('[tabindex="0"]'));
  286 |   await expect(tabbable).toHaveCount(1);
  287 |   await expect(taskRows(page).first()).toHaveAttribute('tabindex', '0');
  288 |   await focusTask(page, 'One');
  289 |   await page.keyboard.press('ArrowDown');
  290 |   await expect(taskRow(page, 'Two')).toBeFocused();
  291 |   await expect(tabbable).toHaveCount(1);
  292 |   await expect(taskRow(page, 'Two')).toHaveAttribute('tabindex', '0');
  293 | });
  294 | 
  295 | test('Up/Down, k/j and Home/End move through tasks without wrapping @ref prd:list_keyboard_nav', async ({ page }) => {
  296 |   requires(5);
  297 |   await workspaceWithTasks(page, 'One', 'Two', 'Three');
  298 |   await focusTask(page, 'One');
  299 |   await page.keyboard.press('ArrowUp');
  300 |   await expect(taskRow(page, 'One')).toBeFocused();
  301 |   await page.keyboard.press('j');
  302 |   await expect(taskRow(page, 'Two')).toBeFocused();
  303 |   await page.keyboard.press('ArrowDown');
  304 |   await expect(taskRow(page, 'Three')).toBeFocused();
  305 |   await page.keyboard.press('j');
  306 |   await expect(taskRow(page, 'Three')).toBeFocused();
  307 |   await page.keyboard.press('k');
  308 |   await expect(taskRow(page, 'Two')).toBeFocused();
  309 |   await page.keyboard.press('Home');
  310 |   await expect(taskRow(page, 'One')).toBeFocused();
  311 |   await page.keyboard.press('End');
  312 |   await expect(taskRow(page, 'Three')).toBeFocused();
  313 | });
  314 | 
  315 | test('on a phone the sidebar is a drawer behind a menu button @ref prd:mobile_drawer', async ({ newPhone }) => {
  316 |   requires(5);
  317 |   const phone = await newPhone();
  318 |   await createWorkspace(phone);
  319 |   const menu = phone.getByRole('button', { name: 'Open navigation' });
  320 |   await expect(menu).toBeVisible();
  321 |   await expect(inboxLink(phone)).toBeHidden();
  322 |   await menu.tap();
  323 |   const drawer = phone.locator('#nav-drawer');
  324 |   await expect(drawer).toBeVisible();
> 325 |   await drawer.getByRole('link', { name: /^Inbox/ }).tap();
      |                                                      ^ TimeoutError: locator.tap: Timeout 5000ms exceeded.
  326 |   await expect(drawer).toBeHidden();
  327 |   expect(phone.viewportSize()).toEqual(PHONE);
  328 | });
  329 | 
  330 | test('on a phone a floating Add task button opens quick add @ref prd:mobile_add_button', async ({ newPhone }) => {
  331 |   requires(5);
  332 |   const phone = await newPhone();
  333 |   await createWorkspace(phone);
  334 |   const fab = phone.getByRole('button', { name: 'Add task', exact: true });
  335 |   await expect(fab).toBeVisible();
  336 |   await fab.tap();
  337 |   await expect(quickAddForm(phone)).toBeVisible();
  338 |   await nameInput(phone).fill('From the phone');
  339 |   await nameInput(phone).press('Enter');
  340 |   await expect(taskRow(phone, 'From the phone')).toBeVisible();
  341 |   await shot(phone, 's05-phone');
  342 | });
  343 | 
  344 | test('without hover, shell and list controls are at least 44 px @ref prd:touch_targets', async ({ newPhone }) => {
  345 |   requires(5);
  346 |   const phone = await newPhone();
  347 |   await createWorkspace(phone);
  348 |   for (const control of [
  349 |     phone.getByRole('button', { name: 'Open navigation' }),
  350 |     phone.getByRole('button', { name: 'Add task', exact: true }),
  351 |   ]) {
  352 |     const b = (await control.boundingBox())!;
  353 |     expect(b.width).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  354 |     expect(b.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  355 |   }
  356 |   await phone.getByRole('button', { name: 'Add task', exact: true }).tap();
  357 |   await nameInput(phone).fill('Tap target');
  358 |   await nameInput(phone).press('Enter');
  359 |   const row = (await taskRow(phone, 'Tap target').boundingBox())!;
  360 |   expect(row.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  361 | });
  362 | 
  363 | test('the task list follows the device light or dark setting @ref prd:color_scheme', async ({ page }) => {
  364 |   requires(5);
  365 |   await workspaceWithTasks(page, 'Readable');
  366 |   const background = () => taskList(page).evaluate((el) => {
  367 |     for (let n: Element | null = el; n; n = n.parentElement) {
  368 |       const c = getComputedStyle(n).backgroundColor;
  369 |       if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  370 |     }
  371 |     return 'rgb(255, 255, 255)';
  372 |   });
  373 |   const luminance = (rgb: string) => {
  374 |     const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  375 |     return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  376 |   };
  377 |   await page.emulateMedia({ colorScheme: 'light' });
  378 |   expect(luminance(await background())).toBeGreaterThan(LIGHT_MIN);
  379 |   await page.emulateMedia({ colorScheme: 'dark' });
  380 |   await expect.poll(async () => luminance(await background())).toBeLessThan(DARK_MAX);
  381 | });
  382 | 
```