/**
 * Navigation link tests.
 *
 * Verify that every expected navigation target is reachable via a correctly
 * configured href — catching regressions where buttons replace links or hrefs
 * get the wrong path.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(__dirname, "../../");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

/** Check if source contains a given href value (handles quotes and template literals). */
function hasHref(src: string, href: string): boolean {
  // Matches: href="...", href='...', href={`...`}, or literal string in NAV_ITEMS array
  return (
    src.includes(`href: "${href}"`) ||
    src.includes(`href: '${href}'`) ||
    src.includes(`href="${href}"`) ||
    src.includes(`href='${href}'`) ||
    // Template literal with exact path (no interpolation)
    src.includes(`href={\`${href}\`}`)
  );
}

// ---------------------------------------------------------------------------
// MobileNav
// ---------------------------------------------------------------------------

describe("MobileNav", () => {
  const src = readSrc("components/MobileNav.tsx");

  it("contains a Dashboard link to /", () => {
    expect(hasHref(src, "/")).toBe(true);
  });

  it("contains a Contacts link to /contacts", () => {
    expect(hasHref(src, "/contacts")).toBe(true);
  });

  it("contains an Outreach link to /outreach", () => {
    expect(hasHref(src, "/outreach")).toBe(true);
  });

  it("contains a Funnel link to /funnel", () => {
    expect(hasHref(src, "/funnel")).toBe(true);
  });

  it("uses Next.js Link (not plain <button> for navigation)", () => {
    expect(src).toContain("import Link from");
    // No button with href (buttons shouldn't do navigation)
    expect(src).not.toMatch(/<button[^>]*href/);
  });
});

// ---------------------------------------------------------------------------
// Desktop top nav (main layout)
// ---------------------------------------------------------------------------

describe("Desktop nav (main layout)", () => {
  const src = readSrc("app/(main)/layout.tsx");

  it("links to / (Dashboard)", () => {
    expect(hasHref(src, "/")).toBe(true);
  });

  it("links to /contacts", () => {
    expect(hasHref(src, "/contacts")).toBe(true);
  });

  it("links to /funnel", () => {
    expect(hasHref(src, "/funnel")).toBe(true);
  });

  it("links to /outreach", () => {
    expect(hasHref(src, "/outreach")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dashboard quick links (home page)
// ---------------------------------------------------------------------------

describe("Dashboard quick links", () => {
  const src = readSrc("app/(main)/page.tsx");

  it("has a quick link to /contacts", () => {
    expect(hasHref(src, "/contacts")).toBe(true);
  });

  it("has a quick link to /funnel", () => {
    expect(hasHref(src, "/funnel")).toBe(true);
  });

  it("has a quick link to /outreach", () => {
    expect(hasHref(src, "/outreach")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contacts page — segment tabs
// ---------------------------------------------------------------------------

describe("Contacts page segment tabs", () => {
  const src = readSrc("app/(main)/contacts/page.tsx");

  it("defines prospects as a valid segment", () => {
    // The tabs array includes key: "prospects" which drives href generation
    expect(src).toContain('"prospects"');
  });

  it("defines people as a valid segment", () => {
    expect(src).toContain('"people"');
  });

  it("defines vc as a valid segment", () => {
    expect(src).toContain('"vc"');
  });

  it("builds tab hrefs with segment query param", () => {
    // The tab links use template literals: `/contacts?segment=${tab.key}`
    expect(src).toContain("/contacts?segment=");
  });
});
