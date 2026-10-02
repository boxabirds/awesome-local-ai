# Story 2: Capture ideas on sticky notes and rearrange them

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board model unit tests first against a real Y.Doc (TC-01 to TC-12, TC-39) | done |
| 2 | Implement Yjs board model and useBoardDoc snapshot hook | done |
| 3 | Write sticky text logic unit tests first (TC-13 to TC-17) | done |
| 4 | Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font | done |
| 5 | Implement sticky note interaction: select, drag to move, double-click create, keyboard delete | done |
| 6 | Implement toolbars: Sticky note button, colour swatches and delete button | done |
| 7 | Component tests for sticky interaction, text editor and toolbars | done |
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Notes on task 8

Task 8 asks for the e2e cases to pass in chromium, firefox and webkit. Only chromium
can start on this machine: firefox and webkit binaries are installed but the host is
missing their system libraries (firefox needs `libgtk-3-0t64`, webkit needs
`libhyphen.so.0`, `libsecret-1.so.0`, `libGLESv2.so.2`, `libx264.so`, ...) and there is
no root access to install them. The cases are written browser-agnostically and
`playwright.config.ts` runs every browser that is available
(`E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e`). See NOTES.md.
