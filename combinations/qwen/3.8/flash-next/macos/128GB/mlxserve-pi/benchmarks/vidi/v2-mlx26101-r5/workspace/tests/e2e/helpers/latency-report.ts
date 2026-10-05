/**
 * Printed once, at the end of the run, from the process that runs the tests themselves —
 * which is the only place a report written by several browser workers can be gathered and
 * actually seen by whoever ran the suite.
 *
 * Every test writes what it measured into `test-results/latency/`; this reads all of it
 * back and prints the percentiles against the budget. The numbers are reported and not
 * asserted: the model, the browsers and the server share one machine, and a wall-clock
 * measurement taken there is not a pass/fail signal.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { LATENCY_DIR, percentiles } from './participants';

export default async function globalTeardown(): Promise<void> {
  const samples: number[] = [];
  const perFile: string[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(LATENCY_DIR)).filter((name) => name.endsWith('.log')).sort();
  } catch {
    console.info('latency report: nothing was measured');
    return;
  }

  for (const name of files) {
    const text = await readFile(join(LATENCY_DIR, name), 'utf8');
    const numbers = text
      .split('\n')
      .map((line) => Number.parseInt(line, 10))
      .filter((value) => Number.isFinite(value));
    samples.push(...numbers);
    if (numbers.length > 0) {
      const { p50, p95, max } = percentiles(numbers);
      perFile.push(`  ${name}: ${numbers.length} change(s), p50=${p50}ms p95=${p95}ms max=${max}ms`);
    }
  }

  const { p50, p95, max } = percentiles(samples);
  const budget = LIVE_UPDATE_LATENCY_BUDGET_MS;
  const verdict = max <= budget ? 'inside the budget' : 'OVER the budget (reported, not asserted)';
  console.info('');
  console.info('--- live update latency -------------------------------------------');
  console.info(`changes measured      : ${samples.length}`);
  console.info(`budget per change     : ${budget}ms`);
  console.info(`p50 / p95 / max       : ${p50}ms / ${p95}ms / ${max}ms  (${verdict})`);
  for (const line of perFile) console.info(line);
  console.info('---------------------------------------------------------------------');
}
