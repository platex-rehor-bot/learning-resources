import { test, expect } from '@playwright/test';
import { disableCookiePrompt, PAGE_LOAD_TIMEOUT, openHelpPanel, switchToHelpPanelTab, waitForSupportTabLoaded } from './test-utils';

/**
 * Support Case Tests
 *
 * Migrated from IQE: iqe_platform_ui/tests/test_support_case.py
 *
 * These tests verify that support case functionality is accessible from the help panel:
 * - "Open a support case" button appears in the help menu
 * - Clicking the button opens the Red Hat Customer Portal support case page
 *
 * TODO: Test #3 (test_support_case_from_apps) - Not yet migrated
 * This test verifies that support case data is pre-filled correctly when opened from
 * different apps. It requires:
 * - Complex setup with actual support cases created via API
 * - Cross-domain interaction with Customer Portal
 * - Authentication on the external portal to validate pre-filled data
 * - May be better suited for insights-chrome repository or separate E2E suite
 *
 * Requirements:
 * - PLATFORM_UI-INSIGHTS_CHROME
 * - PLATFORM_UI-SUPPORT_CASES
 */

test.describe('Support Case - Help Panel', () => {
  test.beforeEach(async ({ page }) => {
    // Block trustarc cookie prompts
    await disableCookiePrompt(page);

    // Navigate to home page - authentication state is already loaded from global setup
    await page.goto('/', { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT });

    // Wait for chrome header to be fully loaded
    await expect(page.getByText('Hi,')).toBeVisible();
  });

  test('should display "Open a support case" link in help panel', async ({ page }) => {
    // Step 1-3: Open help panel and navigate to Support tab
    await openHelpPanel(page);
    await switchToHelpPanelTab(page, 'Support');

    // Step 4: Wait for the support panel to finish loading
    await waitForSupportTabLoaded(page);

    // Step 5: The "Open a support case" button should now be visible
    await expect(page.getByRole('button', { name: 'Open a support case' })).toBeVisible();
  });

  test('should open Customer Portal when clicking "Open a support case" link', async ({ page, context }) => {
    // Step 1-3: Open help panel and navigate to Support tab
    await openHelpPanel(page);
    await switchToHelpPanelTab(page, 'Support');

    // Step 4: Wait for the support panel to finish loading
    await waitForSupportTabLoaded(page);

    // Step 5: Set up listener for new page/tab before clicking
    const pagePromise = context.waitForEvent('page');

    // Step 6: Click the "Open a support case" button (use role selector to avoid strict mode violation)
    await page.getByRole('button', { name: 'Open a support case' }).click();

    // Step 7: Wait for new page to open and verify it navigates to Red Hat Customer Portal
    const newPage = await pagePromise;

    // Wait for navigation to Red Hat Customer Portal (page starts at about:blank)
    await newPage.waitForURL(/access\.redhat\.com/);

    // Verify the destination hostname (we can't validate page content due to auth requirements)
    const url = new URL(newPage.url());
    expect(url.hostname).toBe('access.redhat.com');

    // Clean up - close the new tab
    await newPage.close();
  });

  // FIXME: This test requires the test user to have open support cases in the stage environment.
  // Currently disabled because the test user has no open cases, causing the test to always see
  // the empty state. To enable this test:
  // 1. Create support cases for the test user via Red Hat Customer Portal, OR
  // 2. Use a different test user that has existing support cases, OR
  // 3. Implement test data seeding to create support cases via API before running tests
  test.fixme('should display support cases table when user has open cases', async ({ page }) => {
    // Step 1-3: Open help panel and navigate to Support tab
    await openHelpPanel(page);
    await switchToHelpPanelTab(page, 'Support');

    // Step 4: Wait for support panel to load
    await waitForSupportTabLoaded(page);

    const supportTable = page.locator('[data-ouia-component-id="help-panel-support-cases-table"]');

    // Verify table is visible (will fail if user has no cases)
    await expect(supportTable).toBeVisible();

    // Verify pagination is present
    const pagination = page.locator('[data-ouia-component-id="help-panel-support-pagination"]');
    await expect(pagination).toBeVisible();

    // Verify table has at least one row (case)
    const tableRows = supportTable.locator('tbody tr');
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);
  });
});
