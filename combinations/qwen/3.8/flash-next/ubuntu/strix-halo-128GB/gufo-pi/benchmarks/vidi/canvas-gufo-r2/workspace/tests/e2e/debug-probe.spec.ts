import { expect, test } from '@playwright/test';
import { createBoard, dropFiles, fixturePath, openBoard } from './helpers/drop-files';

test('probe hit target of Retry', async ({ page, request }) => {
  const boardId = await createBoard(request);
  await openBoard(page, boardId);
  await page.route('**/api/boards/*/assets', (route) => route.abort());
  await dropFiles(page, [fixturePath('tiny.png')], { x: 360, y: 320 });
  await expect(page.getByTestId('image-failed')).toBeVisible();
  const info = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="image-retry"]');
    const r = btn!.getBoundingClientRect();
    const names = (els: Element[]) => els.map((e) => `${e.tagName}.${(e.className || '').toString().split(' ')[0]}`);
    const chain = ['image-object', 'image-placeholder', 'image-placeholder-body', 'image-controls'];
    const overflows: Record<string, string> = {};
    for (const cls of chain) {
      const el = document.querySelector('.' + cls);
      if (el) overflows[cls] = `${getComputedStyle(el).overflow} / ${getComputedStyle(el).contain}`;
    }
    return {
      atCentre: names([...document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)]),
      atRight: names([...document.elementsFromPoint(r.right - 2, r.y + r.height / 2)]),
      overflows,
    };
  });
  console.log('PROBE', JSON.stringify(info, null, 2));
});
