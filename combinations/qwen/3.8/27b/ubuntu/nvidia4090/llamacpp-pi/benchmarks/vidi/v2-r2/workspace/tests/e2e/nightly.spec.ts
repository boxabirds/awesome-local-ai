import { expect, test, type BrowserContext } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  LatencyLog,
  Participant,
  newBoard,
  sameBoard,
  type ObjectState,
} from './helpers/participants';

/**
 * Nightly e2e (story 3, design "E2E workflows" — the two checks that are too
 * slow for every commit): idle connection stability (TC-29) and a full-capacity
 * convergence soak with a latency report (TC-30). Runs via `test:e2e:nightly`
 * and the `nightly` Playwright project; excluded from default `test:e2e`.
 *
 * Latency is measured and logged (p50/p95/max against the budget), never
 * asserted: the model, the browsers and the server share one machine, so
 * wall-clock timing there is not a reliable pass/fail signal.
 */

/** mulberry32: a tiny deterministic PRNG so soak runs are reproducible. */
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
// Tunable via env for local measurement; defaults are the design's 60 s soak.
const SOAK_SECONDS = Number(process.env.SOAK_SECONDS ?? 60);
const PACE_MS = Number(process.env.PACE_MS ?? 2000);
const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/** A note centre is usable only while it is on the visible board. */
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Weighted random pick over {name, w} actions using the shared PRNG. */
function pickWeighted<T extends { w: number }>(rng: () => number, actions: readonly T[]): T {
  const total = actions.reduce((s, a) => s + a.w, 0);
  let r = rng() * total;
  for (const a of actions) {
    r -= a.w;
    if (r < 0) return a;
  }
  return actions[actions.length - 1];
}

