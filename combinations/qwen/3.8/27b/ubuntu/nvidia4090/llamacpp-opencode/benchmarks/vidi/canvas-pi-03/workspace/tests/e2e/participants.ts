import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ensureBoardExists, getNotes, getObjects, gotoBoard, type NoteSnapshot, type ObjectSnapshot } from './helpers/board';
import { TEXT_ANNOTATION_300 } from '../fixtures/texts';

// --- board id generation (mirrors src/shared/board-id, no `@` alias here) ---

const BOARD_ID_BYTES = 16;
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64url');
}

// --- live-update latency budget (mirrors src/shared/config) ---
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
export const MAX_CONCURRENT_EDITORS = 5;
export const CONNECTED_CONFIRMATION_MS = 2000;

export interface Participant {
  context: BrowserContext;
  page: Page;
}

/**
 * Polls `fn` until truthy within `budgetMs`. This is the `expectWithin`
 * wrapper: it starts polling the moment it is called, so call it immediately
 * after the sender's DOM has updated to measure sender->receiver latency.
 */
export async function expectWithin(budgetMs: number, message: string, fn: () => Promise<boolean> | boolean): Promise<void> {
  await expect
    .poll(fn, { message, timeout: budgetMs, intervals: [15] })
    .toBe(true);
}

/** Waits until the page's connection has synced (connected or confirmed). */
export async function waitForSynced(page: Page, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => (window as any).__vidi6?.connectionState ?? 'none');
        return s === 'connected' || s === 'confirmed';
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

/** Opens an isolated browser context on the given board and waits for sync. */
export async function openBoard(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Story 5: a board link 404s until the board exists; create it (idempotent)
  // before navigating so specs that pass a shared id keep working.
  await ensureBoardExists(page, boardId);
  await page.goto(`/b/${boardId}`);
  await waitForSynced(page);
  return { context, page };
}

export async function closeParticipant(p: Participant): Promise<void> {
  await p.context.close();
}

/** Closes every participant. */
export async function closeAll(...ps: Participant[]): Promise<void> {
  for (const p of ps) await closeParticipant(p);
}

// --- camera + screen mapping ---------------------------------------------

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export async function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => (window as any).__vidi6?.getCamera?.() ?? { x: -640, y: -360, zoom: 1 });
}

/** Sets the page's camera (test build only). */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => (window as any).__vidi6?.setCamera?.(c), cam);
}

/** The note's centre in screen pixels for the page's current camera. */
export async function noteCenterScreen(page: Page, note: NoteSnapshot): Promise<{ x: number; y: number }> {
  const cam = await getCamera(page);
  const size = 200; // STICKY_SIZE_WORLD
  const cx = note.x + size / 2;
  const cy = note.y + size / 2;
  return { x: (cx - cam.x) * cam.zoom, y: (cy - cam.y) * cam.zoom };
}

// --- real-UI board actions ------------------------------------------------

/**
 * Double-clicks at a screen point to create a note; resolves to its id. The
 * double-click starts editing, so we Escape to leave the note in a clean
 * selected (not editing) state — otherwise later drags/clicks are swallowed by
 * the open textarea (handlePointerDown returns early while editing).
 */
export async function createNoteAt(page: Page, sx: number, sy: number): Promise<string> {
  const before = new Set((await getNotes(page)).map((n) => n.id));
  await page.mouse.dblclick(sx, sy);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        const newIds = (await getNotes(page)).filter((n) => !before.has(n.id)).map((n) => n.id);
        id = newIds.length === 1 ? newIds[0] : null;
        return id !== null;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  if (!id) throw new Error(`note not created at (${sx},${sy})`);
  // End editing so the note is selected but not in the textarea.
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeHidden({ timeout: 5000 });
  return id;
}

/** Canonical key over a note set (id -> fields), for cross-page comparison. */
export function notesKey(notes: NoteSnapshot[]): string {
  const map: Record<string, unknown> = {};
  for (const n of notes) map[n.id] = { x: n.x, y: n.y, color: n.color, text: n.text, z: n.z, createdAt: n.createdAt };
  // Sort by id and keep the FULL note data: a plain JSON.stringify of the map
  // with a replacer array would drop every nested property (the replacer is
  // applied to nested objects too), making the key useless for comparison.
  return JSON.stringify(Object.keys(map).sort().map((id) => [id, map[id]]));
}

