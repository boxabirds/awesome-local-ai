/** Filesystem operations the release tooling needs, relative to the repository root. */
export interface FsLike {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
}

/** Git operations the release tooling needs, run in the repository root. */
export interface GitLike {
  isClean(): Promise<boolean>;
  currentBranch(): Promise<string>;
  headSha(): Promise<string>;
  tagsAtHead(): Promise<string[]>;
  userName(): Promise<string>;
  createTag(name: string, message: string): Promise<void>;
  /** Pushes a single tag to the default remote; resolves false when there is no remote. */
  pushTag(name: string): Promise<boolean>;
}

/** The part of `fetch` the tooling uses (the global fetch satisfies it). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
