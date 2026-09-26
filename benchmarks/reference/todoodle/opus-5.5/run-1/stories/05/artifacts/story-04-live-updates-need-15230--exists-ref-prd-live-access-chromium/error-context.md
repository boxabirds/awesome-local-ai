# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-04.spec.ts >> live updates need the link, and say nothing about whether a workspace exists @ref prd:live_access
- Location: tests/story-04.spec.ts:156:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 404
Received: 403
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - main [ref=f1e3]:
    - heading "Todoodle" [level=1] [ref=f1e4]
    - paragraph [ref=f1e5]: A shared to-do list for getting things done together. No sign-up, just a link.
    - link "Continue to My Todoodle" [ref=f1e6] [cursor=pointer]:
      - /url: /w/875B757C858E163905A6913DCF2CE044
    - region [ref=f1e10]:
      - heading "Your workspaces on this browser" [level=2] [ref=f1e11]
      - list [ref=f1e12]:
        - listitem [ref=f1e13]:
          - link "My Todoodle just now" [ref=f1e14] [cursor=pointer]:
            - /url: /w/875B757C858E163905A6913DCF2CE044
            - generic [ref=f1e15]: My Todoodle
            - generic [ref=f1e16]: just now
          - button "More actions for My Todoodle" [ref=f1e17]
    - button "Start a new list" [ref=f1e23]
  - region "Notifications alt+T"
