// The rounds project's TypeScript module: one function whose two cuts follow each other on one path.
export function vcs(args: string[]): number {
  return args[1].endsWith("/") ? 1 : 0
}

export function publish_all(path: string): string {
  const first = vcs(["add", path])
  const second = vcs(["commit", path])
  if (first + second !== 0) {
    return "failed"
  }
  return `ok:${path}`
}
