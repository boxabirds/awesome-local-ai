# Working in this repository

## Nothing reaches another project without asking

This repository is public, and every push is visible to the world under the owner's name. Never cause anything to appear on another project's GitHub (issues, pull requests, discussions, commits) without asking first and getting a clear yes. That includes indirect ways:

- **Commit messages must not reference other repositories' issues or pull requests.** Don't write `owner/repo#123`, `#123` meant for another project, or a github.com issue or pull-request URL in a commit message. GitHub copies the reference, with the whole commit message, onto that issue's timeline, and it can't be removed without rewriting history. To mention one, write it in plain words: "gufo issue 304".
- Links to other projects' issues inside committed documents are fine: GitHub doesn't cross-reference file contents.
- No issues, comments, pull requests, forks or reactions on other projects unless the owner asks for that specific action.

Why: on 28 September 2026 three commit messages saying `gufo-org/gufo#304` put this repository's internal notes (run names, harness constants, session links) on the timeline of an issue the owner had filed with the gufo maintainers, where they meant nothing to anyone.