```

# Test source

```ts
  67  |   const link = await workspaceWithTasks(page);
  68  |   const other = await joined(page, newPerson, link);
  69  |   await addTasks(page, 'Milk');
  70  |   await expect(taskRow(other, 'Milk')).toBeVisible(LIVE_WAIT);
  71  | });
  72  | 
  73  | test('a task completed by one person leaves the other person\'s list without reload @ref prd:live_updates', async ({ page, newPerson }) => {
  74  |   requires(4, 6);
  75  |   const link = await workspaceWithTasks(page, 'Bread');
  76  |   const other = await joined(page, newPerson, link);
  77  |   await expect(taskRow(other, 'Bread')).toBeVisible();
  78  |   await checkbox(page, 'Complete', 'Bread').click();
  79  |   await expect(taskRow(other, 'Bread')).toHaveCount(0, LIVE_WAIT);
  80  | });
  81  | 
  82  | test('changes by someone else are announced politely as a count @ref prd:announce_remote', async ({ page, newPerson }) => {
  83  |   requires(4, 5);
  84  |   const link = await workspaceWithTasks(page);
  85  |   const other = await joined(page, newPerson, link);
  86  |   await addTasks(page, 'One', 'Two');
  87  |   await expect(taskRow(other, 'Two')).toBeVisible(LIVE_WAIT);
  88  |   const note = other.getByText(/^\d+ changes? made by someone else$/);
  89  |   await expect(note.first()).toBeAttached(LIVE_WAIT);
  90  |   const live = other.locator('[aria-live="polite"], [role="status"]').filter({ has: note });
  91  |   await expect(live.first()).toBeAttached();
  92  | });
  93  | 
  94  | test('an edit overtaken by someone else is flagged and can be kept @ref prd:conflict_notice @ref prd:conflict_choice', async ({ page, newPerson }) => {
  95  |   requires(4, 6);
  96  |   const link = await workspaceWithTasks(page, 'Paint fence');
  97  |   const other = await joined(page, newPerson, link);
  98  |   await typeNewName(page, 'Paint fence', 'Paint fence blue');
  99  |   const theirs = await typeNewName(other, 'Paint fence', 'Paint fence green');
  100 |   await theirs.press('Enter');
  101 |   await expect(page.getByText(CONFLICT_TEXT)).toBeVisible(LIVE_WAIT);
  102 |   await page.getByRole('button', { name: 'Use my version' }).click();
  103 |   await expect(page.getByText(CONFLICT_TEXT)).toHaveCount(0);
  104 |   await page.keyboard.press('Escape');
  105 |   await page.keyboard.press('Escape');
  106 |   await expect(taskRow(other, 'Paint fence blue')).toBeVisible(LIVE_WAIT);
  107 | });
  108 | 
  109 | test('an edit overtaken by someone else can give way to theirs @ref prd:conflict_choice', async ({ page, newPerson }) => {
  110 |   requires(4, 6);
  111 |   const link = await workspaceWithTasks(page, 'Book hall');
  112 |   const other = await joined(page, newPerson, link);
  113 |   await typeNewName(page, 'Book hall', 'Book big hall');
  114 |   const theirs = await typeNewName(other, 'Book hall', 'Book small hall');
  115 |   await theirs.press('Enter');
  116 |   await expect(page.getByText(CONFLICT_TEXT)).toBeVisible(LIVE_WAIT);
  117 |   await page.getByRole('button', { name: 'Keep theirs' }).click();
  118 |   await page.keyboard.press('Escape');
  119 |   await page.keyboard.press('Escape');
  120 |   await expect(taskRow(page, 'Book small hall')).toBeVisible();
  121 |   await page.reload();
  122 |   await expect(taskRow(page, 'Book small hall')).toBeVisible();
  123 | });
  124 | 
  125 | test('offline shows a banner, stops edits and keeps typed text @ref prd:offline_indicator', async ({ page, context }) => {
  126 |   requires(4, 5);
  127 |   await workspaceWithTasks(page);
  128 |   await openQuickAdd(page);
  129 |   await nameInput(page).fill('half-typed');
  130 |   await context.setOffline(true);
  131 |   const banner = page.getByRole('status').filter({ hasText: OFFLINE_TEXT });
  132 |   await expect(banner).toBeVisible();
  133 |   await expect(nameInput(page)).toBeDisabled();
  134 |   await expect(nameInput(page)).toHaveValue('half-typed');
  135 |   await shot(page, 's04-offline');
  136 |   await context.setOffline(false);
  137 |   await expect(banner).toHaveCount(0, { timeout: 15_000 });
  138 |   await expect(nameInput(page)).toBeEnabled();
  139 |   await expect(nameInput(page)).toHaveValue('half-typed');
  140 | });
  141 | 
  142 | test('losing only live updates shows Reconnecting and editing stays on @ref prd:live_paused', async ({ page, newPerson }) => {
  143 |   requires(4, 5);
  144 |   const link = await workspaceWithTasks(page);
  145 |   const other = await newPerson();
  146 |   // Every WebSocket the page opens is closed at once; plain HTTP still works.
  147 |   await other.routeWebSocket(/.*/, (ws) => ws.close());
  148 |   await openLink(other, link);
  149 |   await expect(other.getByRole('status').filter({ hasText: 'Reconnecting…' })).toBeVisible(PILL_WAIT);
  150 |   await expect(addTaskButton(other).first()).toBeEnabled();
  151 |   await addTasks(other, 'Saved without live');
  152 |   await page.reload();
  153 |   await expect(taskRow(page, 'Saved without live')).toBeVisible();
  154 | });
  155 | 
  156 | test('live updates need the link, and say nothing about whether a workspace exists @ref prd:live_access', async ({ page, playwright, baseURL }) => {
  157 |   requires(3, 4);
  158 |   await createWorkspace(page);
  159 |   await page.goto('/');
  160 |   const href = await rememberedRows(page).first().getAttribute('href');
  161 |   const id = href!.split('/').pop()!;
  162 |   const stranger = await playwright.request.newContext({ baseURL });
  163 |   const real = await stranger.get(`/api/w/${id}/live`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } });
  164 |   // Same shape as a real id, one character changed: an id that doesn't exist.
  165 |   const unknown = id.slice(0, -1) + (id.endsWith('0') ? '1' : '0');
  166 |   const fake = await stranger.get(`/api/w/${unknown}/live`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } });
> 167 |   expect(real.status()).toBe(404);
      |                         ^ Error: expect(received).toBe(expected) // Object.is equality
  168 |   expect(fake.status()).toBe(404);
  169 |   expect(await real.text()).toBe(await fake.text());
  170 |   await stranger.dispose();
  171 | });
  172 | 
```