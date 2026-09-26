// Release command: `bun scripts/deploy.ts staging|production` (root scripts deploy:staging / deploy:production).
// Exit 0 when released or already deployed, 1 otherwise.
import path from 'node:path';
import { DEPLOY_ENVIRONMENTS, type DeployEnvironment } from './deploy/constants.ts';
import { createRealDeps } from './deploy/deps.ts';
import { runRelease } from './deploy/pipeline.ts';

const target = process.argv[2];
if (!DEPLOY_ENVIRONMENTS.includes(target as DeployEnvironment)) {
  console.error(`Usage: bun scripts/deploy.ts <${DEPLOY_ENVIRONMENTS.join('|')}>`);
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const outcome = await runRelease(target as DeployEnvironment, createRealDeps(root));
process.exit(outcome === 'success' || outcome === 'skipped' ? 0 : 1);
