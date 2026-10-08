import { expect, test } from '@playwright/test';

test.describe('navigation tabs', () => {
  // Regression: links are draggable by default, so a few px of pointer drift between press and release
  // started a drag and the click was swallowed.
  for (const drift of [0, 3, 6, 12]) {
    test(`click still navigates with ${drift}px of pointer drift`, async ({ page }) => {
      await page.goto('/dashboard');
      const box = (await page.getByRole('link', { name: 'Settings' }).boundingBox())!;
      const x = box.x + 20;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + drift, y + 1, { steps: 4 });
      await page.mouse.up();
      await expect(page).toHaveURL(/\/settings$/);
    });
  }
});
