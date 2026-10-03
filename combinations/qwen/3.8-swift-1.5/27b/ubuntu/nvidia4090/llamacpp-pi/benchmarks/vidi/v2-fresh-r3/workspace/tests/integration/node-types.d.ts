declare module 'child_process' {
  export function execSync(cmd: string, opts?: { stdio?: string; cwd?: string }): Buffer;
  export function spawn(cmd: string, args: string[], opts?: { stdio?: string; env?: Record<string, string | undefined>; cwd?: string }): {
    kill: (signal?: string) => boolean;
  };
  export type ChildProcess = { kill: (signal?: string) => boolean };
}
declare module 'timers/promises' {
  export function setTimeout(ms: number): Promise<void>;
}
