// Story 3, task 9: nightly e2e soak tests (TC-29, TC-30).
//
// These are slow on purpose (45-60s of real time) and run under
// `npm run test:e2e:nightly`, not the default e2e suite.

import { expect, test, type Browser, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import {
  closeParticipant,
  connectionState,
  newBoard,
  openParticipant,
  type Participant,
} from '../participants';

const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/**
 * Note top-left positions stay inside this screen rectangle. Notes are
 * 200×200 and their floating toolbars sit 40 px above the note's top edge,
 * centred — these bounds keep every note and toolbar fully within the
 * 1280×800 viewport and clear of the fixed UI (left toolbar ≤ x 70, zoom
 * controls at x ≥ 1094 / y ≥ 739). The board's pan is transform-based, so
 * a locator interaction with an off-screen element can never be scrolled
 * into view and would hang; staying inside the viewport avoids that.
 */
const SAFE = { x0: 90, y0: 60, x1: 1080, y1: 600 };
const NOTE_SIZE = 200;
const NOTE_MARGIN = 16;
/** The toolbar strip height (see `collides`). */
const TOOLBAR_CLEARANCE = 48;

/**
 * Cap on the number of notes. The safe rectangle (990×540) fits four
 * non-interfering 200×200 notes (each needs a 232×296 exclusive zone), so
 * above this creates/moves would always have to fall back.
 */
const MAX_NOTES = 4;

interface Box { id: string | null; x: number; y: number; w: number; h: number }

async function noteBoxes(page: Page): Promise<Box[]> {
  return page.locator('.sticky-note').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-note-id'), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
}

/**
 * Would a note with top-left (x, y) interfere with note box `b`?
 *  - boxes must keep a 16 px gap (corner/centre clicks then always hit the
 *    intended note);
 *  - the vertical gap must be ≥ TOOLBAR_CLEARANCE in both directions: a
 *    note's floating toolbar occupies the 40 px strip above its top edge,
 *    and a neighbouring note body inside that strip covers the toolbar
 *    buttons (locator clicks on covered elements wait forever).
 */
function collides(x: number, y: number, b: Box): boolean {
  if (!(x < b.x + b.w + NOTE_MARGIN && x + NOTE_SIZE > b.x - NOTE_MARGIN)) return false;
  if (y < b.y + b.h + NOTE_MARGIN && y + NOTE_SIZE > b.y - NOTE_MARGIN) return true;
  const gapAbove = y - (b.y + b.h); // > 0: b sits above the candidate
  const gapBelow = b.y - (y + NOTE_SIZE); // > 0: b sits below the candidate
  if (gapAbove > 0 && gapAbove < TOOLBAR_CLEARANCE) return true;
  if (gapBelow > 0 && gapBelow < TOOLBAR_CLEARANCE) return true;
  return false;
}

/**
 * A top-left position inside SAFE where a NOTE_SIZE×NOTE_SIZE note fits
 * without interfering with any other note (see `collides`).
 */
function findFreeNoteRect(boxes: Box[], exceptId?: string): { x: number; y: number } | null {
  const others = boxes.filter((b) => b.id !== exceptId);
  for (let i = 0; i < 40; i++) {
    const x = SAFE.x0 + Math.random() * (SAFE.x1 - SAFE.x0 - NOTE_SIZE);
    const y = SAFE.y0 + Math.random() * (SAFE.y1 - SAFE.y0 - NOTE_SIZE);
    if (!others.some((b) => collides(x, y, b))) return { x, y };
  }
  return null;
}

async function recolorOp(page: Page, id: string): Promise<OpResult> {
  const current = await page
    .locator(`.sticky-note[data-note-id="${id}"]`)
    .getAttribute('data-color');
  const others = COLORS.filter((c) => c !== current);
  const color = others[Math.floor(Math.random() * others.length)];
  const box = (await page.locator(`.sticky-note[data-note-id="${id}"]`).boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12);
  await page
    .locator(
      `.note-toolbar button[aria-label="${color.charAt(0).toUpperCase()}${color.slice(1)} colour"]`,
    )
    .click();
  return { kind: 'recolor', noteId: id, color };
}

const EDITOR = '.sticky-note textarea';

interface OpResult {
  kind: 'create' | 'type' | 'move' | 'recolor' | 'delete';
  noteId?: string;
  word?: string;
  color?: string;
  /** sender's final note box, for move checks */
  box?: { x: number; y: number };
}

async function boardNoteIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator('.sticky-note')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-note-id')));
  return ids.filter((id): id is string => id !== null);
}

