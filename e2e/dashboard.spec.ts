import { expect, test } from '@playwright/test';

test.describe('dashboard', () => {
  test('starts the Wasm producer and fills the table', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('tbody tr')).toHaveCount(5);

    // Every row receives data from the worker: the counters grow and the last price is rendered.
    await expect(page.getByTestId('counters')).toContainText(/batches: [1-9]/);
    await expect(page.locator('tbody tr').first().locator('[data-col="last"]')).toHaveText(/\d/);
    await expect(page.getByTestId('actual-rate')).toBeVisible();
  });

  test('pause freezes the counters and resume continues them', async ({ page }) => {
    await page.goto('/dashboard');
    const counters = page.getByTestId('counters');
    const toggle = page.getByTestId('toggle');
    await expect(counters).toContainText(/batches: [1-9]/);

    await toggle.click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'paused');
    await expect(toggle).toHaveText(/Resume/);

    // Let a possible in-flight batch land, then the text must stay unchanged.
    await page.waitForTimeout(300);
    const frozen = await counters.textContent();
    await page.waitForTimeout(1200);
    await expect(counters).toHaveText(frozen!);

    await toggle.click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'running');
    await expect(counters).not.toHaveText(frozen!);
  });
});
