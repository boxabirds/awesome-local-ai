export type ExecResult = { code: number; stdout: string; stderr: string };

/** The only filesystem operations the release tooling needs. Paths are relative to the repo root. */
export type FsLike = {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  appendFile(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
};

/** The only git operations the release tooling needs. */
export type GitLike = {
  isClean(): Promise<boolean>;
  currentBranch(): Promise<string>;
  headSha(): Promise<string>;
  tagsAtHead(): Promise<string[]>;
  userName(): Promise<string>;
  createTag(name: string, message: string): Promise<void>;
  pushTag(name: string): Promise<void>;
};
