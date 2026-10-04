import { Browser, BrowserContext, Page, expect } from '@playwright/test';
import { E2E_BASE_URL, createBoard } from './api';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';

/**
 * One isolated browser context on the board. All participants share the same
 * board id so they collaborate on the same room.
 */
export class Participant {
  constructor(
    public readonly name: string,
    public readonly context: BrowserContext,
    public readonly page: Page,
  ) {}

  /** All sticky notes on this participant's board. */
  notes() {
    return this.page.locator('[data-testid="sticky-note"]');
  }

  /** The sticky note whose visible text is `text`. */
  note(text: string) {
    return this.notes().filter({ hasText: text });
  }

  /** Visible text of every note on this participant's board. */
  async noteTexts(): Promise<string[]> {
    return this.page
      .locator('[data-testid="sticky-text-display"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
  }

  /**
   * End edit mode on this page. Escapes can be dropped under load, so retry
   * until no note is in edit mode. A stuck editor is dangerous: it leaves a
   * second textarea on the board that fill() can write into by mistake.
   */
  async ensureNoEditing(): Promise<void> {
    const editing = this.page.locator('[data-testid="sticky-note"][data-editing="true"]');
    for (let attempt = 0; attempt < 6; attempt++) {
      if ((await editing.count()) === 0) return;
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(100);
    }
    expect(await editing.count()).toBe(0);
  }

  /**
   * Create a note with `text` centred at screen point (x, y) and leave edit
   * mode. Returns once the note is visible with its text. Retries the
   * dblclick: under machine load individual click events can be dropped, so
   * the double-click may not register as a double-click. The textarea is
   * scoped to the note being created so a stray editor elsewhere can never
   * receive the text.
   */
  async createNote(text: string, x: number, y: number): Promise<void> {
    await this.ensureNoEditing();
    const editingNote = this.page.locator('[data-testid="sticky-note"][data-editing="true"]');
    // Candidate points: the requested point plus offsets. A dblclick on
    // EMPTY space creates a note (count grows); a dblclick on an EXISTING
    // note (e.g. dragged into this cell by another participant) only enters
    // edit mode (count unchanged) — detect that and try the next point.
    const candidates: Array<[number, number]> = [
      [x, y],
      [x, y + 55],
      [x + 55, y],
      [x - 55, y - 55],
      [x + 55, y + 55],
    ];
    for (const [px, py] of candidates) {
      await this.ensureNoEditing();
      const before = await this.notes().count();
      for (let attempt = 0; attempt < 4; attempt++) {
        await this.page.mouse.dblclick(px, py);
        const editing = await editingNote.first().isVisible().catch(() => false);
        const grew = (await this.notes().count()) > before;
        if (editing && grew) break;
        if (editing && !grew) {
          // Landed on an existing note: end its edit and try next point.
          await this.ensureNoEditing();
          break;
        }
        await this.page.waitForTimeout(150);
      }
      if ((await editingNote.first().isVisible().catch(() => false)) && (await this.notes().count()) > before) {
        const textarea = editingNote.first().getByTestId('sticky-textarea');
        await expect(textarea).toBeVisible();
        await textarea.fill(text);
        await this.ensureNoEditing();
        await expect(this.note(text)).toBeVisible();
        return;
      }
    }
    throw new Error(`createNote(${text}) failed at all candidate points near (${x},${y})`);
  }

  /** Enter edit mode on the note with `text` (retrying the dblclick).
   *
   * Verification uses the `data-editing` attribute, NOT the hasText note
   * filter: the moment a note enters edit mode its text moves into the
   * textarea, so `filter({ hasText })` no longer matches and a retry loop
   * built on it hangs.
   */
  async startEditNote(text: string): Promise<void> {
    await this.ensureNoEditing();
    const note = this.note(text);
    const editing = this.page.locator('[data-testid="sticky-note"][data-editing="true"]');
    for (let attempt = 0; attempt < 4; attempt++) {
      await note.dblclick();
      if (await editing.first().isVisible().catch(() => false)) return;
      // The dblclick did not enter edit mode: end any partial state and retry.
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(150);
    }
    expect(await editing.count()).toBe(1);
  }

  /** Drag the note with `text` by (dx, dy) screen pixels. */
  async dragNote(text: string, dx: number, dy: number): Promise<void> {
    const note = this.note(text);
    const box = (await note.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await this.page.mouse.move(cx, cy);
    await this.page.mouse.down();
    // steps:1 — a single move event carries the full delta. With many steps
    // under machine load, intermediate pointermove events can be dropped by
    // the browser, leaving the drag a fraction of the way there.
    await this.page.mouse.move(cx + dx, cy + dy, { steps: 1 });
    await this.page.mouse.up();
  }

  /**
   * Select the note with `text` (single click on its centre). Verifies the
   * selection and retries: single clicks can be dropped under load.
   */
  async selectNote(text: string): Promise<void> {
    const box = (await this.note(text).boundingBox())!;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const selected = await this.note(text).getAttribute('data-selected');
      if (selected === 'true') return;
      await this.page.waitForTimeout(100);
    }
    expect(await this.note(text).getAttribute('data-selected')).toBe('true');
  }

  /**
   * Recolour the currently selected note to `color`. Verifies the computed
   * background matches `wantRgb` and retries the swatch click (clicks can be
   * dropped under load).
   */
  async recolorSelected(color: string, wantRgb: string): Promise<void> {
    const swatch = this.page.getByTestId(`swatch-${color}`);
    for (let attempt = 0; attempt < 4; attempt++) {
      await swatch.click();
      const bg = await this.page
        .locator('[data-testid="sticky-note"][data-selected="true"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor)
        .catch(() => '');
      if (bg === wantRgb) return;
      await this.page.waitForTimeout(100);
    }
    const bg = await this.page
      .locator('[data-testid="sticky-note"][data-selected="true"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
      .catch(() => '');
    expect(bg).toBe(wantRgb);
  }

  /**
   * Delete the selected note with `text`. Verifies it is gone and retries the
   * key press: individual key events can be dropped under load.
   */
  async deleteSelected(text: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.page.keyboard.press('Delete');
      const count = await this.note(text).count();
      if (count === 0) return;
      await this.page.waitForTimeout(100);
    }
    expect(await this.note(text).count()).toBe(0);
  }

  /**
   * Snapshot of every note as `text@x,y` (world coordinates from the inline
   * style), sorted. Used to compare boards across participants.
   */
  async boardSnapshot(): Promise<string[]> {
    const entries = await this.page.locator('[data-testid="sticky-note"]').evaluateAll((els) =>
      els.map((el) => {
        const style = el.getAttribute('style') ?? '';
        const left = /left:\s*([-\d.]+)px/.exec(style)?.[1] ?? '0';
        const top = /top:\s*([-\d.]+)px/.exec(style)?.[1] ?? '0';
        const text = el.querySelector('[data-testid="sticky-text-display"]')?.textContent ?? '';
        return `${text}@${left},${top}`;
      }),
    );
    return entries.sort();
  }

  /** The mapped connection state (`window.__vidi6`, test builds only). */
  async connectionState(): Promise<string> {
    return this.page.evaluate(() => (window as any).__vidi6?.connectionState ?? 'unknown');
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

/**
 * Open `n` isolated browser contexts on the same fresh board and wait until
 * each is connected and synced (badge hidden / connectionState 'connected').
 * Story 5: the board is created via POST /api/boards first (rooms are no
 * longer created implicitly by connecting).
 */
export async function createParticipants(
  browser: Browser,
  n: number,
  baseUrl: string = E2E_BASE_URL,
): Promise<Participant[]> {
  const boardId = await createBoard(baseUrl);
  const participants: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');
    participants.push(new Participant(`P${i}`, context, page));
  }
  return participants;
}

/**
 * `expect.poll` wrapper with the functional E2E timeout. Records how long the
 * change took to appear and logs it against the latency budget. The budget is
 * *reported*, not asserted: model, browsers and server share one machine.
 */
export async function expectEventually(
  what: string,
  fn: () => boolean | Promise<boolean>,
): Promise<void> {
  const start = Date.now();
  await expect.poll(fn, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
  const elapsed = Date.now() - start;
  const over = elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS;
  console.log(
    `[latency] ${what}: ${elapsed}ms${over ? ` (over ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget — reported, not asserted)` : ''}`,
  );
}
