import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHealth } from '@todoodle/shared/health';
import { DEPLOYMENT_LOG_HEADER, DEPLOYMENT_LOG_PATH } from '../deploy/constants';
import { createDeps } from '../deploy/deps';
import type { DeployDeps } from '../deploy/pipeline';

const FAKE_WRANGLER = fileURLToPath(new URL('./fake-wrangler.sh', import.meta.url));

export const OPERATOR = 'Test Operator';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export type RepoOptions = {
  branch?: string;
  semverTag?: string | null;
  migrations?: Record<string, string>;
};

/**
 * A real release sandbox: a git repo (with a bare `origin`), migrations, deployment log,
 * a fake `wrangler` first on PATH and a real HTTP server posing as the environment's /health.
 */
export async function createReleaseSandbox(opts: RepoOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'todoodle-release-'));
  const repo = join(root, 'repo');
  const remote = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const wranglerLog = join(root, 'wrangler-calls.log');
  const liveShaFile = join(root, 'live-sha');
  for (const dir of [repo, bin, state]) mkdirSync(dir, { recursive: true });
  writeFileSync(wranglerLog, '');
  writeFileSync(liveShaFile, 'dev');
  chmodSync(FAKE_WRANGLER, 0o755);
  symlinkSync(FAKE_WRANGLER, join(bin, 'wrangler'));

  execFileSync('git', ['init', '--bare', '-q', remote]);
  git(repo, 'init', '-q', '-b', opts.branch ?? 'main');
  git(repo, 'config', 'user.name', OPERATOR);
  git(repo, 'config', 'user.email', 'operator@todoodle.test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'tag.gpgsign', 'false');
  git(repo, 'remote', 'add', 'origin', remote);
  writeFileSync(
    join(repo, 'package.json'),
    `${JSON.stringify({ name: 'todoodle', private: true, scripts: { build: 'echo build >> "$FAKE_WRANGLER_LOG"' } }, null, 2)}\n`,
  );
  mkdirSync(join(repo, 'migrations'));
  writeFileSync(join(repo, 'migrations', '.gitkeep'), '');
  for (const [name, sql] of Object.entries(opts.migrations ?? {})) {
    writeFileSync(join(repo, 'migrations', name), sql);
  }
  mkdirSync(join(repo, 'docs', 'ops'), { recursive: true });
  writeFileSync(join(repo, DEPLOYMENT_LOG_PATH), `${DEPLOYMENT_LOG_HEADER}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'release candidate');
  if (opts.semverTag !== null) git(repo, 'tag', '-a', opts.semverTag ?? 'v1.2.0', '-m', 'release');
  git(repo, 'push', '-q', 'origin', 'HEAD');
  const headSha = git(repo, 'rev-parse', 'HEAD');

  // The environment under release: serves buildHealth with whatever sha is "live".
  const health: Server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const sha = readFileSync(liveShaFile, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildHealth({ ENVIRONMENT: 'staging', GIT_SHA: sha })));
  });
  await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(health.address() as AddressInfo).port}`;

  const output: string[] = [];

  return {
    repo,
    headSha,
    output,
    setLiveSha: (sha: string) => writeFileSync(liveShaFile, sha),
    liveSha: () => readFileSync(liveShaFile, 'utf8'),
    makeDirty: () => writeFileSync(join(repo, 'stray-change.txt'), 'uncommitted\n'),
    /** Every wrangler invocation (and the build marker) in order. */
    calls: () => readFileSync(wranglerLog, 'utf8').split('\n').filter(Boolean),
    logRows: () => readFileSync(join(repo, DEPLOYMENT_LOG_PATH), 'utf8').split('\n').filter(Boolean).slice(1),
    deployTags: () => git(repo, 'tag', '--list', 'deploy/*').split('\n').filter(Boolean),
    tagsAtHead: () => git(repo, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean),
    remoteTags: () => git(remote, 'tag', '--list').split('\n').filter(Boolean),
    deps(env: Record<string, string> = {}, overrides: Partial<DeployDeps> = {}): DeployDeps {
      const deps = createDeps({
        cwd: repo,
        echo: false,
        log: (line) => output.push(line),
        env: {
          PATH: [bin, process.env.PATH].join(delimiter),
          FAKE_WRANGLER_LOG: wranglerLog,
          FAKE_WRANGLER_STATE: state,
          FAKE_WRANGLER_LIVE_SHA_FILE: liveShaFile,
          ...env,
        },
        config: { baseUrl, retryBaseDelayMs: 5, verifyTimeoutMs: 400, verifyIntervalMs: 20 },
      });
      return { ...deps, isTTY: true, confirm: async () => true, ...overrides };
    },
    async cleanup() {
      await new Promise<void>((resolve) => health.close(() => resolve()));
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    },
  };
}

export type ReleaseSandbox = Awaited<ReturnType<typeof createReleaseSandbox>>;
