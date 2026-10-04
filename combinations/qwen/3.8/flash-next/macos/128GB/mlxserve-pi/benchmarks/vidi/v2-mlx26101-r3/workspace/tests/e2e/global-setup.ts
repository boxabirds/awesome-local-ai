import { execFileSync } from 'node:child_process';

/**
 * The bundle the browsers are pointed at is built here, once, before any test runs - rather
 * than as the first half of the dev server's command - because a dev server left over from an
 * earlier run is reused, and a reused server would otherwise serve whichever bundle happened
 * to be on disk. A suite that silently runs against a build it did not make is not testing
 * anything.
 *
 * `wrangler dev` reads its assets off disk as it serves them, so building before the run is
 * enough for a reused server to be serving the code under test.
 */
export default function buildTheTestBundle(): void {
  execFileSync('npm', ['run', 'build:test'], {
    stdio: 'inherit',
    cwd: new URL('../../', import.meta.url).pathname,
  });
}
