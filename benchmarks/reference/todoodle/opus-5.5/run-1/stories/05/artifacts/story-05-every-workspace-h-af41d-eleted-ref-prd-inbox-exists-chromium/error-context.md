# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: story-05.spec.ts >> every workspace has an Inbox that cannot be renamed or deleted @ref prd:inbox_exists
- Location: tests/story-05.spec.ts:33:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('link', { name: /^Inbox(, \d+ open tasks?)?$/ })
Expected: "page"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('link', { name: /^Inbox(, \d+ open tasks?)?$/ }) with timeout 5000ms
  - waiting for getByRole('link', { name: /^Inbox(, \d+ open tasks?)?$/ })

```

```yaml
- status "Changes by others"
- banner:
  - group:
    - textbox "Workspace name": My Todoodle
    - status
  - button "Switch workspace"
  - button "Share"
- group:
  - complementary:
    - navigation "Lists":
      - button "Inbox"
  - main "Inbox":
    - heading "Inbox" [level=1]
    - paragraph: Your Inbox is clear. Press Q to add a task.
    - button "Add task"
- region "Notifications alt+T"
```

# Test source

```ts
  1   | // Story 5: capture a task into my Inbox in seconds.
  2   | import {
  3   |   test, expect, requires, freshServerPerFile, createWorkspace, workspaceWithTasks, addTasks, openQuickAdd,
  4   |   quickAddForm, nameInput, descriptionInput, addTaskButton, taskList, taskRows, taskRow, viewTitle, inboxLink,
  5   |   focusTask, mod, shot, PHONE,
  6   | } from './fixtures';
  7   | import type { Page, Route } from '@playwright/test';
  8   | 
  9   | freshServerPerFile();
  10  | 
  11  | const NAME_MAX = 500;
  12  | const DESCRIPTION_MAX = 5_000;
  13  | const WARN_RATIO = 0.9;
  14  | const MIN_TOUCH_PX = 44;
  15  | const HTTP_UNAVAILABLE = 503;
  16  | // Relative luminance bounds that tell a light page from a dark one.
  17  | const LIGHT_MIN = 0.7;
  18  | const DARK_MAX = 0.3;
  19  | const TASKS_GET = /\/api\/w\/[^/]+\/tasks(\?|$)/;
  20  | 
  21  | const addButton = (page: Page) => quickAddForm(page).getByRole('button', { name: 'Add', exact: true });
  22  | 
  23  | async function rowNames(page: Page) {
  24  |   const n = await taskRows(page).count();
  25  |   const names: string[] = [];
  26  |   for (let i = 0; i < n; i++) names.push((await taskRows(page).nth(i).innerText()).split('\n')[0].trim());
  27  |   return names;
  28  | }
  29  | 
  30  | const unavailable = (r: Route) =>
  31  |   r.fulfill({ status: HTTP_UNAVAILABLE, contentType: 'application/json', body: '{"error":"internal"}' });
  32  | 
  33  | test('every workspace has an Inbox that cannot be renamed or deleted @ref prd:inbox_exists', async ({ page }) => {
  34  |   requires(5);
  35  |   await createWorkspace(page);
  36  |   await expect(viewTitle(page)).toHaveText('Inbox');
  37  |   await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
> 38  |   await expect(inboxLink(page)).toHaveAttribute('aria-current', 'page');
      |                                 ^ Error: expect(locator).toHaveAttribute(expected) failed
  39  |   const inboxRow = page.locator('li, div').filter({ has: inboxLink(page) }).last();
  40  |   await expect(inboxRow.locator('[aria-haspopup="menu"]')).toHaveCount(0);
  41  | });
  42  | 
  43  | test('an empty Inbox says how to add a task @ref prd:empty_inbox', async ({ page }) => {
  44  |   requires(5);
  45  |   await createWorkspace(page);
  46  |   await expect(page.getByText('Your Inbox is clear. Press Q to add a task.')).toBeVisible();
  47  | });
  48  | 
  49  | test('quick add saves the task and shows it at once @ref prd:quick_add', async ({ page }) => {
  50  |   requires(5);
  51  |   await createWorkspace(page);
  52  |   await addButtonOpen(page);
  53  |   await nameInput(page).fill('Buy milk');
  54  |   await addButton(page).click();
  55  |   await expect(taskRow(page, 'Buy milk')).toBeVisible();
  56  |   await page.reload();
  57  |   await expect(taskRow(page, 'Buy milk')).toBeVisible();
  58  |   await shot(page, 's05-inbox');
  59  | });
  60  | 
  61  | async function addButtonOpen(page: Page) {
  62  |   await addTaskButton(page).first().click();
  63  |   await expect(quickAddForm(page)).toBeVisible();
  64  | }
  65  | 
  66  | test('Q opens quick add with the name field focused @ref prd:quick_add_shortcut', async ({ page }) => {
  67  |   requires(5);
  68  |   await createWorkspace(page);
  69  |   await page.locator('body').click({ position: { x: 5, y: 5 } });
  70  |   await page.keyboard.press('q');
  71  |   await expect(quickAddForm(page)).toBeVisible();
  72  |   await expect(nameInput(page)).toBeFocused();
  73  |   await expect(nameInput(page)).toHaveValue('');
  74  | });
  75  | 
  76  | test('a blank or whitespace name creates nothing @ref prd:reject_blank', async ({ page }) => {
  77  |   requires(5);
  78  |   await createWorkspace(page);
  79  |   await openQuickAdd(page);
  80  |   await expect(addButton(page)).toBeDisabled();
  81  |   await nameInput(page).fill('    ');
  82  |   await expect(addButton(page)).toBeDisabled();
  83  |   await nameInput(page).press('Enter');
  84  |   await expect(taskRows(page)).toHaveCount(0);
  85  |   await page.reload();
  86  |   await expect(page.getByText('Your Inbox is clear. Press Q to add a task.')).toBeVisible();
  87  | });
  88  | 
  89  | test('tasks show in the order added, newest last @ref prd:task_order', async ({ page }) => {
  90  |   requires(5);
  91  |   await workspaceWithTasks(page, 'First', 'Second', 'Third');
  92  |   expect(await rowNames(page)).toEqual(['First', 'Second', 'Third']);
  93  |   await page.reload();
  94  |   await expect(taskRows(page)).toHaveCount(3);
  95  |   expect(await rowNames(page)).toEqual(['First', 'Second', 'Third']);
  96  | });
  97  | 
  98  | test('after adding, quick add stays open, cleared, name focused @ref prd:quick_add_stays_open', async ({ page }) => {
  99  |   requires(5);
  100 |   await createWorkspace(page);
  101 |   await openQuickAdd(page);
  102 |   await nameInput(page).fill('With notes');
  103 |   await descriptionInput(page).fill('some detail');
  104 |   await nameInput(page).press('Enter');
  105 |   await expect(taskRow(page, 'With notes')).toBeVisible();
  106 |   await expect(quickAddForm(page)).toBeVisible();
  107 |   await expect(nameInput(page)).toHaveValue('');
  108 |   await expect(descriptionInput(page)).toHaveValue('');
  109 |   await expect(nameInput(page)).toBeFocused();
  110 | });
  111 | 
  112 | test('Escape closes quick add without creating a task @ref prd:quick_add_escape', async ({ page }) => {
  113 |   requires(5);
  114 |   await createWorkspace(page);
  115 |   await openQuickAdd(page);
  116 |   await nameInput(page).fill('Never mind');
  117 |   await page.keyboard.press('Escape');
  118 |   await expect(quickAddForm(page)).toBeHidden();
  119 |   await expect(taskRows(page)).toHaveCount(0);
  120 |   await page.reload();
  121 |   await expect(taskRow(page, 'Never mind')).toHaveCount(0);
  122 | });
  123 | 
  124 | test('quick add names the list it adds to @ref prd:destination_chip', async ({ page }) => {
  125 |   requires(5);
  126 |   await createWorkspace(page);
  127 |   await openQuickAdd(page);
  128 |   await expect(quickAddForm(page).getByText('→ Inbox')).toBeVisible();
  129 | });
  130 | 
  131 | test('Enter in the description adds a new line, not a task @ref prd:description_newline', async ({ page }) => {
  132 |   requires(5);
  133 |   await createWorkspace(page);
  134 |   await openQuickAdd(page);
  135 |   await nameInput(page).fill('Two lines');
  136 |   await page.keyboard.press('Tab');
  137 |   await expect(descriptionInput(page)).toBeFocused();
  138 |   await page.keyboard.type('line one');
```