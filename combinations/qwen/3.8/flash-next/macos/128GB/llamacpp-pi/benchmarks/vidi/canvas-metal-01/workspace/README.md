# vidi6

## Development

```bash
npm install
npm run dev          # Vite dev server
npm run serve        # production build, served by wrangler (Cloudflare Workers static assets)

npm run typecheck
npm run test:unit        # Vitest, node
npm run test:component   # Vitest, jsdom
npm run test:e2e         # Playwright (chromium, firefox, webkit) against `wrangler dev`
```

Client-only infinite whiteboard. Camera maths lives in
[`src/client/canvas/camera.ts`](src/client/canvas/camera.ts) (pure, unit tested), the
viewport owns camera state ([`useCamera`](src/client/canvas/useCamera.ts)), and
`src/shared/config.ts` holds every product setting and test fixture — components must not
hardcode a number.

See [`NOTES.md`](NOTES.md) for decisions and deviations, and
[`spec/`](spec/) for the specs (source of truth, do not edit).

## Deploying

`wrangler.jsonc` serves `dist/client` with single-page-application fallback. There is no
API yet — story 1 is client-only.
