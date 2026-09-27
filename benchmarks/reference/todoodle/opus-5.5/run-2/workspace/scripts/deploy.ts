#!/usr/bin/env bun
// Release command: `bun scripts/deploy.ts staging|production` (bun run deploy:staging / deploy:production).
// Exit 0 when released or already live; 1 otherwise.
import { fileURLToPath } from 'node:url';
import type { DeployEnv } from './deploy/constants';
import { createDeps } from './deploy/deps';
import { runRelease } from './deploy/pipeline';

const ENVIRONMENTS: readonly DeployEnv[] = ['staging', 'production'];

async function main(argv: string[]): Promise<number> {
  const target = argv[0];
  if (!ENVIRONMENTS.includes(target as DeployEnv)) {
    console.error('Usage: bun scripts/deploy.ts staging|production');
    return 1;
  }
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const outcome = await runRelease(target as DeployEnv, createDeps({ cwd: repoRoot, echo: true }));
  return outcome === 'success' || outcome === 'skipped' ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
