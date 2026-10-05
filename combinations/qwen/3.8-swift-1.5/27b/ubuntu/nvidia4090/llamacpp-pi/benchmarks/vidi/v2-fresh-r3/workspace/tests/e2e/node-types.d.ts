/** Minimal Node type declarations for the e2e helpers (no @types/node in this project). */
declare module 'node:fs' {
  export function readFileSync(path: string): Buffer;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
