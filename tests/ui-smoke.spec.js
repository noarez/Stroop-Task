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
    await expect(page.locator('#profile-title')).not.toBeEmpty();

    // Verify bars & Hebrew units exist
    await expect(page.locator('#bar-congruent')).toBeVisible();
    await expect(page.locator('#bar-incongruent')).toBeVisible();
    await expect(page.locator('#time-congruent')).toContainText('מ״ש');

    // Verify research explanation card is visible
    await expect(page.locator('.open-insight-card')).toBeVisible();
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
    const title = page.locator('#profile-title');
    await expect(title).toBeVisible();
    const color = await title.evaluate((el) => window.getComputedStyle(el).color);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe('transparent');
  });

  test('Default mode generates SP- participant ID and test banner is hidden', async ({ page }) => {
    await page.goto('/');
    const sid = await page.locator('#session-id-display').textContent();
    expect(sid).toMatch(/^SP-/);
    await expect(page.locator('#test-mode-banner')).toHaveClass(/hidden/);
  });

  test('Test mode (?test=true) generates TEST- participant ID and shows test banner with skip button', async ({ page }) => {
    await page.goto('/?test=true');
    const sid = await page.locator('#session-id-display').textContent();
    expect(sid).toMatch(/^TEST-/);
    await expect(page.locator('#test-mode-banner')).not.toHaveClass(/hidden/);
    await expect(page.locator('#test-mode-banner')).toBeVisible();

    // Click the quick-skip button directly in the UI
    const skipBtn = page.locator('#skip-to-results-btn');
    await expect(skipBtn).toBeVisible();
    await skipBtn.click();

    await expect(page.locator('#screen-complete')).toHaveClass(/active/);
    const completeSid = await page.locator('#session-id-display').textContent();
    expect(completeSid).toContain('TEST-');
  });

});
