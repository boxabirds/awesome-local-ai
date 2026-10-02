import { readFileSync } from 'node:fs';

/** Written by playwright.config.ts, which probes each browser once. */
export const AVAILABILITY_FILE = 'test-results/browser-availability.json';

export type Availability = Record<string, boolean>;

/**
 * Whether the browser of the current project can start in this environment.
 * A browser that cannot launch is reported as skipped, never as a failure and
 * never silently left out of the run.
 */
export function browserAvailable(name: string): boolean {
  try {
    const recorded = JSON.parse(readFileSync(AVAILABILITY_FILE, 'utf8')) as Availability;
    return recorded[name] ?? true;
  } catch {
    return true;
  }
}
