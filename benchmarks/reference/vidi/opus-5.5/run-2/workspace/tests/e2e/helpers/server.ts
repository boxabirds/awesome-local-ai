/** Address of the shared e2e `wrangler dev` server (playwright.config.ts webServer). */
const DEFAULT_E2E_PORT = 8795;
export const E2E_PORT = Number(process.env.E2E_PORT ?? DEFAULT_E2E_PORT);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
