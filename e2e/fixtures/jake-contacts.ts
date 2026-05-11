/**
 * Fixture data for Jake's outreach queue.
 *
 * Represents 16 contacts tagged `queue:jake` + `prospect-contact`.
 * Most contacts are LinkedIn CSV imports: no direct company/org meta on the
 * person entity. Company name is resolved via a `works_at` edge to an org entity.
 *
 * Contact IDs use the prefix "jake-contact-" for easy identification.
 * Org IDs use the prefix "org-".
 */

export interface FixtureContact {
  id: string;
  name: string;
  title: string;
  /** Empty string = LinkedIn CSV import — company comes from org entity via works_at */
  companyMeta: string;
  orgId: string;
  orgName: string;
  /** Sector tags on the org entity (determines fit tier and assignment) */
  orgTags: string[];
  fitTier: "high" | "medium" | "low";
  linkedinUrl: string;
  /** Whether to use a real profile URL or a search URL (LinkedIn CSV fallback) */
  linkedinUrlType: "profile" | "search";
  outreachStage: "cold" | "touched_1";
  tags: string[];
}

/** 16 contacts for Jake's queue — a realistic mix of LinkedIn CSV imports */
export const JAKE_CONTACTS: FixtureContact[] = [
  {
    id: "jake-contact-01",
    name: "Alice Brennan",
    title: "VP of Operations",
    companyMeta: "", // LinkedIn CSV — no company in person meta
    orgId: "org-01",
    orgName: "Railcore Industries",
    orgTags: ["prospect", "fit-high", "rail-transportation-equipment"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/alice-brennan-rail",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-02",
    name: "Carlos Mendez",
    title: "President",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-02",
    orgName: "Apex Heavy Equipment",
    orgTags: ["prospect", "fit-high", "heavy-equipment"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Carlos%20Mendez",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-03",
    name: "Diana Walsh",
    title: "CFO",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-03",
    orgName: "BuildCore Construction",
    orgTags: ["prospect", "fit-high", "building-products-construction"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/diana-walsh-cfo",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-04",
    name: "Edward Kim",
    title: "CEO",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-04",
    orgName: "Fluid Systems Corp",
    orgTags: ["prospect", "fit-medium", "fluid-control-water-tech"],
    fitTier: "medium",
    linkedinUrl: "https://www.linkedin.com/in/edward-kim-fluids",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-05",
    name: "Fatima Hassan",
    title: "Director of Supply Chain",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-05",
    orgName: "ChemSpec Materials",
    orgTags: ["prospect", "fit-medium", "specialty-chemicals-materials"],
    fitTier: "medium",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Fatima%20Hassan",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-06",
    name: "George Petrov",
    title: "Head of Procurement",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-06",
    orgName: "Capital Goods International",
    orgTags: ["prospect", "fit-high", "capital-goods"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/george-petrov-procurement",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-07",
    name: "Hannah Liu",
    title: "VP Strategy",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-07",
    orgName: "Precision Mfg LLC",
    orgTags: ["prospect", "fit-medium", "industrial-specialty-manufacturing"],
    fitTier: "medium",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Hannah%20Liu",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-08",
    name: "Ivan Torres",
    title: "Founder & Chairman",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-08",
    orgName: "AeroCommercial Systems",
    orgTags: ["prospect", "fit-high", "aerospace-commercial"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/ivan-torres-aero",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-09",
    name: "Julia Okafor",
    title: "General Manager",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-09",
    orgName: "ContractMfg Partners",
    orgTags: ["prospect", "fit-low", "contract-manufacturing"],
    fitTier: "low",
    linkedinUrl: "https://www.linkedin.com/in/julia-okafor-gm",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-10",
    name: "Kevin Park",
    title: "EVP Operations",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-01", // Same org as Alice Brennan (realistic duplication)
    orgName: "Railcore Industries",
    orgTags: ["prospect", "fit-high", "rail-transportation-equipment"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Kevin%20Park",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-11",
    name: "Laura Simmons",
    title: "CFO",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-10",
    orgName: "HeavyLift Equipment Inc",
    orgTags: ["prospect", "fit-high", "heavy-equipment"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/laura-simmons-cfo",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-12",
    name: "Marcus Chen",
    title: "President & COO", // NOTE: this has COO — should be excluded by isTitleExcluded
    companyMeta: "",
    orgId: "org-11",
    orgName: "GlobalRail Systems",
    orgTags: ["prospect", "fit-high", "rail-transportation-equipment"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/marcus-chen",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-13",
    name: "Nina Gupta",
    title: "VP Manufacturing",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-12",
    orgName: "SpecChem Industries",
    orgTags: ["prospect", "fit-medium", "specialty-chemicals-materials"],
    fitTier: "medium",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Nina%20Gupta",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-14",
    name: "Omar Rashid",
    title: "Director of Ops",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-13",
    orgName: "BuildProducts Global",
    orgTags: ["prospect", "fit-high", "building-products-construction"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/omar-rashid-ops",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-15",
    name: "Patricia Flynn",
    title: "CEO",
    companyMeta: "", // LinkedIn CSV
    orgId: "org-14",
    orgName: "Fluid Dynamics Tech",
    orgTags: ["prospect", "fit-high", "fluid-control-water-tech"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/search/results/people/?keywords=Patricia%20Flynn",
    linkedinUrlType: "search",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
  {
    id: "jake-contact-16",
    name: "Robert Nguyen",
    title: "COO", // pure COO — should be excluded
    companyMeta: "",
    orgId: "org-15",
    orgName: "Industrial Partners Ltd",
    orgTags: ["prospect", "fit-medium", "industrial-specialty-manufacturing"],
    fitTier: "medium",
    linkedinUrl: "https://www.linkedin.com/in/robert-nguyen-coo",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:jake"],
  },
];

/**
 * Contacts that should be VISIBLE in Jake's active queue (COOs excluded at server level).
 * Jake's queue has 16 total; Marcus Chen (President & COO) and Robert Nguyen (COO) are
 * filtered server-side by isTitleExcluded(). That leaves 14 visible contacts.
 *
 * NOTE: For the regression tests we test the server behavior with 16 raw entities that
 * have tags "queue:jake", and assert that the page renders 14 visible cards (COOs filtered).
 * The "all 16 appear" regression checks that ALL 16 survive queue scoping (not split),
 * and the COO filter is a separate server-side concern tested independently.
 */
export const JAKE_VISIBLE_CONTACTS = JAKE_CONTACTS.filter(
  (c) => !c.title.toLowerCase().match(/\bcoo\b|chief operating officer/)
);

/** Contacts with real LinkedIn profile URLs (not search URLs) */
export const JAKE_PROFILE_URL_CONTACTS = JAKE_VISIBLE_CONTACTS.filter(
  (c) => c.linkedinUrlType === "profile"
);

/** Contacts with search URL fallbacks */
export const JAKE_SEARCH_URL_CONTACTS = JAKE_VISIBLE_CONTACTS.filter(
  (c) => c.linkedinUrlType === "search"
);

/** Sent contacts fixture — used for Sent tab tests */
export interface FixtureSentContact {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
  outreachStage: "touched_1" | "touched_2" | "touched_3" | "responded";
  outreachMessageSender: string;
  tags: string[];
}

export const JAKE_SENT_CONTACTS: FixtureSentContact[] = [
  {
    id: "jake-sent-01",
    name: "Sandra Rivera",
    title: "VP of Ops",
    company: "HeavyLift Co",
    linkedinUrl: "https://www.linkedin.com/in/sandra-rivera",
    outreachStage: "touched_1",
    outreachMessageSender: "jake",
    tags: ["outreach-sent"],
  },
  {
    id: "jake-sent-02",
    name: "Thomas Burke",
    title: "CEO",
    company: "Rail Systems Inc",
    linkedinUrl: "https://www.linkedin.com/in/thomas-burke",
    outreachStage: "responded",
    outreachMessageSender: "jake",
    tags: ["outreach-sent"],
  },
];

/** Drew's contacts — used to verify Jake does NOT see them */
export const DREW_CONTACTS: FixtureContact[] = [
  {
    id: "drew-contact-01",
    name: "Xavier Ortega",
    title: "CTO",
    companyMeta: "Robotics Labs Inc",
    orgId: "org-drew-01",
    orgName: "Robotics Labs Inc",
    orgTags: ["prospect", "fit-high", "robotics"],
    fitTier: "high",
    linkedinUrl: "https://www.linkedin.com/in/xavier-ortega",
    linkedinUrlType: "profile",
    outreachStage: "cold",
    tags: ["prospect-contact", "queue:drew"],
  },
];
