# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-03.spec.ts >> the header switcher lists remembered workspaces and switches @ref prd:list_remembered
- Location: tests/story-03.spec.ts:176:1

# Error details

```
TimeoutError: locator.click: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('header').getByRole('button', { name: /Beta/ }).first()

```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - status "Changes by others" [ref=f1e3]
  - generic [ref=f1e4]:
    - banner [ref=f1e5]:
      - generic [ref=f1e6]:
        - group [ref=f1e7]:
          - generic [ref=f1e8]:
            - textbox "Workspace name" [ref=f1e9]: Beta
            - status
        - button "Switch workspace" [ref=f1e10]
        - button "Share" [ref=f1e13]
    - group [ref=f1e20]:
      - generic [ref=f1e21]:
        - complementary [ref=f1e22]:
          - navigation "Lists" [ref=f1e23]:
            - button "Inbox" [ref=f1e25]
        - main [ref=f1e30]:
          - generic [ref=f1e31]:
            - heading "Inbox" [level=1] [ref=f1e32]
            - paragraph [ref=f1e38]: Your Inbox is clear. Press Q to add a task.
            - button "Add task" [ref=f1e39]
  - region "Notifications alt+T"
```

# Test source

```ts
  80  | });
  81  | 
  82  | test('Continue goes to the most recent workspace, never automatically @ref prd:continue_recent', async ({ page }) => {
  83  |   requires(3);
  84  |   await namedWorkspace(page, 'Alpha');
  85  |   await namedWorkspace(page, 'Beta');
  86  |   await home(page);
  87  |   await expect(continueButton(page, 'Beta')).toBeVisible();
  88  |   expect(new URL(page.url()).pathname).toBe('/');
  89  |   await continueButton(page, 'Beta').click();
  90  |   await expectWorkspace(page, 'Beta');
  91  | });
  92  | 
  93  | test('the name shows before the workspace finishes loading @ref prd:instant_name', async ({ page }) => {
  94  |   requires(3);
  95  |   await namedWorkspace(page, 'Instant');
  96  |   await home(page);
  97  |   await expect(continueButton(page, 'Instant')).toBeVisible();
  98  |   let release!: () => void;
  99  |   const held = new Promise<void>((r) => { release = r; });
  100 |   await page.route('**/api/w/**', async (r) => { await held; await r.continue(); });
  101 |   await rememberedRow(page, 'Instant').click();
  102 |   await expectWorkspace(page, 'Instant');
  103 |   release();
  104 | });
  105 | 
  106 | test('a browser with nothing remembered shows only Start and the open-a-link hint @ref prd:empty_home', async ({ newPerson }) => {
  107 |   requires(3);
  108 |   const p = await newPerson();
  109 |   await home(p);
  110 |   await expect(p.getByText('Have a link? Open it to get back in.')).toBeVisible();
  111 |   await expect(rememberedHeading(p)).toHaveCount(0);
  112 |   await expect(p.getByText(/^Continue to /)).toHaveCount(0);
  113 | });
  114 | 
  115 | test('forgetting removes it from this browser only; the link still works @ref prd:forget', async ({ page, newPerson }) => {
  116 |   requires(3);
  117 |   const link = await namedWorkspace(page, 'Forget me');
  118 |   const other = await newPerson();
  119 |   await openLink(other, link, 'Forget me');
  120 |   await home(page);
  121 |   const dialog = await openForget(page, 'Forget me');
  122 |   await expect(dialog.getByText(FORGET_BODY)).toBeVisible();
  123 |   await dialog.getByRole('button', { name: 'Forget', exact: true }).click();
  124 |   await expect(rememberedRow(page, 'Forget me')).toHaveCount(0);
  125 |   await page.reload();
  126 |   await expect(startButton(page)).toBeVisible();
  127 |   await expect(rememberedRow(page, 'Forget me')).toHaveCount(0);
  128 |   await home(other);
  129 |   await expect(rememberedRow(other, 'Forget me')).toBeVisible();
  130 |   await openLink(page, link, 'Forget me');
  131 | });
  132 | 
  133 | test('Cancel keeps the workspace remembered @ref prd:forget', async ({ page }) => {
  134 |   requires(3);
  135 |   await namedWorkspace(page, 'Keep me');
  136 |   await home(page);
  137 |   const dialog = await openForget(page, 'Keep me');
  138 |   await dialog.getByRole('button', { name: 'Cancel' }).click();
  139 |   await expect(dialog).toBeHidden();
  140 |   await page.reload();
  141 |   await expect(rememberedRow(page, 'Keep me')).toBeVisible();
  142 | });
  143 | 
  144 | test('forgetting an unsaved link warns and offers to copy it @ref prd:forget_unsaved_warning', async ({ page }) => {
  145 |   requires(3);
  146 |   const link = await namedWorkspace(page, 'Unsaved', false);
  147 |   await home(page);
  148 |   const dialog = await openForget(page, 'Unsaved');
  149 |   await expect(dialog.getByText(UNSAVED_WARNING)).toBeVisible();
  150 |   await dialog.getByRole('button', { name: 'Copy link' }).click();
  151 |   await expect(dialog.getByText(COPIED_SAFE)).toBeVisible();
  152 |   expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  153 | });
  154 | 
  155 | test('forgetting a saved link has no warning @ref prd:forget_unsaved_warning', async ({ page }) => {
  156 |   requires(3);
  157 |   await namedWorkspace(page, 'Saved');
  158 |   await home(page);
  159 |   const dialog = await openForget(page, 'Saved');
  160 |   await expect(dialog.getByText(FORGET_BODY)).toBeVisible();
  161 |   await expect(dialog.getByText(UNSAVED_WARNING)).toHaveCount(0);
  162 | });
  163 | 
  164 | test('the not-found page lists remembered workspaces above Start @ref prd:not_found_recovery', async ({ page }) => {
  165 |   requires(3);
  166 |   await namedWorkspace(page, 'Still here');
  167 |   await page.goto('/w#' + 'z'.repeat(43));
  168 |   await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  169 |   const row = rememberedRow(page, 'Still here');
  170 |   await expect(row).toBeVisible();
  171 |   const rowBoxY = (await row.boundingBox())!.y;
  172 |   const startY = (await startButton(page).boundingBox())!.y;
  173 |   expect(rowBoxY).toBeLessThan(startY);
  174 | });
  175 | 
  176 | test('the header switcher lists remembered workspaces and switches @ref prd:list_remembered', async ({ page }) => {
  177 |   requires(3);
  178 |   await namedWorkspace(page, 'Alpha');
  179 |   await namedWorkspace(page, 'Beta');
> 180 |   await switcherTrigger(page, 'Beta').click();
      |                                       ^ TimeoutError: locator.click: Timeout 5000ms exceeded.
  181 |   await expect(page.getByRole('menuitem', { name: 'All workspaces' })).toBeVisible();
  182 |   await expect(page.getByRole('menuitem', { name: 'Forget this workspace on this browser' })).toBeVisible();
  183 |   await page.getByRole('menuitem', { name: /Alpha/ }).click();
  184 |   await expectWorkspace(page, 'Alpha');
  185 | });
  186 | 
  187 | test('remembered links are kept where page scripts cannot read them @ref prd:protected_memory', async ({ page, context }) => {
  188 |   requires(3);
  189 |   const link = await namedWorkspace(page, 'Private', false);
  190 |   const secret = new URL(link).hash.slice(1);
  191 |   await home(page);
  192 |   const readable = await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  193 |   expect(readable).not.toContain(secret);
  194 |   const cookies = await context.cookies();
  195 |   expect(cookies.some((c) => c.httpOnly)).toBe(true);
  196 | });
  197 | 
  198 | test('a failed list load offers retry and Start stays usable @ref prd:list_loading', async ({ page }) => {
  199 |   requires(3);
  200 |   await namedWorkspace(page, 'Alpha');
  201 |   await page.route('**/api/**', (r) => r.fulfill({ status: HTTP_UNAVAILABLE, contentType: 'application/json', body: '{"error":"internal"}' }));
  202 |   await page.goto('/');
  203 |   await expect(page.getByText("Couldn't load your workspaces")).toBeVisible();
  204 |   await expect(startButton(page)).toBeEnabled();
  205 |   await page.unroute('**/api/**');
  206 |   await page.getByRole('button', { name: 'Retry' }).click();
  207 |   await expect(rememberedRow(page, 'Alpha')).toBeVisible();
  208 | });
  209 | 
  210 | test('remembered-list actions work by touch with 44 px targets @ref prd:touch_usable', async ({ newPhone }) => {
  211 |   requires(3);
  212 |   const phone = await newPhone();
  213 |   await namedWorkspace(phone, 'Pocket');
  214 |   await home(phone);
  215 |   const trigger = rowBox(phone, 'Pocket').locator('[aria-haspopup="menu"]').first();
  216 |   await expect(trigger).toBeVisible();
  217 |   const b = (await trigger.boundingBox())!;
  218 |   expect(b.width).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  219 |   expect(b.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  220 |   await trigger.tap();
  221 |   await expect(phone.getByRole('menuitem', { name: 'Forget on this browser' })).toBeVisible();
  222 | });
  223 | 
```