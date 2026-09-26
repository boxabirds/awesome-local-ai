import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHealth } from '../../../apps/api/src/routes/health.ts';
import { DEPLOYMENT_LOG_PATH } from '../../deploy/constants.ts';
import { createExec, createFs, createGit } from '../../deploy/deps.ts';
import type { DeployDeps } from '../../deploy/pipeline.ts';

const FAKE_WRANGLER = path.join(import.meta.dirname, '..', 'fake-wrangler.sh');
export const START_TIME = Date.parse('2026-09-25T12:34:56.000Z');

/** What the fake environment's /health reports. */
export type HealthMode =
  | 'follow-deploy' // the sha the fake wrangler last deployed (starts at an old sha)
  | 'never-updates' // always the old sha
  | 'head'; // already serving HEAD

export const OLD_SHA = 'f'.repeat(40);

export type RepoOptions = {
  migrations?: Record<string, string>;
  semverTag?: string | null;
  branch?: string;
  existingLogRows?: string[] | null; // null: no log file at all
};

export class ReleaseHarness {
  readonly root = mkdtempSync(path.join(tmpdir(), 'todoodle-release-'));
  readonly repo = path.join(this.root, 'repo');
  readonly state = path.join(this.root, 'wrangler-state');
  readonly bin = path.join(this.root, 'bin');
  readonly lines: string[] = [];
  readonly sleeps: number[] = [];
  private clock = START_TIME;
  private server?: Server;
  healthMode: HealthMode = 'follow-deploy';

  constructor(opts: RepoOptions = {}) {
    mkdirSync(this.repo);
    mkdirSync(this.state);
    mkdirSync(this.bin);
    copyFileSync(FAKE_WRANGLER, path.join(this.bin, 'wrangler'));
    chmodSync(path.join(this.bin, 'wrangler'), 0o755);
    writeFileSync(path.join(this.state, 'calls.log'), '');

    const git = (...args: string[]) => execFileSync('git', args, { cwd: this.repo, stdio: 'pipe' }).toString().trim();
    git('init', '--quiet', '--initial-branch', opts.branch ?? 'main');
    git('config', 'user.name', 'Test Operator');
    git('config', 'user.email', 'operator@todoodle.test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'tag.gpgsign', 'false');
    // The build step records itself in the same call log, so ordering can be asserted.
    writeFileSync(
      path.join(this.repo, 'package.json'),
      JSON.stringify({ name: 'todoodle', private: true, scripts: { build: 'echo build >> "$FAKE_WRANGLER_STATE/calls.log"' } }),
    );
    mkdirSync(path.join(this.repo, 'migrations'));
    writeFileSync(path.join(this.repo, 'migrations', '.gitkeep'), '');
    for (const [name, sql] of Object.entries(opts.migrations ?? {})) {
      writeFileSync(path.join(this.repo, 'migrations', name), sql);
    }
    if (opts.existingLogRows !== null) {
      mkdirSync(path.join(this.repo, 'docs', 'ops'), { recursive: true });
      const rows = opts.existingLogRows ?? [];
      writeFileSync(
        path.join(this.repo, DEPLOYMENT_LOG_PATH),
        ['deploy_id,operator,environment,git_sha,timestamp,status,version', ...rows].join('\n') + '\n',
      );
    }
    git('add', '-A');
    git('commit', '--quiet', '-m', 'initial');
    if (opts.semverTag !== null) git('tag', '-a', opts.semverTag ?? 'v1.2.0', '-m', 'release');
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.repo, stdio: 'pipe' }).toString().trim();
  }

  get headSha(): string {
    return this.git('rev-parse', 'HEAD');
  }

  /** Migrations the fake `wrangler d1 migrations list` reports as pending. */
  setPending(names: string[]) {
    writeFileSync(path.join(this.state, 'pending'), names.join('\n'));
  }

  setDeployFailures(n: number) {
    writeFileSync(path.join(this.state, 'deploy-fails'), String(n));
  }

  /** Every recorded invocation: `build` or `wrangler <args>`. */
  calls(): string[] {
    return readFileSync(path.join(this.state, 'calls.log'), 'utf8').split('\n').filter(Boolean);
  }

  logRows(): string[] | null {
    const file = path.join(this.repo, DEPLOYMENT_LOG_PATH);
    if (!existsSync(file)) return null;
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  }

  deployTags(): string[] {
    return this.git('tag', '--list', 'deploy/*').split('\n').filter(Boolean);
  }

  output(): string {
    return this.lines.join('\n');
  }

  /** A real HTTP server posing as the environment's /health, serving real buildHealth JSON. */
  async startHealthServer(environment: string): Promise<string> {
    this.server = createServer((req, res) => {
      if (req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      let sha = OLD_SHA;
      if (this.healthMode === 'head') sha = this.headSha;
      if (this.healthMode === 'follow-deploy') {
        const deployed = path.join(this.state, 'deployed-sha');
        if (existsSync(deployed)) sha = readFileSync(deployed, 'utf8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildHealth({ ENVIRONMENT: environment, GIT_SHA: sha, APP_VERSION: 'v1.1.0' })));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Real exec/git/fs/fetch; fake wrangler first on PATH; instant sleep on a virtual clock. */
  deps(baseUrl: string, overrides: Partial<DeployDeps> = {}): DeployDeps {
    const exec = createExec(this.repo, {
      ...process.env,
      PATH: [this.bin, process.env.PATH].join(path.delimiter),
      FAKE_WRANGLER_STATE: this.state,
    });
    return {
      exec,
      fetch: (input, init) => fetch(input, init),
      fs: createFs(this.repo),
      git: createGit(exec),
      sleep: async (ms) => {
        this.sleeps.push(ms);
        this.clock += ms;
      },
      now: () => this.clock,
      log: (line) => this.lines.push(line),
      isTTY: true,
      confirm: async () => true,
      baseUrl,
      ...overrides,
    };
  }

  async dispose() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    rmSync(this.root, { recursive: true, force: true });
  }
}