async function noteTextOf(page: Page, id: string): Promise<string> {
  return page.locator(`.sticky-note[data-note-id="${id}"] .sticky-note__text`).innerText();
}

async function findNoteIdByText(page: Page, text: string): Promise<string> {
  const all = await page
    .locator('.sticky-note')
    .evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-note-id'),
        text: el.querySelector('.sticky-note__text')?.textContent ?? '',
      })),
    );
  const match = all.find((n) => n.text === text);
  expect(match, `note with text "${text}"`).toBeTruthy();
  return match!.id as string;
}

/** Perform one random edit through the real UI; returns what to check on receivers. */
async function performOp(page: Page, n: number): Promise<OpResult> {
  const ids = await boardNoteIds(page);
  const pick = ids[Math.floor(Math.random() * ids.length)];
  let roll = Math.random();
  const word = `w${n}`;

  // Above MAX_NOTES the board gets crowded; convert would-be creates into
  // type ops so the note count (and the screen) stays manageable.
  if (ids.length >= MAX_NOTES && roll < 0.3) roll = 0.5;

  if (roll < 0.3 || ids.length === 0) {
    // create at a free spot (a dblclick on an existing note would enter edit
    // mode instead of creating, and the exact-text lookup would then fail).
    // Notes are centred on the dblclick point, so click the rect's centre.
    const boxes = await noteBoxes(page);
    const at = findFreeNoteRect(boxes);
    if (!at) {
      // no free spot: type into a random note instead of creating
      const id = pick;
      await page.locator(`.sticky-note[data-note-id="${id}"]`).dblclick();
      await page.locator(EDITOR).waitFor({ state: 'visible', timeout: 5000 });
      await page.keyboard.press('End');
      await page.keyboard.type(` ${word}`);
      await page.keyboard.press('Escape');
      return { kind: 'type', noteId: id, word };
    }
    await page.locator('[data-testid="board-viewport"]').dblclick({
      position: { x: at.x + NOTE_SIZE / 2, y: at.y + NOTE_SIZE / 2 },
    });
    await page.locator(EDITOR).waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.type(word);
    await page.keyboard.press('Escape');
    const id = await findNoteIdByText(page, word);
    return { kind: 'create', noteId: id, word };
  }
  if (roll < 0.6) {
    // type into a random note
    const id = pick;
    await page.locator(`.sticky-note[data-note-id="${id}"]`).dblclick();
    await page.locator(EDITOR).waitFor({ state: 'visible', timeout: 5000 });
    // A dblclick inside the editor may select a word; End clears the
    // selection and puts the caret at the line end so the insert is an
    // append (deterministic on every browser).
    await page.keyboard.press('End');
    await page.keyboard.type(` ${word}`);
    await page.keyboard.press('Escape');
    return { kind: 'type', noteId: id, word };
  }
  if (roll < 0.75) {
    // move a random note to a free on-screen target (overlapping notes make
    // corner clicks ambiguous; relative offsets would drift off-screen)
    const id = pick;
    const boxes = await noteBoxes(page);
    const target = findFreeNoteRect(boxes, id);
    if (!target) return recolorOp(page, id);
    const box = (await page.locator(`.sticky-note[data-note-id="${id}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + box.width / 2, target.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    // let the drag's final (rAF-throttled) position flush before reading it
    await page.waitForTimeout(50);
    const final = (await page.locator(`.sticky-note[data-note-id="${id}"]`).boundingBox())!;
    return { kind: 'move', noteId: id, box: { x: final.x, y: final.y } };
  }
  if (roll < 0.9) {
    // recolor a random note
    return recolorOp(page, pick);
  }
  // delete a random note
  const id = pick;
  const box = (await page.locator(`.sticky-note[data-note-id="${id}"]`).boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 12);
  await page.keyboard.press('Delete');
  return { kind: 'delete', noteId: id };
}

/** Measure (ms) until `check` passes on `page`, from `t0`; budget-capped. */
async function measureLatency(page: Page, t0: number, check: () => Promise<boolean>): Promise<number> {
  const deadline = t0 + LIVE_UPDATE_LATENCY_BUDGET_MS;
  for (;;) {
    if (await check()) return Date.now() - t0;
    if (Date.now() >= deadline) {
      throw new Error(`receiver did not converge within ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Converged-check for non-move ops (the move check needs a boundingBox and is inline in the loop). */
async function checkOp(page: Page, op: OpResult): Promise<boolean> {
  const noteLoc = page.locator(`.sticky-note[data-note-id="${op.noteId}"]`);
  switch (op.kind) {
    case 'create':
      return (await noteLoc.count()) === 1;
    case 'type':
      return (await noteLoc.locator('.sticky-note__text').innerText()).includes(op.word!);
    case 'recolor':
      return (await noteLoc.getAttribute('data-color')) === op.color;
    case 'delete':
      return (await noteLoc.count()) === 0;
    case 'move':
      return false; // handled inline
  }
}

/** Full final-board state for cross-participant equality. */
async function boardState(page: Page): Promise<unknown> {
  return page
    .locator('.sticky-note')
    .evaluateAll((els) =>
      els
        .map((el) => ({
          id: el.getAttribute('data-note-id'),
          text: el.querySelector('.sticky-note__text')?.textContent ?? '',
          color: el.getAttribute('data-color'),
          x: Math.round(parseFloat(el.style.left)),
          y: Math.round(parseFloat(el.style.top)),
        }))
        .sort((a, b) => (a.id! < b.id! ? -1 : 1)),
    );
}

test.describe.configure({ mode: 'serial' });

test('TC-29: idle 45s — the connection stays "connected" (no false reconnect)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const boardId = await newBoard(baseURL!);
  const alex = await openParticipant(browser, boardId);
  const sam = await openParticipant(browser, boardId);
  try {
    // 45 seconds, sampled every 5 seconds: the mapped state must never leave
    // "connected" and the badge must never appear.
    for (let i = 0; i < 9; i++) {
      for (const { page } of [alex, sam]) {
        expect(await connectionState(page)).toBe('connected');
        expect(await page.locator('.connection-status').count()).toBe(0);
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

test('TC-30: 5-way continuous edit soak (60s) — latency, badge, convergence', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const boardId = await newBoard(baseURL!);
  const parts: Participant[] = [];
  for (let i = 0; i < 5; i++) parts.push(await openParticipant(browser, boardId));
  const latencies: number[] = [];
  let ops = 0;
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const [sender, ...receivers] = [
        parts[ops % 5],
        ...parts.filter((_, i) => i !== ops % 5),
      ];
      const op = await performOp(sender.page, ops);
      // t0: the sender's DOM already reflects the change. Every receiver is
      // measured from the same t0 and polled in PARALLEL: a sequential loop
      // would charge each later receiver for the time spent verifying the
      // earlier ones, biasing their measured latency upward (four slowish
      // receivers could push the last one past the budget even though it
      // converged well inside it).
      const t0 = Date.now();
      const results = await Promise.all(
        receivers.map(async (receiver) => {
          return measureLatency(
            receiver.page,
            t0,
            async () => {
              if (op.kind === 'move') {
                const b = await receiver.page
                  .locator(`.sticky-note[data-note-id="${op.noteId}"]`)
                  .boundingBox();
                if (b === null) return false;
                return Math.abs(b.x - op.box!.x) < 2 && Math.abs(b.y - op.box!.y) < 2;
              }
              return checkOp(receiver.page, op);
            },
          );
        }),
      );
      latencies.push(...results);
      // The badge stays hidden (connected) in ALL contexts throughout.
      for (const p of parts) {
        expect(await connectionState(p.page)).toBe('connected');
      }
      ops++;
    }

    // All final board snapshots are identical.
    const states = await Promise.all(parts.map((p) => boardState(p.page)));
    for (let i = 1; i < states.length; i++) {
      expect(states[i], `participant ${i} diverged`).toEqual(states[0]);
    }

    // Latency stats (PRD live.latency: every observation <= the budget is
    // already asserted inside the loop; the stats are for the record).
    const sorted = [...latencies].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    console.log(
      `[soak] ops=${ops} receivers-observed=${latencies.length} ` +
        `p50=${q(0.5)}ms p95=${q(0.95)}ms max=${sorted[sorted.length - 1]}ms ` +
        `budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms final-notes=${(states[0] as unknown[]).length}`,
    );
    expect(ops).toBeGreaterThan(10);
  } finally {
    // Teardown: closing each context destroys the provider (no reconnect
    // attempts can be scheduled afterwards — the socket is gone with the
    // context). Assert each context actually closed.
    for (const p of parts) {
      await closeParticipant(p);
      expect(p.context.isClosed()).toBe(true);
    }
  }
});
