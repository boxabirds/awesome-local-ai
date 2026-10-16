// The cuts project's TypeScript module: one function with two cuts, a guard and a use, fully covered by core.test.ts.
export function vcs(args: string[]): number {
  return args[1].endsWith("/") ? 1 : 0
}

export function publish(path: string, amend: boolean): string {
  let done: number
  if (amend) {
    done = vcs(["amend", path])
  } else {
    done = vcs(["add", path])
  }
  if (done !== 0) {
    return "failed"
  }
  return `ok:${path}`
}
