import { spawn } from 'node:child_process';
import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEPLOYMENT_LOG_PATH } from './constants';
import type { DeployDeps } from './pipeline';
import type { ExecResult, FsLike, GitLike } from './types';

/**
 * Runs a command in `cwd`, capturing output (and echoing it when asked). Uses node:child_process,
 * which bun implements, so the same deps run under `bun scripts/deploy.ts` and in vitest's node pool.
 */
export function createExec(opts: { cwd: string; env?: NodeJS.ProcessEnv; echo?: boolean }) {
  const env = { ...process.env, ...opts.env };
  // Project binaries (wrangler) resolve from the repo, after anything already first on PATH.
  // (If PATH isn't visible to this process, leave it alone and let spawn use the inherited one.)
  if (env.PATH) env.PATH = [env.PATH, join(opts.cwd, 'node_modules', '.bin')].join(delimiter);
  return (cmd: string, args: string[]): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk;
        if (opts.echo) process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk;
        if (opts.echo) process.stderr.write(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

export function createFs(root: string): FsLike {
  const at = (path: string) => join(root, path);
  return {
    exists: (path) =>
      access(at(path)).then(
        () => true,
        () => false,
      ),
    readFile: (path) => readFile(at(path), 'utf8'),
    appendFile: (path, data) => appendFile(at(path), data, 'utf8'),
    mkdir: async (path) => {
      await mkdir(at(path), { recursive: true });
    },
  };
}

export function createGit(
  exec: (cmd: string, args: string[]) => Promise<ExecResult>,
  opts: { logPath?: string } = {},
): GitLike {
  const git = async (...args: string[]) => {
    const r = await exec('git', args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  return {
    // The deployment log is appended by every release, so it never counts as "dirty".
    isClean: async () =>
      (await git('status', '--porcelain', '--', '.', `:(exclude)${opts.logPath ?? DEPLOYMENT_LOG_PATH}`)) === '',
    currentBranch: () => git('rev-parse', '--abbrev-ref', 'HEAD'),
    headSha: () => git('rev-parse', 'HEAD'),
    tagsAtHead: async () => (await git('tag', '--points-at', 'HEAD')).split('\n').filter(Boolean),
    userName: () => git('config', 'user.name'),
    createTag: async (name, message) => {
      await git('tag', '-a', name, '-m', message);
    },
    pushTag: async (name) => {
      await git('push', 'origin', `refs/tags/${name}`);
    },
  };
}

async function confirmOnTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/** Real side effects, rooted at the repository `cwd`. */
export function createDeps(opts: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  echo?: boolean;
  log?: (line: string) => void;
  config?: DeployDeps['config'];
}): DeployDeps {
  const exec = createExec(opts);
  return {
    exec,
    fetch: globalThis.fetch,
    fs: createFs(opts.cwd),
    git: createGit(exec, { logPath: opts.config?.logPath }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: opts.log ?? ((line) => console.log(line)),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    confirm: confirmOnTerminal,
    config: opts.config,
  };
}
