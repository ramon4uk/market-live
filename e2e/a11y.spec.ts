import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: import('@playwright/test').Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // Readable failure message: rule id, impacted selectors.
  return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  test('dashboard while running', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('counters')).toContainText(/batches: [1-9]/);
    expect(await violations(page)).toEqual([]);
  });

  test('dashboard while paused', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTestId('toggle').click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'paused');
    expect(await violations(page)).toEqual([]);
  });

  test('settings', async ({ page }) => {
    await page.goto('/settings');
    expect(await violations(page)).toEqual([]);
  });

  test('settings with validation errors', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel(/Number of instruments/).fill('51');
    await expect(page.getByTestId('err-instruments')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('navigation exposes the current page and is keyboard operable', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  test('toggle button is reachable by keyboard and announces its state', async ({ page }) => {
    await page.goto('/dashboard');
    const toggle = page.getByRole('button', { name: 'Pause' });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    await expect(page.getByRole('status').first()).toContainText('Paused');
  });

  test('every settings input has an accessible name', async ({ page }) => {
    await page.goto('/settings');
    for (const name of [/Number of instruments/, /Updates per batch/, /Batch interval/]) {
      await expect(page.getByRole('spinbutton', { name })).toBeVisible();
    }
  });
});
