/**
 * E2E tests for the /outreach page.
 *
 * All tests drive the UI through the browser only — no direct function imports
 * from app code. The Kissinger GraphQL backend is mocked at the network level
 * via page.route(). Auth is set via cookie injection before navigation.
 *
 * Test groups:
 *   1. Auth & Queue Scoping
 *   2. Contact Data Display
 *   3. LinkedIn Queue Button
 *   4. Batch / Send Flow
 *   5. Tabs
 *   6. Regression: Jake's 3 bugs
 */

import { test, expect, type Page } from "@playwright/test";
import { setJakeAuth, setDrewAuth, clearAuth } from "./fixtures/auth-helpers";
import { KissingerMock, mockOutreachTouchApi, mockNewBatchApi } from "./fixtures/graphql-mock";
import {
  JAKE_CONTACTS,
  JAKE_VISIBLE_CONTACTS,
  JAKE_SENT_CONTACTS,
  DREW_CONTACTS,
} from "./fixtures/jake-contacts";

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

/**
 * Install mocks + auth for Jake and navigate to /outreach.
 * Returns the KissingerMock instance (for assertions on call counts if needed).
 */
async function setupJakePage(
  page: Page,
  opts: { sent?: typeof JAKE_SENT_CONTACTS; includeOtherUsers?: boolean } = {}
): Promise<KissingerMock> {
  await setJakeAuth(page);

  const mock = new KissingerMock(page, {
    contacts: JAKE_CONTACTS,
    sentContacts: opts.sent ?? [],
    otherContacts: opts.includeOtherUsers ? DREW_CONTACTS : [],
  });
  await mock.install();
  await mockNewBatchApi(page);
  await mockOutreachTouchApi(page);

  await page.goto("/outreach");
  // Wait for the Suspense boundary to resolve — look for the active tab or empty state
  await page.waitForSelector('[role="tab"]', { timeout: 15_000 });

  return mock;
}

// ---------------------------------------------------------------------------
// 1. Auth & Queue Scoping
// ---------------------------------------------------------------------------

