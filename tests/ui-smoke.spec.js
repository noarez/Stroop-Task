// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Stroop UI & Developer Hook Smoke Tests', () => {

  test('Page loads correctly and has title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Stroop Task/i);
    await expect(page.locator('#screen-intro')).toBeVisible();
  });

  test('Developer hook window.testInsight() triggers completion screen with valid profiles', async ({ page }) => {
    await page.goto('/');
    
    // Execute developer testing hook
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof window.testInsight === 'function') {
        // @ts-ignore
        window.testInsight();
      }
    });

    // Verify complete screen is active
    await expect(page.locator('#screen-complete')).toHaveClass(/active/);

    // Verify insight container is visible and unhidden
    const insightContainer = page.locator('#insight-container');
    await expect(insightContainer).toBeVisible();
    await expect(insightContainer).not.toHaveClass(/hidden/);

    // Verify profile card is populated and shown
    const profileCard = page.locator('#insight-profile');
    await expect(profileCard).toHaveClass(/show/);
    await expect(page.locator('#profile-title')).not.toBeEmpty();

    // Verify bars exist
    await expect(page.locator('#bar-congruent')).toBeVisible();
    await expect(page.locator('#bar-incongruent')).toBeVisible();
  });

  test('Light Mode rendering maintains high contrast and visibility', async ({ page }) => {
    // Emulate light theme preference
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    // Execute developer testing hook
    await page.evaluate(() => {
      // @ts-ignore
      window.testInsight();
    });

    // Check titles and text have valid non-transparent colors
    const title = page.locator('#insight-container .insight-title');
    await expect(title).toBeVisible();
    const color = await title.evaluate((el) => window.getComputedStyle(el).color);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe('transparent');
  });

});
