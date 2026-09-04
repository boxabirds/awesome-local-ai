import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

console.log('[install] running npm install (idempotent, fast when cached)…')
const res = spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit', shell: false })

if (res.status !== 0) {
  console.error('[install] npm install failed')
  process.exit(res.status ?? 1)
}

if (!existsSync(`${ROOT}/node_modules/.bin/vite`) && !existsSync(`${ROOT}/node_modules/vite`)) {
  console.error('[install] vite missing after install — something is off')
  process.exit(1)
}

console.log('[install] dependencies ready.')
if (process.env.BUILD === '1') {
  console.log('[install] BUILD=1 -> running production build…')
  const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
  console.log('[install] build complete -> dist/')
}
console.log('[install] done.')