/**
 * Edits a note with the caret at a given end: double-clicks, moves the caret
 * (Home/End), inserts `text` in one go, then Escape. One input event keeps the
 * Y.Text diff atomic (robust against concurrent remote updates).
 */
export async function editNote(page: Page, noteId: string, caret: 'start' | 'end', text: string): Promise<void> {
  const { x, y } = await centerOf(page, noteId);
  await page.mouse.dblclick(x, y);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press(caret === 'start' ? 'Home' : 'End');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeHidden({ timeout: 5000 });
}

async function centerOf(page: Page, noteId: string): Promise<{ x: number; y: number }> {
  const note = (await getNotes(page)).find((n) => n.id === noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  return noteCenterScreen(page, note);
}

/** Types into a note by double-clicking its centre, typing, then Escape. */
export async function typeInNote(page: Page, noteId: string, text: string): Promise<void> {
  const notes = await getNotes(page);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  const { x, y } = await noteCenterScreen(page, note);
  await page.mouse.dblclick(x, y);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeHidden({ timeout: 5000 });
}

/** Drags a note by (dx, dy) screen pixels from its current centre. */
export async function dragNoteBy(page: Page, noteId: string, dx: number, dy: number): Promise<void> {
  const notes = await getNotes(page);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  const { x, y } = await noteCenterScreen(page, note);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/** Selects a note (click its centre) so the toolbar is shown. */
export async function selectNote(page: Page, noteId: string): Promise<void> {
  const notes = await getNotes(page);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  const { x, y } = await noteCenterScreen(page, note);
  await page.mouse.click(x, y);
  await expect(page.locator('[data-testid="note-toolbar"]')).toBeVisible({ timeout: 5000 });
}

/** Recolours a selected note via its toolbar swatch. */
export async function recolorNote(page: Page, noteId: string, color: string): Promise<void> {
  await selectNote(page, noteId);
  await page.locator(`[data-testid="swatch-${color}"]`).click();
}

/** Deletes a note via its toolbar bin. */
export async function deleteNote(page: Page, noteId: string): Promise<void> {
  await selectNote(page, noteId);
  await page.locator('[data-testid="delete-note"]').click();
  await expect
    .poll(async () => (await getNotes(page)).some((n) => n.id === noteId), { timeout: 5000 })
    .toBe(false);
}

/** A single note by id (or null). */
export async function getNote(page: Page, id: string): Promise<NoteSnapshot | null> {
  return (await getNotes(page)).find((n) => n.id === id) ?? null;
}

/** The live connection state string ('connecting'|'connected'|...). */
export async function getConnectionState(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__vidi6?.connectionState ?? 'none');
}

/**
 * Force-drops the page's sync socket (test build) so the provider schedules a
 * reconnect. Playwright `setOffline` does not tear down an already-open
 * WebSocket, so this is the effective half of simulating a Wi-Fi drop.
 */
export async function dropConnection(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__vidi6?.dropConnection?.());
}

/** Resumes a dropped connection (test build) to simulate the network returning. */
export async function resumeConnection(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__vidi6?.resumeConnection?.());
}

/** The ConnectionStatus badge text, or null when the badge is hidden. */
export async function getBadgeText(page: Page): Promise<string | null> {
  const loc = page.locator('[data-testid="connection-status"]');
  if ((await loc.count()) === 0) return null;
  const text = await loc.textContent();
  return text && text.trim() ? text.trim() : null;
}

/** True when the note has a selection outline on this page (local state). */
export async function isSelected(page: Page, id: string): Promise<boolean> {
  return page.evaluate((noteId) => {
    const el = document.querySelector(`[data-id="${noteId}"][data-selected]`);
    return el !== null;
  }, id);
}

export { getNotes };

// --- story 9: text tool + text objects ------------------------------------

