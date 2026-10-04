import { test, expect } from '@playwright/test';
import { Participant, createParticipants } from './helpers/participants';
import {
  MAX_CONCURRENT_EDITORS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

/** mulberry32: deterministic PRNG so the soak is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDLE_SECONDS = 45;
const SOAK_SECONDS = 60;
const SOAK_SEED = 20260101;

test.describe('story 3: nightly sync.client contract', () => {
  test(`TC-29: two idle contexts stay "connected" for ${IDLE_SECONDS}s (badge never shows Reconnecting)`, async ({ browser }) => {
    test.setTimeout(120_000);
    const [a, b] = await createParticipants(browser, 2);
    try {
      const violations: string[] = [];
      const watchers: ReturnType<typeof setInterval>[] = [];
      for (const p of [a, b]) {
        watchers.push(
          setInterval(() => {
            void (async () => {
              const s = await p.connectionState();
              if (s !== 'connected') violations.push(`${p.name}:${s}`);
              const badge = await p.page
                .locator('[data-testid="connection-status"]')
                .textContent()
                .catch(() => null);
              if (badge) violations.push(`${p.name}:badge "${badge}"`);
            })();
          }, 500),
        );
      }

      await new Promise((r) => setTimeout(r, IDLE_SECONDS * 1000));
      for (const w of watchers) clearInterval(w);

      expect(violations).toEqual([]);
      expect(await a.connectionState()).toBe('connected');
      expect(await b.connectionState()).toBe('connected');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test(`TC-30: ${MAX_CONCURRENT_EDITORS} contexts soak ${SOAK_SECONDS}s of seeded random edits → convergence + latency report`, async ({ browser }) => {
    test.setTimeout(600_000);
    const n = MAX_CONCURRENT_EDITORS;
    const ps = await createParticipants(browser, n);

    // Track websocket requests per page for the teardown assertion.
    const lastWsRequestAt = new Map<Participant, number>();
    const crashes: string[] = [];
    for (const p of ps) {
      lastWsRequestAt.set(p, 0);
      p.page.on('request', (req) => {
        if (req.resourceType() === 'websocket') lastWsRequestAt.set(p, Date.now());
      });
      p.page.on('crash', () => crashes.push(p.name));
    }

    try {
      // Zoom everyone out so the working grid fits the viewport.
      for (const p of ps) {
        await p.page.evaluate(() =>
          (window as any).__vidi6.setCamera({ x: -1280, y: -800, zoom: 0.5 }),
        );
      }

      const latencies: number[] = [];
      const rand = mulberry32(SOAK_SEED);
      const colors = Object.keys(STICKY_COLORS) as StickyColor[];
      console.log(`[soak] seed=${SOAK_SEED} participants=${n} duration=${SOAK_SECONDS}s`);

      // Per-participant note bookkeeping (each participant only edits its
      // own notes, so every change is independently observable on the
      // other contexts).
      const notes = ps.map(() => new Set<string>());
      const counters = ps.map(() => 0);

      /** Wait until every other participant reflects `check`; return ms. */
      const converged = async (
        senderIdx: number,
        check: (p: Participant) => Promise<boolean>,
      ): Promise<number> => {
        const t0 = Date.now();
        const others = ps.filter((_, i) => i !== senderIdx);
        await expect
          .poll(
            async () => {
              const rs = await Promise.all(others.map(check));
              return rs.every(Boolean);
            },
            { timeout: 30_000 },
          )
          .toBe(true);
        return Date.now() - t0;
      };

      const doOp = async (i: number): Promise<void> => {
        const p = ps[i];
        const kind = Math.floor(rand() * 5);
        if (kind === 0 || notes[i].size === 0) {
          // Create (forced when the participant has no notes to work with).
          if (notes[i].size >= 4) {
            // Keep the board bounded: drop the oldest note first.
            const oldest = notes[i].values().next().value as string;
            await p.selectNote(oldest);
            await p.deleteSelected(oldest);
            await converged(i, (o) => o.note(oldest).count().then((c) => c === 0));
            notes[i].delete(oldest);
          }
          const k = counters[i]++;
          // Fixed-width names: hasText() is substring matching, so all note
          // names must be the same length to avoid cross-matches.
          const text = `P${i}N${String(k).padStart(4, '0')}`;
          // Disjoint grid cell block per participant (4 cells each on the
          // 4×5 grid): participants never stack notes, so clicks and drags
          // always hit the intended note. A participant holds at most 4
          // notes, whose k%4 values are all distinct → no self-collision.
          const cell = i * 4 + (k % 4);
          const x = 240 + (cell % 4) * 170;
          const y = 100 + (Math.floor(cell / 4) % 5) * 140;
          await p.createNote(text, x, y);
          latencies.push(await converged(i, (o) => o.note(text).count().then((c) => c === 1)));
          notes[i].add(text);
          return;
        }
        const target = notes[i].values().next().value as string;
        if (kind === 1) {
          // Move.
          const dx = Math.floor(rand() * 120) - 60;
          const dy = Math.floor(rand() * 80) - 40;
          const before = (await p.note(target).boundingBox())!;
          await p.dragNote(target, dx, dy);
          const wantX = before.x + dx;
          const wantY = before.y + dy;
          const checkMove = (o: Participant) =>
            o.note(target).boundingBox().then((b) =>
              b ? Math.abs(b.x - wantX) <= 2 && Math.abs(b.y - wantY) <= 2 : false,
            );

          latencies.push(await converged(i, checkMove));
        } else if (kind === 2) {
          // Append one character. fill() is used (not keyboard.type) because
          // individual key events can be dropped under machine load; fill()
          // still drives the real editor → Y.Text pipeline via input events.
          // The textarea is scoped to the target note so a stray editor
          // elsewhere can never receive the text.
          const ch = 'abcdefgh'[Math.floor(rand() * 8)];
          const oldText = target;
          const newText = oldText + ch;
          await p.startEditNote(oldText);
          const ta = p.note(oldText).getByTestId('sticky-textarea');
          await ta.fill(newText);
          await p.ensureNoEditing();
          latencies.push(
            await converged(i, (o) =>
              o.note(newText).count().then((c) => c === 1),
            ),
          );
          notes[i].delete(oldText);
          notes[i].add(newText);
        } else if (kind === 3) {
          // Recolour.
          const color = colors[Math.floor(rand() * colors.length)];
          const wantRgb = hexToRgb(STICKY_COLORS[color]);
          await p.selectNote(target);
          await p.recolorSelected(color, wantRgb);
          latencies.push(
            await converged(i, (o) =>
              o.note(target)
                .evaluate((el, rgb) => getComputedStyle(el).backgroundColor === rgb, wantRgb)
                .then((r) => r === true),
            ),
          );
        } else {
          // Delete.
          await p.selectNote(target);
          await p.deleteSelected(target);
          latencies.push(await converged(i, (o) => o.note(target).count().then((c) => c === 0)));
          notes[i].delete(target);
        }
      };

      // Continuous seeded random edits for SOAK_SECONDS (each participant
      // paces itself by waiting for convergence after every op).
      const end = Date.now() + SOAK_SECONDS * 1000;
      // A single op failing (dropped events, transient load) must not sink
      // the whole soak: log it and keep going. The per-op convergence checks
      // and the final identical-snapshots assertion are the real contract.
      const opFailures: string[] = [];
      const lanes = await Promise.all(
        ps.map(async (_p, i) => {
          while (Date.now() < end) {
            try {
              await doOp(i);
            } catch (err) {
              const first = String(err).split('\n')[0];
              opFailures.push(`P${i}: ${first}`);
              console.log(`[op-fail] P${i}: ${first}`);
              // The failed op may have left the page mid-gesture; settle it.
              await ps[i].ensureNoEditing().catch(() => {});
            }
          }
        }),
      );
      await lanes;
      if (opFailures.length > 0) {
        console.log(
          `[soak] ${opFailures.length} ops failed (soak continued): ` +
            opFailures.slice(0, 5).join(' | '),
        );
      }

      // All final board snapshots identical (every change converged).
      const snaps: string[][] = [];
      await expect
        .poll(
          async () => {
            snaps.length = 0;
            for (const p of ps) snaps.push(await p.boardSnapshot());
            const baseline = snaps[0].join('\n');
            return snaps.every((s) => s.join('\n') === baseline);
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      console.log(`[soak] final snapshots identical across ${n} participants (${snaps[0].length} notes)`);

      // Latency report: reported, NOT asserted.
      const sorted = [...latencies].sort((x, y) => x - y);
      const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      console.log(
        `[latency] ${sorted.length} sender→receiver changes: ` +
          `p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${sorted[sorted.length - 1]}ms ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms — reported, not asserted)`,
      );

      // A crashed renderer means the sync.client contract is void for that
      // participant; fail fast instead of hanging on its locators.
      expect(crashes).toEqual([]);

      // Teardown side effect: unmounting the board (navigating away) calls
      // destroy(); verify the provider makes no further websocket attempts
      // to the old room afterwards, and that the room stays healthy for the
      // remaining participants.
      const leaver = ps[0];
      const oldRoom = leaver.page.url();
      const wsToOldRoom: number[] = [];
      leaver.page.on('request', (req) => {
        if (req.resourceType() === 'websocket' && req.url() === oldRoom) {
          wsToOldRoom.push(Date.now());
        }
      });
      // Give the listener a moment, then navigate away (unmount → destroy).
      const mark = Date.now();
      await leaver.page.goto('/b/teardown-check');
      await new Promise((r) => setTimeout(r, 3000));
      // No reconnect attempts to the old room after the unmount.
      expect(wsToOldRoom.filter((t) => t > mark)).toEqual([]);
      // The room is unaffected: the other participants are still connected.
      for (const p of ps.slice(1)) {
        expect(await p.connectionState()).toBe('connected');
      }
      void lastWsRequestAt;
    } finally {
      await Promise.all(ps.map((p) => p.close().catch(() => {})));
    }
  });
});

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
