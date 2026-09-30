// Nightly (npm run test:e2e:nightly): too slow for every commit.
import { type Page, expect, test } from '@playwright/test';
import { STICKY_COLORS, type StickyColor, MAX_CONCURRENT_EDITORS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { pickKind, seededRandom } from '../fixtures/random-ops';
import { connectionBadge, nextFrames, setCamera } from './helpers/board';
import {
  LatencyLog,
  type Participant,
  boardState,
  closeParticipants,
  getNotes,
  openParticipants,
  webSocketAttempts,
} from './helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;
const POLL_MS = 20;
// Mid-right: clear of notes (AREA), the tools (left) and the zoom controls (bottom right).
const EMPTY_SPOT = { x: 1220, y: 400 };
const AREA = { left: 80, top: 80, right: 1100, bottom: 700 };
const COLOR_LABELS = Object.keys(STICKY_COLORS).map((c) => `${c[0]!.toUpperCase()}${c.slice(1)} colour`);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test.describe('story 3: live collaboration (nightly)', () => {
  let participants: Participant[] = [];
  const log = new LatencyLog();

  test.afterEach(async ({}, testInfo) => {
    await log.report(testInfo);
    log.samples.length = 0;
    await closeParticipants(participants);
    participants = [];
  });

  test('TC-29: an idle connection stays connected for 45 s', async ({ browser }) => {
    test.setTimeout(IDLE_MS + 60_000);
    participants = await openParticipants(browser, 2);
    const attemptsBefore = await Promise.all(participants.map((p) => webSocketAttempts(p.page)));
    const end = Date.now() + IDLE_MS;
    while (Date.now() < end) {
      for (const p of participants) await expect(connectionBadge(p.page)).toHaveCount(0);
      await sleep(1000);
    }
    for (const [i, p] of participants.entries()) {
      const states = await p.page.evaluate(() => window.__vidi6?.connectionStates ?? []);
      expect(states).not.toContain('reconnecting');
      expect(await p.page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
      // No reconnect attempts while idle.
      expect(await webSocketAttempts(p.page)).toBe(attemptsBefore[i]);
    }
  });

  test(`TC-30: capacity soak — MAX_CONCURRENT_EDITORS (${MAX_CONCURRENT_EDITORS}) people edit for 60 s`, async ({ browser }) => {
    test.setTimeout(SOAK_MS + 180_000);
    const seed = Date.now() >>> 0;
    console.log(`[TC-30] seed ${seed}`);
    participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    await Promise.all(participants.map((p) => setCamera(p.page, { x: -200, y: -200, zoom: 0.25 })));

    const created = new Set<string>();
    const deleted = new Set<string>();
    interface Pending {
      label: string;
      sentAt: number;
      id: string;
      token: string | null;
      waiting: Set<number>;
    }
    const pending: Pending[] = [];
    let unmeasured = 0;
    const expectEverywhere = (sender: number, label: string, id: string, token: string | null) => {
      const waiting = new Set(participants.map((_, i) => i).filter((i) => i !== sender));
      pending.push({ label, sentAt: Date.now(), id, token, waiting });
    };

    /** In-order subsequence: other people may type into the same note at the same time. */
    const containsToken = (text: string, token: string) => {
      let i = 0;
      for (const ch of text) if (ch === token[i]) i++;
      return i === token.length;
    };

    let soaking = true;
    // One poller per receiver resolves every pending change as soon as it appears there.
    const pollers = participants.map(async (receiver, index) => {
      while (soaking || pending.some((p) => p.waiting.has(index))) {
        const notes = await getNotes(receiver.page);
        const now = Date.now();
        for (const p of pending) {
          if (!p.waiting.has(index)) continue;
          if (deleted.has(p.id)) {
            p.waiting.delete(index);
            unmeasured++;
            continue;
          }
          const note = notes.find((n) => n.id === p.id);
          if (note && (p.token === null || containsToken(note.text, p.token))) {
            p.waiting.delete(index);
            log.record(`${p.label} → ${receiver.name}`, now - p.sentAt);
          } else if (now - p.sentAt > E2E_EVENTUAL_TIMEOUT_MS) {
            throw new Error(`${p.label} never reached ${receiver.name} (seed ${seed})`);
          }
        }
        await sleep(POLL_MS);
      }
    });

    let tokenCounter = 0;
    const editingId = (page: Page) =>
      page.locator('[data-sticky-note][data-editing="true"]').first().getAttribute('data-id', { timeout: 1000 });
    const clickEmpty = async (page: Page) => {
      await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
      await nextFrames(page);
    };
    const randomNoteCentre = async (page: Page, rand: () => number) => {
      const boxes = await page.locator('[data-sticky-note]').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.getAttribute('data-id')!, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );
      const visible = boxes.filter((b) => b.x > AREA.left && b.x < AREA.right && b.y > AREA.top && b.y < AREA.bottom);
      return visible.length ? visible[Math.floor(rand() * visible.length)]! : null;
    };
    const typeToken = async (i: number, page: Page, label: string, isNew: (id: string) => boolean) => {
      const id = await editingId(page).catch(() => null);
      if (!id) return;
      const token = `w${i}x${tokenCounter++}`;
      await page.keyboard.type(` ${token}`);
      await page.keyboard.press('Escape');
      if (isNew(id)) created.add(id);
      // A busy note can reach STICKY_TEXT_MAX_CHARS, and a note can be deleted mid-typing:
      // only track text that actually landed on the sender's screen.
      const sent = (await getNotes(page)).find((n) => n.id === id);
      if (sent && containsToken(sent.text, token)) expectEverywhere(i, `${participants[i]!.name} ${label} ${token}`, id, token);
      else if (sent) expectEverywhere(i, `${participants[i]!.name} ${label} (text full)`, id, null);
      else unmeasured++;
    };

    const soakEnd = Date.now() + SOAK_MS;
    await Promise.all(
      participants.map(async (sender, i) => {
        const rand = seededRandom(seed + i);
        const page = sender.page;
        while (Date.now() < soakEnd) {
          const kind = pickKind(rand);
          const target = await randomNoteCentre(page, rand);
          if (kind === 'create' || !target) {
            const before = new Set((await getNotes(page)).map((n) => n.id));
            const at = { x: AREA.left + rand() * (AREA.right - AREA.left), y: AREA.top + rand() * (AREA.bottom - AREA.top) };
            // A synthetic double-click on the empty board: real presses could first select a note
            // someone is dragging, whose moving toolbar may then catch the second click ("Delete note").
            await page.getByTestId('board-viewport').dispatchEvent('dblclick', { clientX: at.x, clientY: at.y });
            await typeToken(i, page, 'create', (id) => !before.has(id));
          } else if (kind === 'type') {
            // Keyboard editing (focus the note, Enter), for the same reason as above.
            await page
              .locator(`[data-sticky-note][data-id="${target.id}"]`)
              .press('Enter', { timeout: 1000 })
              .catch(() => {});
            await typeToken(i, page, 'type', () => false);
          } else if (kind === 'move') {
            const dx = (rand() - 0.5) * 200;
            const dy = (rand() - 0.5) * 200;
            const to = {
              x: Math.min(AREA.right, Math.max(AREA.left, target.x + dx)),
              y: Math.min(AREA.bottom, Math.max(AREA.top, target.y + dy)),
            };
            await page.mouse.move(target.x, target.y);
            await page.mouse.down();
            await page.mouse.move(to.x, to.y, { steps: 5 });
            await page.mouse.up();
          } else if (kind === 'recolor') {
            await page.mouse.click(target.x, target.y);
            const label = COLOR_LABELS[Math.floor(rand() * COLOR_LABELS.length)]!;
            const swatch = page.getByRole('button', { name: label });
            // Keyboard activation targets the swatch itself: a pointer click could land on the
            // toolbar's "Delete note" button if someone else moves the note at that instant.
            if (await swatch.isVisible()) await swatch.press('Enter', { timeout: 1000 }).catch(() => {});
          } else {
            await page.mouse.click(target.x, target.y);
            const id = await page
              .locator('[data-sticky-note][data-selected="true"]')
              .first()
              .getAttribute('data-id', { timeout: 500 })
              .catch(() => null);
            if (id) {
              await page.keyboard.press('Delete');
              deleted.add(id);
            }
          }
          await clickEmpty(page);
        }
      }),
    );
    soaking = false;
    await Promise.all(pollers);

    // Every screen ends identical, and holds exactly the notes created and not deleted.
    await expect
      .poll(
        async () => {
          const states = await Promise.all(participants.map(async (p) => JSON.stringify(boardState(await getNotes(p.page)))));
          return states.every((s) => s === states[0]);
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [100] },
      )
      .toBe(true);
    const finalIds = (await getNotes(participants[0]!.page)).map((n) => n.id).sort();
    const expectedIds = [...created].filter((id) => !deleted.has(id)).sort();
    expect(finalIds, `seed ${seed}`).toEqual(expectedIds);
    console.log(`[TC-30] ${created.size} notes created, ${deleted.size} deleted, ${unmeasured} deliveries unmeasured (note deleted first)`);
    for (const p of participants) expect(p.problems).toEqual([]);
    const colours = new Set((await getNotes(participants[0]!.page)).map((n) => n.color));
    for (const c of colours) expect(Object.keys(STICKY_COLORS)).toContain(c as StickyColor);
  });
});