/** Mirrors src/shared/config (no `@` alias in e2e). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Presses T to activate the Text tool (story 9). */
export async function activateTextTool(page: Page): Promise<void> {
  await page.keyboard.press('t');
}

/**
 * Creates a text at a screen point via the Text tool. On return the editor
 * is open (caret at the end of the empty text) and the tool is back to
 * Select. Resolves to the new object id. The object is identified by its
 * anchor (top-left = the click's world point), which stays unique even when
 * other contexts create texts on the same board at the same time.
 */
export async function createTextAt(page: Page, sx: number, sy: number): Promise<string> {
  const cam = await getCamera(page);
  // Mirrors src/client/canvas/camera.ts screenToWorld: world = screen/zoom + cam.
  const wx = sx / cam.zoom + cam.x;
  const wy = sy / cam.zoom + cam.y;
  await activateTextTool(page);
  await page.mouse.click(sx, sy);
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        const atPoint = (await getObjects(page)).find(
          (o) =>
            o.type === 'text' &&
            Math.abs(o.x - wx) < 0.5 &&
            Math.abs(o.y - wy) < 0.5,
        );
        id = atPoint?.id ?? null;
        return id !== null;
      },
      { timeout: 5000 },
    )
    .toBe(true);
  await waitForEditorFocus(page);
  return id!;
}

/**
 * Waits until the text editor's textarea is visible AND focused (the mount
 * effect focuses it; the small window before the effect runs must not be
 * used for typing).
 */
async function waitForEditorFocus(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="text-textarea"]')).toBeVisible({ timeout: 5000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null),
      { timeout: 5000 },
    )
    .toBe('text-textarea');
}

/** Ends text editing (Escape); the text stays selected. */
export async function finishTextEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="text-textarea"]')).toBeHidden({ timeout: 5000 });
}

/** The object's centre in screen pixels for the page's current camera. */
export async function objectCenterScreen(page: Page, o: ObjectSnapshot): Promise<{ x: number; y: number }> {
  const cam = await getCamera(page);
  const cx = o.x + (o.width ?? 0) / 2;
  const cy = o.y + (o.height ?? 0) / 2;
  return { x: (cx - cam.x) * cam.zoom, y: (cy - cam.y) * cam.zoom };
}

/** Opens editing on a text object by double-clicking its centre. */
export async function editTextObject(page: Page, id: string): Promise<void> {
  const o = (await getObjects(page)).find((x) => x.id === id);
  if (!o) throw new Error(`text ${id} not found`);
  const { x, y } = await objectCenterScreen(page, o);
  await page.mouse.dblclick(x, y);
  await waitForEditorFocus(page);
}

/** A text object by id (or null). */
export async function getText(page: Page, id: string): Promise<ObjectSnapshot | null> {
  return (await getObjects(page)).find((o) => o.id === id) ?? null;
}

/** The text content of a text object (via its Y.Text snapshot field). */
export async function getTextContent(page: Page, id: string): Promise<string> {
  const o = await getText(page, id);
  return o?.text ?? '';
}

/**
 * TC-26: a 300-character annotation caps at TEXT_MAX_AUTO_WIDTH_WORLD and
 * wraps to several rendered lines. Runs in every browser (chromium, firefox,
 * webkit) — wrapping differences stay within the ±2 unit tolerance.
 */
export async function longAnnotationWraps(page: Page): Promise<void> {
  await gotoBoard(page);
  const id = await createTextAt(page, 400, 300);
  await page.keyboard.insertText(TEXT_ANNOTATION_300);
  await finishTextEdit(page);

  await expect
    .poll(async () => {
      const o = await getText(page, id);
      return (
        o !== null &&
        o.widthMode === 'auto' &&
        o.width !== undefined &&
        Math.abs(o.width - TEXT_MAX_AUTO_WIDTH_WORLD) <= 2
      );
    }, { timeout: 5000 })
    .toBe(true);

  const o = (await getText(page, id))!;
  // Several rendered lines: at size M one line is 20 * 1.3 = 26 world px;
  // more than two lines means height > 52.
  expect(o.height).toBeGreaterThan(52);
}

