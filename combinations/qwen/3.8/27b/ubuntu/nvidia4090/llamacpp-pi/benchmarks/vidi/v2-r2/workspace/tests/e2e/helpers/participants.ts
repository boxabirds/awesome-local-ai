import { type BrowserContext, type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';

/**
 * Live-collaboration e2e helpers (story 3): a Participant is one browser
 * page on a shared board, driven through the real UI (double-click create,
 * drag, toolbar) and observed through the test-only window.__vidi6 hooks.
 * LatencyLog measures sender-to-receiver propagation and prints a
 * p50/p95/max report (reported, never asserted — see PRD live.propagate).
 */

export interface ObjectState {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** STICKY_SIZE_WORLD / 2 — model x,y is the note's top-left corner. */
const NOTE_HALF = 100;

/**
 * Bounded timeout for UI actions that depend on a transient target (the
 * note toolbar, the editor). If the target never becomes actionable (e.g. a
 * note drifted off-screen so its selection missed), the action fails fast
 * instead of hanging until the test timeout. Callers in long-running soaks
 * catch and continue.
 */
const ACTION_TIMEOUT_MS = 5_000;

/** The default camera renders the world origin at (640,400) at zoom 1. */
function worldToScreenDefault(p: Point): Point {
  return { x: 640 + p.x, y: 400 + p.y };
}

export class LatencyLog {
  private samples: { label: string; ms: number }[] = [];

  record(label: string, ms: number): void {
    this.samples.push({ label, ms });
  }

  get count(): number {
    return this.samples.length;
  }

  /** Prints (does not assert) the p50/p95/max report for one test. */
  report(testName: string, budgetMs: number): void {
    if (this.samples.length === 0) {
      console.log(`[latency] ${testName}: no samples`);
      return;
    }
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const pct = (p: number): number =>
      sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
    const max = sorted[sorted.length - 1];
    console.log(
      `[latency] ${testName}: n=${sorted.length} p50=${pct(0.5).toFixed(0)}ms ` +
        `p95=${pct(0.95).toFixed(0)}ms max=${max.toFixed(0)}ms ` +
        `(budget ${budgetMs}ms — reported, not asserted)`,
    );
  }
}

export class Participant {
  readonly page: Page;
  /** Console error messages observed on this page (browser network noise
      during an offline phase is expected and filtered by callers). */
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];

  private constructor(page: Page) {
    this.page = page;
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      this.pageErrors.push(String(err));
    });
  }

  /** Opens /b/<boardId> in a new tab and waits until synced+connected. */
  static async join(
    context: BrowserContext,
    boardId: string,
    timeoutMs = 20_000,
  ): Promise<Participant> {
    const page = await context.newPage();
    const p = new Participant(page);
    await page.goto(`/b/${encodeURIComponent(boardId)}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
    await page.waitForFunction(
      () => window.__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: timeoutMs, polling: 100 },
    );
    return p;
  }

  // --- observation (test hook) -------------------------------------------

  async objects(): Promise<ObjectState[]> {
    return this.page.evaluate(() => window.__vidi6?.getObjects() ?? []);
  }

  async object(id: string): Promise<ObjectState | null> {
    return this.page.evaluate((nid) => window.__vidi6?.getObject(nid) ?? null, id);
  }

  async connectionState(): Promise<string> {
    return this.page.evaluate(() => window.__vidi6?.connectionState ?? 'unknown');
  }

  /** The badge's text, or null while connected (badge hidden). */
  async badgeText(): Promise<string | null> {
    return this.page.evaluate(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el === null ? null : (el.textContent ?? null);
    });
  }

  /** Polls the test hook until `fn` holds; returns the final board state. */
  async waitFor(
    fn: (objs: ObjectState[]) => boolean,
    what: string,
    timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
  ): Promise<ObjectState[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const objs = await this.objects();
      if (fn(objs)) {
        return objs;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${what}; board has ${objs.length} notes: ` +
            objs.map((o) => `${o.text}@${Math.round(o.x)},${Math.round(o.y)}`).join(' | '),
        );
      }
      await this.page.waitForTimeout(75);
    }
  }

  /** Waits until every other participant satisfies `fn`; ms until all did. */
  async waitForOthers(
    others: Participant[],
    fn: (objs: ObjectState[]) => boolean,
    what: string,
    timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
  ): Promise<number> {
    const started = Date.now();
    await Promise.all(others.map((o) => o.waitFor(fn, what, timeoutMs)));
    return Date.now() - started;
  }

  // --- real-UI actions -----------------------------------------------------

  /** The screen centre of one note. */
  async noteCenter(id: string): Promise<Point> {
    const box = (await this.page.locator(`[data-sticky-note="${id}"]`).boundingBox()) ?? undefined;
    if (box === undefined) {
      throw new Error(`note ${id} has no bounding box`);
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /**
   * Double-clicks the empty board at a world point (default camera) and
   * types `text` into the new note. Returns the note's id.
   */
  async createNote(world: Point, text = ''): Promise<string> {
    const screen = worldToScreenDefault(world);
    await this.page.mouse.dblclick(screen.x, screen.y);
    await this.page.getByTestId('sticky-textarea').waitFor({ timeout: ACTION_TIMEOUT_MS });
    if (text !== '') {
      await this.page.keyboard.type(text);
    }
    await this.page.keyboard.press('Escape');
    const objs = await this.objects();
    const created = objs.find(
      (o) => Math.abs(o.x + NOTE_HALF - world.x) < 1 && Math.abs(o.y + NOTE_HALF - world.y) < 1,
    );
    if (created === undefined) {
      throw new Error(`created note not found near world (${world.x}, ${world.y})`);
    }
    return created.id;
  }

  /** Double-clicks a note to enter edit mode (no typing). */
  async enterEdit(id: string): Promise<void> {
    const c = await this.noteCenter(id);
    await this.page.mouse.dblclick(c.x, c.y);
    await this.page.getByTestId('sticky-textarea').waitFor({ timeout: ACTION_TIMEOUT_MS });
  }

  /** Types into the (already open) editor without leaving edit mode. */
  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text);
  }

  /** Leaves edit mode (Escape keeps the note selected). */
  async finishEdit(): Promise<void> {
    await this.page.keyboard.press('Escape');
    // Wait for the editor to close (a lost Escape under load would otherwise
    // leave the note editing, hiding its toolbar and breaking the next op).
    await this.page
      .waitForFunction(
        () => document.querySelector('[data-testid="sticky-textarea"]') === null,
        undefined,
        { timeout: ACTION_TIMEOUT_MS, polling: 50 },
      )
      .catch(() => undefined);
  }

  /** If the note is currently being edited, exit edit mode so its toolbar
      renders (the toolbar is hidden while a note is in edit mode). */
  private async exitIfEditing(id: string): Promise<void> {
    for (let i = 0; i < 2; i++) {
      const editing = await this.page
        .locator(`[data-sticky-note="${id}"][data-editing="true"]`)
        .count();
      if (editing === 0) {
        return;
      }
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(60);
    }
  }

  /** Double-clicks a note, types, and leaves edit mode. */
  async typeInto(id: string, text: string): Promise<void> {
    await this.enterEdit(id);
    await this.type(text);
    await this.finishEdit();
  }

  /** Drags a note by a screen-px delta (zoom 1: same as world units). */
  async moveNote(id: string, delta: Point, steps = 8): Promise<void> {
    const from = await this.noteCenter(id);
    const { page } = this;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(50);
  }

  async select(id: string): Promise<void> {
    const c = await this.noteCenter(id);
    await this.page.mouse.click(c.x, c.y);
    // Confirm the note is actually selected (a click can miss under load);
    // the floating toolbar only renders for a selected, non-editing note, so
    // this is the precondition recolor/delete rely on.
    await this.page
      .locator(`[data-sticky-note="${id}"][data-selected="true"]`)
      .waitFor({ timeout: ACTION_TIMEOUT_MS });
  }

  async recolor(id: string, color: string): Promise<void> {
    await this.select(id);
    await this.exitIfEditing(id);
    await this.page.getByTestId(`note-swatch-${color}`).click({ timeout: ACTION_TIMEOUT_MS });
  }

  async deleteNote(id: string): Promise<void> {
    await this.select(id);
    await this.exitIfEditing(id);
    await this.page.getByTestId('note-delete-button').click({ timeout: ACTION_TIMEOUT_MS });
  }

  // --- health --------------------------------------------------------------

  hasErrors(): boolean {
    return this.consoleErrors.length > 0 || this.pageErrors.length > 0;
  }

  errorDetails(): string {
    return [...this.pageErrors.map((e) => `pageerror: ${e}`), ...this.consoleErrors].join('\n');
  }
}

/** A fresh, valid board id (same algorithm the client uses). */
export function newBoard(): string {
  return newBoardId();
}

/** Two boards agree on the full (id, x, y, z, color, text) set. */
export function sameBoard(
  a: readonly ObjectState[],
  b: readonly ObjectState[],
): boolean {
  const key = (o: ObjectState): string =>
    `${o.id}|${o.text}|${o.x}|${o.y}|${o.z}|${o.color}`;
  if (a.length !== b.length) {
    return false;
  }
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}