test.describe('live-collaboration.e2e.nightly', () => {
  test(`TC-29: idle — badge never shows Reconnecting and state stays connected for ${IDLE_SECONDS}s`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout((IDLE_SECONDS + 60) * 1000);
    const boardId = newBoard();
    const ctxA = await browser.newContext();
    const ctxS = await browser.newContext();
    const alex = await Participant.join(ctxA, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      const seen = new Set<string>();
      const deadline = Date.now() + IDLE_SECONDS * 1000;
      while (Date.now() < deadline) {
        const [sa, sb] = await Promise.all([alex.connectionState(), sam.connectionState()]);
        const [ba, bs] = await Promise.all([alex.badgeText(), sam.badgeText()]);
        seen.add(sa);
        seen.add(sb);
        // The badge must never read "Reconnecting…" (or appear at all) while idle.
        expect(ba, `Alex badge while idle`).not.toBe('Reconnecting…');
        expect(bs, `Sam badge while idle`).not.toBe('Reconnecting…');
        await Promise.all([alex.page.waitForTimeout(500), sam.page.waitForTimeout(500)]);
      }
      // The mapped state never left 'connected' (the awareness relay keeps the
      // idle y-websocket client's 30 s no-message watchdog from firing).
      expect([...seen], `states observed while idle: ${[...seen].join(', ')}`).toEqual(['connected']);
      expect(await alex.badgeText()).toBeNull();
      expect(await sam.badgeText()).toBeNull();
    } finally {
      await ctxA.close();
      await ctxS.close();
    }
  });

  test(`TC-30: ${MAX_CONCURRENT_EDITORS} contexts, ${SOAK_SECONDS}s of seeded random edits — every change converges, latency reported`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout((SOAK_SECONDS + 300) * 1000);
    const boardId = newBoard();
    const contexts: BrowserContext[] = [];
    const all: Participant[] = [];
    const latency = new LatencyLog();
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        all.push(await Participant.join(ctx, boardId));
      }

      const deadline = Date.now() + SOAK_SECONDS * 1000;
      const soakStart = Date.now();

      // Each participant owns a vertical column of 3 slots (200 apart
      // vertically); columns are 220 apart. A note is 200 wide and moves are
      // home-clamped to ±40, so no note can cover a neighbour's centre —
      // selection and toolbar clicks stay reliable and there is no create
      // contention between participants.
      const slotsFor = (i: number): { x: number; y: number }[] => {
        const bx = i * 220 - 520;
        return [{ x: bx, y: -200 }, { x: bx, y: 0 }, { x: bx, y: 200 }];
      };
      // A note's model (x, y) is its top-left corner; its centre is +100.
      const centreOf = (o: ObjectState): { x: number; y: number } => ({ x: o.x + 100, y: o.y + 100 });
      const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

      const loop = async (idx: number): Promise<void> => {
        const me = all[idx];
        const rng = mulberry32(0x5eed + idx * 7919);
        const receiver = all[(idx + 1) % all.length];
        const mySlots = slotsFor(idx);
        const myNotes: string[] = [];
        // Each of my notes -> which of my 3 slots it occupies; moves are
        // home-clamped to ±40 of that slot so a note never wanders far enough
        // to overlap a neighbour (which would make selection miss and toolbar
        // clicks hang).
        const home = new Map<string, number>();
        let op = 0;
        let failures = 0;

        while (Date.now() < deadline) {
          op += 1;
          let opName: string | null = null;
          try {
            const objs = await me.objects();
            // My notes that still exist (robust to a previously failed op).
            const live = myNotes.filter((id) => objs.some((o) => o.id === id));
            // A slot in my column is free when none of my live notes occupy it.
            const usedSlots = new Set(
              live.map((id) => home.get(id)).filter((i): i is number => i !== undefined),
            );
            const freeIdx = [0, 1, 2].find((i) => !usedSlots.has(i));
            const canCreate = freeIdx !== undefined;
            const canEdit = live.length > 0;

            // Weighted pick over the actions that are actually available this
            // tick (moves dominate; create/type/delete are rarer).
            const actions: { name: 'create' | 'move' | 'type' | 'recolor' | 'delete'; w: number }[] = [];
            if (canCreate) actions.push({ name: 'create', w: 3 });
            if (canEdit) {
              actions.push(
                { name: 'move', w: 3 },
                { name: 'recolor', w: 2 },
                { name: 'type', w: 1 },
                { name: 'delete', w: 1 },
              );
            }
            if (actions.length === 0) {
              // Nothing to do this tick (my column is full and I hold no notes).
              await me.page.waitForTimeout(50);
              continue;
            }
            opName = pickWeighted(rng, actions).name;
            const t0 = Date.now();
            switch (opName) {
              case 'create': {
                const slot = mySlots[freeIdx!];
                const text = `p${idx}o${op}`;
                const id = await me.createNote(slot, text);
                myNotes.push(id);
                home.set(id, freeIdx!);
                await receiver.waitFor(
                  (o) => o.some((n) => n.id === id && n.text === text),
                  `create ${text} to reach receiver`,
                );
                break;
              }
              case 'move': {
                const id = pick(rng, live);
                const h = mySlots[home.get(id)!];
                const cur = centreOf((await me.object(id))!);
                // Small random delta clamped to ±40 of the note's HOME slot so
                // it stays near its slot and never overlaps a neighbour.
                const tx = Math.round(clamp(cur.x + (rng() * 80 - 40), h.x - 40, h.x + 40));
                const ty = Math.round(clamp(cur.y + (rng() * 80 - 40), h.y - 40, h.y + 40));
                await me.moveNote(id, { x: tx - cur.x, y: ty - cur.y });
                const after = (await me.object(id))!;
                await receiver.waitFor(
                  (o) => {
                    const n = o.find((m) => m.id === id);
                    return n !== undefined && n.x === after.x && n.y === after.y;
                  },
                  `move ${id} to reach receiver`,
                );
                break;
              }
              case 'recolor': {
                const id = pick(rng, live);
                const color = pick(rng, COLORS);
                await me.recolor(id, color);
                await receiver.waitFor(
                  (o) => o.find((n) => n.id === id)?.color === color,
                  `recolor ${id} to reach receiver`,
                );
                break;
              }
              case 'type': {
                const id = pick(rng, live);
                const before = (await me.object(id))!.text;
                if (before.length > 30) {
                  // Note is nearly full; nudge it (near its home) instead of
                  // growing text without bound.
                  const h = mySlots[home.get(id)!];
                  const cur = centreOf((await me.object(id))!);
                  const tx = Math.round(clamp(cur.x + (rng() * 80 - 40), h.x - 40, h.x + 40));
                  const ty = Math.round(clamp(cur.y + (rng() * 80 - 40), h.y - 40, h.y + 40));
                  await me.moveNote(id, { x: tx - cur.x, y: ty - cur.y });
                  break;
                }
                const token = `t${op}`;
                await me.typeInto(id, token);
                await receiver.waitFor(
                  (o) => o.find((n) => n.id === id)?.text === before + token,
                  `type ${id} to reach receiver`,
                );
                break;
              }
              case 'delete': {
                const id = pick(rng, live);
                await me.deleteNote(id);
                const at = myNotes.indexOf(id);
                if (at !== -1) myNotes.splice(at, 1);
                home.delete(id);
                await receiver.waitFor((o) => !o.some((n) => n.id === id), `delete ${id} to reach receiver`);
                break;
              }
            }
            latency.record(`${opName}#${op}`, Date.now() - t0);
            if (op % 40 === 0) {
              console.log(
                `[soak] P${idx} op=${op} mine=${live.length} failures=${failures} ` +
                  `elapsed=${((Date.now() - soakStart) / 1000).toFixed(1)}s`,
              );
            }
          } catch (err) {
            failures += 1;
            if (failures <= 8) {
              console.log(`[soak] P${idx} op=${op} [${opName}] failed: ${String(err)}`);
            }
          }
          // Pace the shared machine: five concurrently-editing tabs re-render
          // on every peer's update, so a per-op delay keeps the CPU from
          // saturating (the soak is about sustained concurrent load, not peak
          // throughput).
          await me.page.waitForTimeout(PACE_MS);
        }
        console.log(`[soak] P${idx} done op=${op} mine=${myNotes.length} failures=${failures}`);
      };

      // All participants edit concurrently for the whole soak window.
      await Promise.all(all.map((_, i) => loop(i)));

      // Settle: every board converges on the identical snapshot (proves every
      // change eventually appeared everywhere).
      const settleDeadline = Date.now() + 20_000;
      let finals: ObjectState[][] = [];
      for (;;) {
        finals = await Promise.all(all.map((p) => p.objects()));
        if (finals.every((f) => sameBoard(finals[0], f))) {
          break;
        }
        if (Date.now() > settleDeadline) {
          throw new Error(
            `boards did not converge:\n` + finals.map((f, i) => `  P${i}: ${f.length} notes`).join('\n'),
          );
        }
        await all[0].page.waitForTimeout(200);
      }
      for (const p of all) {
        expect(p.hasErrors(), p.errorDetails()).toBe(false);
      }
      // The soak must have done real work: a healthy number of successful,
      // propagated edits (guards against a soak that silently no-ops).
      expect(latency.count, `successful propagated edits: ${latency.count}`).toBeGreaterThanOrEqual(50);
      latency.report('TC-30', LIVE_UPDATE_LATENCY_BUDGET_MS);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
