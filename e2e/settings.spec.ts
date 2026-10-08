import { expect, test } from '@playwright/test';

test.describe('settings', () => {
  test('Apply restarts the run with the new configuration', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(/Number of instruments/).fill('8');
    await page.getByLabel(/Updates per batch/).fill('200');
    await page.getByLabel(/Batch interval/).fill('100');
    await expect(page.getByTestId('draft-rate')).toContainText('≈ 2000 updates/s');

    await page.getByTestId('apply').click();
    await expect(page.getByTestId('applied')).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(8);
    await expect(page.getByTestId('rate')).toContainText('8 instruments · 200 updates every 100 ms');
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'running');
  });

  test('invalid values show errors and block Apply', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(/Number of instruments/).fill('51');
    await expect(page.getByTestId('err-instruments')).toBeVisible();
    await expect(page.getByTestId('apply')).toBeDisabled();

    await page.getByLabel(/Number of instruments/).fill('50');
    await expect(page.getByTestId('err-instruments')).toHaveCount(0);
    await expect(page.getByTestId('apply')).toBeEnabled();
  });

  test('Apply lifts a pause', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTestId('toggle').click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'paused');

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByTestId('apply').click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'running');
  });

  test('deep link and reload on /settings work', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Data producer settings' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Data producer settings' })).toBeVisible();
  });
});