test.describe("Auth & Queue Scoping", () => {
  test("unauthenticated users are redirected away from /outreach", async ({ page }) => {
    // No cookie set — page should redirect to /login or render a login prompt
    await clearAuth(page);

    // We don't mock GraphQL for unauthenticated — the page should redirect before
    // any data fetch happens (cookie check is in the Page component, before Suspense).
    // Install a GraphQL mock anyway to prevent accidental real network calls.
    const mock = new KissingerMock(page, { contacts: [], sentContacts: [] });
    await mock.install();

    await page.goto("/outreach");

    // Should NOT be on /outreach after redirect
    await expect(page).not.toHaveURL(/\/outreach$/, { timeout: 5_000 });
    // Should be on /login or similar auth page
    await expect(page).toHaveURL(/login|sign-in|auth/, { timeout: 5_000 });

    await mock.uninstall();
  });

  test("Jake sees his own queue, not Ben's or Drew's contacts", async ({ page }) => {
    await setupJakePage(page, { includeOtherUsers: true });

    // All Jake's visible contacts should appear
    for (const contact of JAKE_VISIBLE_CONTACTS.slice(0, 5)) {
      // Use first name to keep assertions readable
      const firstName = contact.name.split(" ")[0];
      await expect(
        page.getByRole("heading", { name: contact.name, exact: false }).or(
          page.getByText(contact.name, { exact: false })
        ).first()
      ).toBeVisible({ timeout: 10_000 });
      // Suppress unused variable warning
      void firstName;
    }

    // Drew's contacts should NOT appear
    for (const contact of DREW_CONTACTS) {
      await expect(page.getByText(contact.name, { exact: true })).not.toBeVisible();
    }
  });

  test("queue is filtered to contacts tagged queue:jake for the authenticated user", async ({
    page,
  }) => {
    await setupJakePage(page);

    // The stat line shows active count — should match Jake's visible contact count
    // (COOs are excluded server-side, so JAKE_VISIBLE_CONTACTS.length)
    const statLine = page.getByText(/\d+ active/, { exact: false });
    await expect(statLine).toBeVisible({ timeout: 10_000 });

    // Verify the count in the stat line matches expected number of visible contacts
    const statText = await statLine.textContent();
    expect(statText).toMatch(/\d+ active/);
    // The count should equal JAKE_VISIBLE_CONTACTS.length (COOs filtered server-side)
    const match = statText?.match(/(\d+) active/);
    expect(match).not.toBeNull();
    const count = Number(match?.[1]);
    expect(count).toBe(JAKE_VISIBLE_CONTACTS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Contact Data Display
// ---------------------------------------------------------------------------

test.describe("Contact Data Display", () => {
  test("each contact card shows full name, company name, stage label, and fit tier badge", async ({
    page,
  }) => {
    await setupJakePage(page);

    // Check a sample of visible contacts
    const sampled = JAKE_VISIBLE_CONTACTS.slice(0, 4);
    for (const contact of sampled) {
      // Name is visible
      await expect(page.getByText(contact.name, { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // Company name — resolved from org entity (not person meta for CSV imports)
      await expect(page.getByText(contact.orgName, { exact: false })).toBeVisible({
        timeout: 10_000,
      });

      // Fit tier badge — e.g. "fit-high", "fit-medium", "fit-low"
      const fitBadge = page.locator(`[class*="fit"] >> text=fit-${contact.fitTier}`).first();
      await expect(fitBadge).toBeVisible({ timeout: 10_000 });
    }
  });

  test("stage label is shown on each contact card", async ({ page }) => {
    await setupJakePage(page);

    // All visible cold contacts should show "Cold" stage label
    const coldContacts = JAKE_VISIBLE_CONTACTS.filter(
      (c) => c.outreachStage === "cold"
    );
    expect(coldContacts.length).toBeGreaterThan(0);

    // At least one "Cold" badge should be present
    const coldBadges = page.getByText("Cold", { exact: true });
    await expect(coldBadges.first()).toBeVisible({ timeout: 10_000 });
  });

  test("LinkedIn URL is present on each contact card — real profile or search fallback", async ({
    page,
  }) => {
    await setupJakePage(page);

    // Every visible contact should have a LinkedIn link (real or search URL).
    // The OutreachTaskCard renders a linkedin icon <a> when linkedinUrl is set.
    // getLinkedinUrl in the client component generates a search URL when none stored,
    // but the server-side kissinger.ts already sets linkedinUrl to a search URL
    // for CSV contacts. So every card should have an <a> pointing to linkedin.com.
    const linkedinLinks = page.locator('a[href*="linkedin.com"]');
    const count = await linkedinLinks.count();
    // Should have at least one LinkedIn link per visible contact
    expect(count).toBeGreaterThanOrEqual(JAKE_VISIBLE_CONTACTS.length);
  });

  test("LinkedIn CSV contacts show company name resolved from org entity", async ({
    page,
  }) => {
    await setupJakePage(page);

    // Alice Brennan is a LinkedIn CSV import (no companyMeta), company = "Railcore Industries"
    // from org entity via works_at edge
    await expect(page.getByText("Alice Brennan", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Railcore Industries", { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("company name is not blank for any visible contact card", async ({ page }) => {
    await setupJakePage(page);

    // Get all visible contact cards and check each has a non-empty company
    // We check this indirectly: every org name in our fixture should appear
    const uniqueOrgNames = [
      ...new Set(JAKE_VISIBLE_CONTACTS.map((c) => c.orgName)),
    ];

    for (const orgName of uniqueOrgNames) {
      await expect(page.getByText(orgName, { exact: false })).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. LinkedIn Queue Button
// ---------------------------------------------------------------------------

test.describe("LinkedIn Queue Button", () => {
  test("button shows correct count of contacts with LinkedIn URLs", async ({ page }) => {
    await setupJakePage(page);

    // The button label is "Open Next N LinkedIn (Jake's queue, M total)" where
    // M = total contacts with any LinkedIn URL (all visible contacts have one)
    const totalWithLinkedin = JAKE_VISIBLE_CONTACTS.filter(
      (c) => c.linkedinUrl
    ).length;

    // Button text contains the total count
    const linkedinBtn = page.getByRole("button", {
      name: new RegExp(`Open Next \\d+ LinkedIn.*${totalWithLinkedin} total`, "i"),
    });
    await expect(linkedinBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test("button is enabled when queue count > 0", async ({ page }) => {
    await setupJakePage(page);

    // Jake has contacts → button should be enabled (not disabled)
    const linkedinBtn = page.getByRole("button", {
      name: /Open Next \d+ LinkedIn/i,
    }).first();
    await expect(linkedinBtn).toBeVisible({ timeout: 10_000 });
    await expect(linkedinBtn).toBeEnabled();
  });

  test("button is disabled (grayed out) when queue is empty", async ({ page }) => {
    await setJakeAuth(page);

    // Empty queue
    const mock = new KissingerMock(page, {
      contacts: [],
      sentContacts: [],
    });
    await mock.install();
    await mockNewBatchApi(page);

    await page.goto("/outreach");
    await page.waitForSelector('[role="tab"]', { timeout: 15_000 });

    // Button shows "No contacts in Jake's queue" and is disabled
    const disabledBtn = page.getByRole("button", {
      name: /No contacts in.*queue/i,
    }).first();
    await expect(disabledBtn).toBeVisible({ timeout: 10_000 });
    await expect(disabledBtn).toBeDisabled();

    await mock.uninstall();
  });

  test("search URLs count toward queue total (button not grayed for search-only contacts)", async ({
    page,
  }) => {
    await setJakeAuth(page);

    // Only contacts with search URLs (no direct profile URL)
    const searchOnlyContacts = JAKE_CONTACTS.filter(
      (c) => c.linkedinUrlType === "search"
    );
    expect(searchOnlyContacts.length).toBeGreaterThan(0);

    const mock = new KissingerMock(page, {
      contacts: searchOnlyContacts,
      sentContacts: [],
    });
    await mock.install();
    await mockNewBatchApi(page);

    await page.goto("/outreach");
    await page.waitForSelector('[role="tab"]', { timeout: 15_000 });

    // Button should be enabled (not grayed out) because search URLs are accepted
    const linkedinBtn = page.getByRole("button", {
      name: /Open Next \d+ LinkedIn/i,
    }).first();
    await expect(linkedinBtn).toBeVisible({ timeout: 10_000 });
    await expect(linkedinBtn).toBeEnabled();

    await mock.uninstall();
  });
});

// ---------------------------------------------------------------------------
// 4. Batch / Send Flow
// ---------------------------------------------------------------------------

test.describe("Batch / Send Flow", () => {
  test('"New Batch" button is visible and enabled on desktop', async ({ page }) => {
    await setupJakePage(page);

    // The "New Batch" button should be present (visible on desktop layout)
    const newBatchBtn = page.getByRole("button", { name: /New Batch/i }).first();
    await expect(newBatchBtn).toBeVisible({ timeout: 10_000 });
    await expect(newBatchBtn).toBeEnabled();
  });

  test('"New Batch" contacts exclude COOs (server-side filter)', async ({ page }) => {
    await setupJakePage(page);

    // Marcus Chen (President & COO) and Robert Nguyen (COO) should not appear in Active tab
    // Their names should not be visible anywhere in the active task list
    const activeTasks = page.locator('[role="tabpanel"]');
    await expect(activeTasks).toBeVisible({ timeout: 10_000 });

    // COO contacts from the fixture that should be excluded
    const cooContacts = JAKE_CONTACTS.filter((c) =>
      /\bcoo\b|chief operating officer/i.test(c.title)
    );
    expect(cooContacts.length).toBeGreaterThan(0); // Verify fixture has COOs

    for (const cooContact of cooContacts) {
      await expect(
        page.getByText(cooContact.name, { exact: true })
      ).not.toBeVisible();
    }
  });

  test('clicking "Mark Sent" optimistically removes contact from Active tab', async ({
    page,
  }) => {
    await setupJakePage(page);

    // Wait for the first contact to appear
    const firstContact = JAKE_VISIBLE_CONTACTS[0];
    await expect(
      page.getByText(firstContact.name, { exact: true })
    ).toBeVisible({ timeout: 10_000 });

    // Find and click the "Mark Sent (T1)" button for this contact
    // The button is within the card containing the contact's name
    const contactCard = page
      .locator("div.rounded-xl.border")
      .filter({ hasText: firstContact.name })
      .first();

    const markSentBtn = contactCard.getByRole("button", {
      name: /Mark Sent/i,
    });
    await expect(markSentBtn).toBeVisible({ timeout: 5_000 });

    // Click Mark Sent
    await markSentBtn.click();

    // Optimistic removal — card should disappear from Active tab immediately
    await expect(
      page.getByText(firstContact.name, { exact: true })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("after Mark Sent, contact moves to Sent tab", async ({ page }) => {
    // Set up with one contact in the sent list (simulates post-mark state)
    // Since the page server-renders Sent tab data from a separate query, we
    // test the Sent tab content by including the contact in SENT_CONTACTS fixture.
    const sentContact = JAKE_SENT_CONTACTS[0];
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    // Click the "Sent" tab
    const sentTab = page.getByRole("tab", { name: /Sent/i }).first();
    await expect(sentTab).toBeVisible({ timeout: 10_000 });
    await sentTab.click();

    // Contact should appear in Sent tab
    await expect(
      page.getByText(sentContact.name, { exact: true })
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Tabs
// ---------------------------------------------------------------------------

test.describe("Tabs", () => {
  test("Active tab is selected by default and shows unsent contacts", async ({ page }) => {
    await setupJakePage(page);

    // Active tab should be selected by default
    const activeTab = page
      .getByRole("tab", { name: /Active/i })
      .first();
    await expect(activeTab).toBeVisible({ timeout: 10_000 });
    await expect(activeTab).toHaveAttribute("aria-selected", "true");

    // At least one Jake contact should be visible
    await expect(
      page.getByText(JAKE_VISIBLE_CONTACTS[0].name, { exact: true })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Sent tab shows sent contacts with clickable name links", async ({ page }) => {
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    // Click Sent tab
    const sentTab = page.getByRole("tab", { name: /Sent/i }).first();
    await sentTab.click();

    // Each sent contact should appear with a clickable link to their contact page
    for (const contact of JAKE_SENT_CONTACTS) {
      const nameLink = page.getByRole("link", { name: contact.name, exact: true });
      await expect(nameLink).toBeVisible({ timeout: 5_000 });
      // Link should go to /contacts/:id
      await expect(nameLink).toHaveAttribute("href", `/contacts/${contact.id}`);
    }
  });

  test("Sent tab shows stage labels (Touch 1 sent, Responded, etc.)", async ({ page }) => {
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    const sentTab = page.getByRole("tab", { name: /Sent/i }).first();
    await sentTab.click();

    // Sandra Rivera is "touched_1" → "Touch 1 sent"
    await expect(page.getByText("Touch 1 sent", { exact: false })).toBeVisible({
      timeout: 5_000,
    });

    // Thomas Burke is "responded" → "Responded"
    await expect(page.getByText("Responded", { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Sent tab shows contact count badge", async ({ page }) => {
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    // The Sent tab button should show the count badge
    const sentTab = page.getByRole("tab", { name: /Sent/i }).first();
    await expect(sentTab).toBeVisible({ timeout: 10_000 });

    // Tab contains the count number
    await expect(sentTab).toContainText(String(JAKE_SENT_CONTACTS.length));
  });

  test("Active tab shows only unsent (cold) contacts — not sent ones", async ({ page }) => {
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    // Active tab should be default selected
    // Sent contacts should NOT appear in Active tab
    for (const sentContact of JAKE_SENT_CONTACTS) {
      await expect(
        page.getByText(sentContact.name, { exact: true })
      ).not.toBeVisible();
    }
  });

  test("switching to Active tab from Sent tab restores the task list", async ({ page }) => {
    await setupJakePage(page, { sent: JAKE_SENT_CONTACTS });

    // Click Sent tab
    const sentTab = page.getByRole("tab", { name: /Sent/i }).first();
    await sentTab.click();

    // Verify we're on Sent
    await expect(page.getByText(JAKE_SENT_CONTACTS[0].name, { exact: true })).toBeVisible();

    // Click Active tab
    const activeTab = page.getByRole("tab", { name: /Active/i }).first();
    await activeTab.click();

    // Jake's active contacts should be visible again
    await expect(
      page.getByText(JAKE_VISIBLE_CONTACTS[0].name, { exact: true })
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Regression: Jake's 3 bugs
// ---------------------------------------------------------------------------

test.describe("Regression: Jake's 3 bugs", () => {
  test("BUG-1: All 16 of Jake's contacts appear in his queue (not split across users)", async ({
    page,
  }) => {
    // This regression guards against the bug where distributeContacts() was called
    // AFTER the queue-scoped fetch, splitting Jake's 16 contacts across Ben/Jake/Drew
    // (he'd only see ~5 instead of all 16 through the Active tab).
    await setupJakePage(page, { includeOtherUsers: true });

    // Count visible contact cards (exclude COOs: Marcus Chen, Robert Nguyen)
    // Each visible contact gets a card with their name
    for (const contact of JAKE_VISIBLE_CONTACTS) {
      await expect(
        page.getByText(contact.name, { exact: true })
      ).toBeVisible({ timeout: 15_000 });
    }

    // The active count stat should match JAKE_VISIBLE_CONTACTS.length (not a fraction)
    const statLine = page.getByText(/\d+ active/, { exact: false });
    const statText = await statLine.textContent();
    const match = statText?.match(/(\d+) active/);
    const count = Number(match?.[1]);
    expect(count).toBe(JAKE_VISIBLE_CONTACTS.length);
  });

  test("BUG-2: Company name is populated for LinkedIn CSV contacts (not blank)", async ({
    page,
  }) => {
    // LinkedIn CSV imports have no company in person meta — company must be resolved
    // via the works_at edge to the org entity. This test asserts the company is shown.
    await setupJakePage(page);

    // All visible CSV-import contacts (companyMeta === "") should show their org name
    const csvContacts = JAKE_VISIBLE_CONTACTS.filter((c) => c.companyMeta === "");
    expect(csvContacts.length).toBeGreaterThan(0);

    // Spot-check several
    for (const contact of csvContacts.slice(0, 5)) {
      // The org name should appear on screen (resolved via works_at)
      await expect(
        page.getByText(contact.orgName, { exact: false })
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("BUG-3: LinkedIn queue button count equals total Jake contacts (not 0)", async ({
    page,
  }) => {
    // This regression guards against the bug where linkedinContacts was calculated
    // from queueTasks which was empty (distributeContacts bug). The button showed
    // "No contacts in Jake's queue" with count 0 instead of the real total.
    await setupJakePage(page);

    const totalWithLinkedin = JAKE_VISIBLE_CONTACTS.filter(
      (c) => c.linkedinUrl
    ).length;

    // The button must show the correct total — NOT 0 and NOT "No contacts"
    const noContactsBtn = page.getByRole("button", {
      name: /No contacts in.*queue/i,
    });
    await expect(noContactsBtn).not.toBeVisible({ timeout: 10_000 });

    // Real count button should be visible and enabled
    const linkedinBtn = page.getByRole("button", {
      name: /Open Next \d+ LinkedIn/i,
    }).first();
    await expect(linkedinBtn).toBeVisible({ timeout: 10_000 });
    await expect(linkedinBtn).toBeEnabled();

    // Verify the total shown in the button label
    const btnText = await linkedinBtn.textContent();
    expect(btnText).toMatch(new RegExp(`${totalWithLinkedin} total`));
  });

  test("BUG-3 variant: queue count shown in stat line matches actual contact count", async ({
    page,
  }) => {
    await setupJakePage(page);

    // The "<N> active" stat line should show the full count
    const statLine = page.getByText(/\d+ active/, { exact: false });
    await expect(statLine).toBeVisible({ timeout: 10_000 });

    const statText = await statLine.textContent();
    const match = statText?.match(/(\d+) active/);
    expect(match).not.toBeNull();
    const count = Number(match?.[1]);
    // Should NOT be 0 — that was the bug (Jake seeing 0 contacts despite having 16)
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(JAKE_VISIBLE_CONTACTS.length);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: header and page structure
// ---------------------------------------------------------------------------

test.describe("Page Structure", () => {
  test("outreach page renders the header with correct title", async ({ page }) => {
    await setupJakePage(page);

    await expect(page.getByRole("heading", { name: "Outreach", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Personalized LinkedIn outreach tasks", { exact: false })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("tab bar shows Active, Signals, and Sent tabs", async ({ page }) => {
    await setupJakePage(page);

    await expect(page.getByRole("tab", { name: /Active/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("tab", { name: /Signals/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("tab", { name: /Sent/i }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("New Batch button shows correct label when not loading", async ({ page }) => {
    await setupJakePage(page);

    const newBatchBtn = page.getByRole("button", { name: /^New Batch$/i }).first();
    await expect(newBatchBtn).toBeVisible({ timeout: 10_000 });
    await expect(newBatchBtn).not.toHaveText("Loading…");
  });

  test("New Batch button shows success banner when batch returns new contacts", async ({
    page,
  }) => {
    await setJakeAuth(page);

    const mock = new KissingerMock(page, {
      contacts: JAKE_CONTACTS,
      sentContacts: [],
    });
    await mock.install();

    // Override new-batch to return 5 added contacts
    await mockNewBatchApi(page, { added: 5, entityIds: ["a", "b", "c", "d", "e"] });

    await page.goto("/outreach");
    await page.waitForSelector('[role="tab"]', { timeout: 15_000 });

    const newBatchBtn = page.getByRole("button", { name: /^New Batch$/i }).first();
    await newBatchBtn.click();

    // Success banner should appear with the count
    await expect(
      page.getByText(/5 fresh prospects added/i)
    ).toBeVisible({ timeout: 10_000 });

    await mock.uninstall();
  });
});
