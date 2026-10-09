import chromium from '@sparticuz/chromium';
import { chromium as pw } from '@playwright/test';

const executablePath = await chromium.executablePath();
console.log('executable:', executablePath);
const browser = await pw.launch({ executablePath, args: chromium.args, headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:29426/');
await page.waitForFunction(() => window.__vidi6?.connectionState?.() === 'connected', null, { timeout: 15000 });
console.log('connected, url =', page.url());
await browser.close();
console.log('SPARTICUZ CHROMIUM OK');
