import { spawn } from 'node:child_process';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DEPLOYMENT_LOG_PATH } from './constants.ts';
import type { DeployDeps, ExecResult } from './pipeline.ts';
import type { FsLike, GitLike } from './types.ts';

/** Runs a command in `cwd`, preferring the repository's own tools (node_modules/.bin first on PATH). */
export function createExec(cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const binDir = path.join(cwd, 'node_modules', '.bin');
  const childEnv = { ...env, PATH: [binDir, env.PATH].filter(Boolean).join(path.delimiter) };
  return (cmd: string, args: string[]): Promise<ExecResult> =>
    new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (err) => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

export function createFs(root: string): FsLike {
  const abs = (p: string) => path.resolve(root, p);
  return {
    async exists(p) {
      try {
        await access(abs(p));
        return true;
      } catch {
        return false;
      }
    },
    readFile: (p) => readFile(abs(p), 'utf8'),
    async writeFile(p, data) {
      await mkdir(path.dirname(abs(p)), { recursive: true });
      await writeFile(abs(p), data);
    },
    async appendFile(p, data) {
      await mkdir(path.dirname(abs(p)), { recursive: true });
      await appendFile(abs(p), data);
    },
  };
}

export function createGit(exec: DeployDeps['exec']): GitLike {
  const git = async (...args: string[]) => {
    const r = await exec('git', args);
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  return {
    // The deployment log itself is expected to change between releases; it does not make the tree dirty.
    isClean: async () => (await git('status', '--porcelain', '--', '.', `:(exclude)${DEPLOYMENT_LOG_PATH}`)) === '',
    currentBranch: () => git('rev-parse', '--abbrev-ref', 'HEAD'),
    headSha: () => git('rev-parse', 'HEAD'),
    tagsAtHead: async () => (await git('tag', '--points-at', 'HEAD')).split('\n').filter(Boolean),
    userName: async () => {
      const r = await exec('git', ['config', 'user.name']);
      return r.code === 0 ? r.stdout.trim() : '';
    },
    createTag: async (name, message) => {
      await git('tag', '-a', name, '-m', message);
    },
    pushTag: async (name) => {
      const remote = (await git('remote')).split('\n').filter(Boolean)[0];
      if (!remote) return false;
      await git('push', remote, `refs/tags/${name}`);
      return true;
    },
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Real side effects: processes, git, filesystem and network, all rooted at the repository. */
export function createRealDeps(root: string): DeployDeps {
  const exec = createExec(root);
  return {
    exec,
    fetch: (input, init) => fetch(input, init),
    fs: createFs(root),
    git: createGit(exec),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.log(line),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    confirm,
  };
}
