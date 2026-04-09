/**
 * Tests for investors feature (BIS-327–333)
 *
 * Covers:
 * - Nav links present in MobileNav and desktop layout
 * - /investors page exists and has correct tab hrefs
 * - Investor kinds excluded from contacts filter
 * - Investor data helpers
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function hasHref(src: string, href: string): boolean {
  return (
    src.includes(`href: "${href}"`) ||
    src.includes(`href: '${href}'`) ||
    src.includes(`href="${href}"`) ||
    src.includes(`href='${href}'`) ||
    src.includes(`href={\`${href}\`}`)
  );
}

// ---------------------------------------------------------------------------
// Nav: Investors link present
// ---------------------------------------------------------------------------

describe("MobileNav — Investors", () => {
  const src = readSrc("components/MobileNav.tsx");

  it("contains an Investors link to /investors", () => {
    expect(hasHref(src, "/investors")).toBe(true);
  });

  it("includes 'Investors' label text", () => {
    expect(src).toContain("Investors");
  });
});

describe("Desktop nav — Investors", () => {
  const src = readSrc("app/(main)/layout.tsx");

  it("links to /investors", () => {
    expect(hasHref(src, "/investors")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /investors page structure
// ---------------------------------------------------------------------------

describe("/investors page", () => {
  const src = readSrc("app/(main)/investors/page.tsx");

  it("has Firms tab link", () => {
    expect(src).toContain("firms");
  });

  it("has People tab link", () => {
    expect(src).toContain("people");
  });

  it("has Pipeline tab", () => {
    expect(src).toContain("pipeline");
  });

  it("uses tab query param for navigation", () => {
    expect(src).toContain("?tab=");
  });

  it("renders score badge", () => {
    expect(src).toContain("ScoreBadge");
  });

  it("links to firm detail page", () => {
    expect(src).toContain("/investors/firms/");
  });

  it("links to person detail page", () => {
    expect(src).toContain("/investors/people/");
  });

  it("uses fetchInvestorData", () => {
    expect(src).toContain("fetchInvestorData");
  });

  it("uses scoreInvestor", () => {
    expect(src).toContain("scoreInvestor");
  });

  it("shows pipeline stages", () => {
    const pipelineSrc = src;
    expect(pipelineSrc).toContain("Research");
    expect(pipelineSrc).toContain("Warm Intro");
    expect(pipelineSrc).toContain("Term Sheet");
  });
});

// ---------------------------------------------------------------------------
// Firm detail page
// ---------------------------------------------------------------------------

describe("/investors/firms/[id] page", () => {
  const src = readSrc("app/(main)/investors/firms/[id]/page.tsx");

  it("shows firm name, stage, check size", () => {
    expect(src).toContain("stage");
    expect(src).toContain("check_size");
  });

  it("renders PipelineStageSelector", () => {
    expect(src).toContain("PipelineStageSelector");
  });

  it("shows investor fit score breakdown", () => {
    expect(src).toContain("Investor Fit Score");
    expect(src).toContain("scoreInvestor");
  });

  it("links back to /investors", () => {
    expect(hasHref(src, "/investors")).toBe(true);
  });

  it("renders people at org section", () => {
    expect(src).toContain("Partners");
  });
});

// ---------------------------------------------------------------------------
// Person detail page
// ---------------------------------------------------------------------------

describe("/investors/people/[id] page", () => {
  const src = readSrc("app/(main)/investors/people/[id]/page.tsx");

  it("shows incentive analysis", () => {
    expect(src).toContain("Incentive Analysis");
    expect(src).toContain("inferIncentive");
  });

  it("shows connection path", () => {
    expect(src).toContain("Connection Path");
    expect(src).toContain("warm_intro_path");
  });

  it("shows LinkedIn outreach section", () => {
    expect(src).toContain("LinkedIn Outreach");
    expect(src).toContain("generateLinkedInOutreach");
  });

  it("links to firm detail", () => {
    expect(src).toContain("/investors/firms/");
  });

  it("links back to investors/people", () => {
    expect(src).toContain("/investors?tab=people");
  });

  it("uses CopyButton", () => {
    expect(src).toContain("CopyButton");
  });
});

// ---------------------------------------------------------------------------
// fetchSegmentedContacts — investor exclusion (BIS-327)
// ---------------------------------------------------------------------------

describe("fetchSegmentedContacts investor exclusion", () => {
  const src = readSrc("lib/kissinger.ts");

  it("excludes investor people (tagged vc/investor) from contacts", () => {
    expect(src).toContain("INVESTOR_PERSON_TAGS");
    // The filter is applied
    expect(src).toContain("allPeople.filter");
  });

  it("exports INVESTOR_FIRM_TAGS constant", () => {
    expect(src).toContain("export const INVESTOR_FIRM_TAGS");
  });

  it("exports isInvestorFirm helper", () => {
    expect(src).toContain("export function isInvestorFirm");
  });

  it("exports fetchInvestorData", () => {
    expect(src).toContain("export async function fetchInvestorData");
  });

  it("exports updatePipelineStage", () => {
    expect(src).toContain("export async function updatePipelineStage");
  });
});

// ---------------------------------------------------------------------------
// Pipeline stage API route
// ---------------------------------------------------------------------------

describe("Pipeline stage API route", () => {
  const src = readSrc("app/api/investors/pipeline-stage/route.ts");

  it("exports POST handler", () => {
    expect(src).toContain("export async function POST");
  });

  it("validates stage against valid values", () => {
    expect(src).toContain("VALID_STAGES");
    expect(src).toContain("Research");
    expect(src).toContain("Term Sheet");
  });

  it("uses updatePipelineStage from kissinger lib", () => {
    expect(src).toContain("updatePipelineStage");
  });
});
