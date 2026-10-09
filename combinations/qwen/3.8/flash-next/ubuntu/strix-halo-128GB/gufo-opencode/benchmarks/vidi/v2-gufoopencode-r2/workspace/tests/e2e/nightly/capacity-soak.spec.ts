// Nightly TC-30 (task 9): continuous seeded random edits at full capacity
// (MAX_CONCURRENT_EDITORS contexts) for SOAK_MS; every change must converge
// to every other context. Per-change sender-to-receiver latency is measured
// and reported against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted (design
// task 9: one shared machine makes wall-clock timing unreliable).

import { test, expect } from '@playwright/test';
import { getNotes, setCamera } from '../helpers/board';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  type StickyColor,
} from '../../../src/shared/config';
import {
  closeParticipants,
  connectionState,
  dragFromTo,
  noteCenter,
  openParticipants,
  signature,
  type Participant,
} from '../helpers/participants';

const SEED = 20261009;
const SOAK_MS = Number(process.env.E2E_SOAK_MS ?? 60_000);
const ARRIVAL_TIMEOUT_MS = 30_000;

type ActionKind = 'create' | 'move' | 'type' | 'recolour' | 'delete';

// Deterministic PRNG so a failing soak can be replayed from its seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

test('TC-30: capacity soak - 5 contexts, continuous seeded edits, all changes converge', async ({
  browser,
}) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const parties = await openParticipants(browser, names);
  const consoleErrors: string[] = [];
  for (const p of parties) {
    p.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${p.name}: ${msg.text()}`);
    });
    p.page.on('pageerror', (err) => consoleErrors.push(`${p.name}: ${String(err)}`));
    await setCamera(p.page, { x: 0, y: 0, zoom: 0.5 });
  }
  try {
    const rng = mulberry32(SEED);
    const colourKeys = Object.keys(STICKY_COLORS) as StickyColor[];
    const latencies: { kind: ActionKind; receiver: string; ms: number }[] = [];
    const start = Date.now();
    let round = 0;

    while (Date.now() - start < SOAK_MS) {
      const actor = parties[round % parties.length];
      round += 1;
      const kind = await performAction(actor, rng, colourKeys);
      if (kind === null) continue; // element vanished under a conflict; try next round
      if (round % 20 === 0) console.log(`[soak] round ${round} at +${Math.round((Date.now() - start) / 1000)}s`);
      const target = signature(await getNotes(actor.page));
      const t0 = Date.now();
      for (const p of parties) {
        if (p === actor) continue;
        await expect
          .poll(() => getNotes(p.page).then(signature), {
            timeout: ARRIVAL_TIMEOUT_MS,
            message: `${p.name} to converge after ${actor.name}'s ${kind}`,
          })
          .toBe(target);
        latencies.push({ kind, receiver: p.name, ms: Date.now() - t0 });
      }
    }

    // All final board snapshots identical.
    const sigs = await Promise.all(parties.map((p) => getNotes(p.page).then(signature)));
    expect(new Set(sigs).size, 'final snapshots identical').toBe(1);
    const noteCount = (await getNotes(parties[0].page)).length;
    printLatencyReport(latencies, noteCount);
    expect(latencies.length).toBeGreaterThan(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    // Teardown side effect: closing one context must not make any other
    // context reconnect (provider destroy on unload takes its socket only).
    for (const [i, p] of parties.entries()) {
      await p.context.close();
      for (const other of parties.slice(i + 1)) {
        expect(
          await connectionState(other.page),
          `${other.name} stays connected after ${p.name} closed`,
        ).toBe('connected');
      }
    }
  }
});

async function performAction(
  actor: Participant,
  rng: () => number,
  colourKeys: StickyColor[],
): Promise<ActionKind | null> {
  try {
    return await runAction(actor, rng, colourKeys);
  } catch {
    return null;
  }
}

async function runAction(
  actor: Participant,
  rng: () => number,
  colourKeys: StickyColor[],
): Promise<ActionKind> {
  const notes = await getNotes(actor.page);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  let kind: ActionKind;
  if (notes.length === 0) kind = 'create';
  else {
    const r = rng();
    kind = r < 0.35 ? 'create' : r < 0.65 ? 'move' : r < 0.8 ? 'type' : r < 0.92 ? 'recolour' : 'delete';
  }

  if (kind === 'create') {
    // 10x6 grid of 110px cells at zoom 0.5 (notes render ~100px).
    const gx = Math.floor(rng() * 10);
    const gy = Math.floor(rng() * 6);
    await actor.page.mouse.dblclick(90 + gx * 110, 80 + gy * 110);
    if (rng() < 0.5) {
      await actor.page.keyboard.type(LETTERS[Math.floor(rng() * LETTERS.length)]);
    }
    await actor.page.keyboard.press('Escape');
    return kind;
  }

  const note = pick(notes);
  const center = await noteCenter(actor.page, note.id);
  if (kind === 'move') {
    const dx = Math.round((rng() - 0.5) * 160);
    const dy = Math.round((rng() - 0.5) * 120);
    await dragFromTo(actor.page, [center.x, center.y], [center.x + dx, center.y + dy]);
  } else if (kind === 'type') {
    await actor.page.mouse.dblclick(center.x, center.y);
    await actor.page.keyboard.type(LETTERS[Math.floor(rng() * LETTERS.length)]);
    await actor.page.keyboard.press('Escape');
  } else if (kind === 'recolour') {
    await actor.page.mouse.click(center.x, center.y);
    const key = colourKeys[Math.floor(rng() * colourKeys.length)];
    await actor.page.getByTestId(`swatch-${key}`).click();
  } else {
    await actor.page.mouse.click(center.x, center.y);
    await actor.page.getByLabel('Delete note').click();
  }
  return kind;
}

function printLatencyReport(
  latencies: { kind: string; receiver: string; ms: number }[],
  noteCount: number,
): void {
  const sorted = latencies.map((l) => l.ms).sort((a, b) => a - b);
  const pct = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(
    [
      `[soak] ${latencies.length} change deliveries over the ${SOAK_MS / 1000}s soak; final note count ${noteCount}`,
      `[soak] latency p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${sorted[sorted.length - 1]}ms`,
      `[soak] budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms (reported, not asserted)`,
    ].join('\n'),
  );
}
