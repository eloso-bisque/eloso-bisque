/**
 * Kissinger GraphQL mock router for Playwright tests.
 *
 * Intercepts all requests to http://localhost:8080/graphql and returns
 * canned responses based on the query operation name and variables.
 *
 * Strategy: parse the query string to identify which operation is being
 * requested, then return the appropriate fixture data.
 *
 * Usage:
 *   const mock = new KissingerMock(page, { contacts: JAKE_CONTACTS, sentContacts: [...] });
 *   await mock.install();
 *   // ... navigate / interact ...
 *   await mock.uninstall();
 */

import type { Page, Route } from "@playwright/test";
import type { FixtureContact, FixtureSentContact } from "./jake-contacts";
import {
  buildPersonNode,
  buildSentPersonNode,
  buildEntityDetail,
  buildSentEntityDetail,
  buildEdgesFrom,
  buildOrgTags,
  buildEntitiesPage,
} from "./graphql-helpers";

interface MockOptions {
  /** Active contacts (tagged prospect-contact + queue:<assignee>) */
  contacts: FixtureContact[];
  /** Sent contacts (tagged outreach-sent) */
  sentContacts: FixtureSentContact[];
  /**
   * Other contacts to include in the full scan (e.g. Drew's contacts for
   * queue isolation tests). These appear in the entities scan but lack
   * the current user's queue tag.
   */
  otherContacts?: FixtureContact[];
  /**
   * Optional override for the outreach-touch mutation response.
   * Default: returns newStage "touched_1".
   */
  markSentResponse?: { interactionId: string; newStage: string };
  /**
   * Optional override for the new-batch API response.
   * Default: returns { added: 0, entityIds: [] }.
   */
  newBatchResponse?: { added: number; entityIds: string[]; note?: string };
}

interface GqlBody {
  query: string;
  variables?: Record<string, unknown>;
}

export class KissingerMock {
  private page: Page;
  private opts: MockOptions;

  constructor(page: Page, opts: MockOptions) {
    this.page = page;
    this.opts = opts;
  }

  /** Install the mock route handler */
  async install(): Promise<void> {
    await this.page.route("**/graphql", (route) => this.handleRoute(route));
  }

  /** Remove the mock route handler */
  async uninstall(): Promise<void> {
    await this.page.unroute("**/graphql");
  }

  private async handleRoute(route: Route): Promise<void> {
    const request = route.request();

    let body: GqlBody;
    try {
      body = JSON.parse(request.postData() ?? "{}") as GqlBody;
    } catch {
      await route.fulfill({ status: 400, body: "Bad Request" });
      return;
    }

    const query = body.query ?? "";
    const variables = body.variables ?? {};

    const response = this.buildResponse(query, variables);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: response }),
    });
  }

  private buildResponse(
    query: string,
    variables: Record<string, unknown>
  ): unknown {
    // --- Mutations ---
    if (query.includes("recordOutreachTouch")) {
      return {
        recordOutreachTouch:
          this.opts.markSentResponse ?? {
            interactionId: "test-interaction-id",
            newStage: "touched_1",
          },
      };
    }

    if (query.includes("logInteraction")) {
      return {
        logInteraction: {
          id: "test-log-id",
          kind: "message",
          occurredAt: new Date().toISOString(),
          subject: "LinkedIn outreach",
          notes: "test",
        },
      };
    }

    if (query.includes("updateEntity")) {
      return {
        updateEntity: { id: variables["id"] as string, tags: [], meta: [] },
      };
    }

    // --- Stats queries (not needed for outreach page but may be called) ---
    if (query.includes("graphStats")) {
      return {
        graphStats: {
          totalEntities: 100,
          totalEdges: 50,
          entitiesByKind: [
            { kind: "person", count: 80 },
            { kind: "org", count: 20 },
          ],
          edgesByType: [{ relationType: "works_at", count: 50 }],
        },
      };
    }

    if (query.includes("velocityStats")) {
      return {
        velocityStats: {
          totalEntitiesBefore: 90,
          totalEdgesBefore: 40,
          entitiesByKindBefore: [{ kind: "person", count: 70 }],
        },
      };
    }

    if (query.includes("sectorAggregates")) {
      return { sectorAggregates: [] };
    }

    if (query.includes("contactEvents")) {
      return { contactEvents: [] };
    }

    if (query.includes("introPath")) {
      return { introPath: { found: false, hops: 0, steps: [] } };
    }

    // --- Single entity detail ---
    // This query returns full entity with meta, notes etc.
    // Pattern: entity($id: String!) { id kind name tags notes meta { key value } ... }
    if (
      query.includes("meta { key value }") &&
      query.includes("notes") &&
      variables["id"]
    ) {
      const id = variables["id"] as string;
      return this.buildEntityDetailResponse(id);
    }

    // --- Minimal entity name+tags query (used for OrgTags) ---
    // Pattern: entity($id: String!) { name tags } or entity { id name kind meta { key value } }
    if (query.includes("entity") && variables["id"]) {
      const id = variables["id"] as string;
      if (id.startsWith("org-")) {
        return this.buildOrgTagsResponse(id);
      }
      // Generic entity — return entity detail
      return this.buildEntityDetailResponse(id);
    }

    // --- Edges queries ---
    if (query.includes("edgesFrom") && variables["entityId"]) {
      const entityId = variables["entityId"] as string;
      return this.buildEdgesFromResponse(entityId);
    }

    if (query.includes("edgesTo") && variables["entityId"]) {
      return { edgesTo: { edges: [] } };
    }

    // --- Full entities scan (PROSPECT_CONTACT_QUERY) ---
    // This is the multi-page scan of all person entities
    if (query.includes("entities") && query.includes("pageInfo")) {
      return this.buildEntitiesScanResponse();
    }

    // Unknown query — return empty data rather than error
    console.warn("[KissingerMock] Unhandled query:", query.slice(0, 100));
    return {};
  }

  /** Build the paginated entities scan response (all person entities) */
  private buildEntitiesScanResponse(): unknown {
    const allContacts = [
      ...this.opts.contacts,
      ...(this.opts.otherContacts ?? []),
    ];
    const allSent = this.opts.sentContacts;

    // Build combined person nodes (contacts + sent + others)
    const nodes = [
      ...allContacts.map(buildPersonNode),
      ...allSent.map(buildSentPersonNode),
    ];

    return buildEntitiesPage(nodes);
  }

  /** Build entity detail response for a given entity ID */
  private buildEntityDetailResponse(id: string): unknown {
    // Check active contacts
    const contact = this.opts.contacts.find((c) => c.id === id);
    if (contact) {
      return buildEntityDetail(contact);
    }

    // Check other contacts (e.g. Drew's)
    const otherContact = (this.opts.otherContacts ?? []).find((c) => c.id === id);
    if (otherContact) {
      return buildEntityDetail(otherContact);
    }

    // Check sent contacts
    const sentContact = this.opts.sentContacts.find((c) => c.id === id);
    if (sentContact) {
      return buildSentEntityDetail(sentContact);
    }

    // Unknown entity — return minimal response
    return {
      entity: {
        id,
        kind: "person",
        name: "Unknown",
        tags: [],
        notes: "",
        meta: [],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        archived: false,
      },
    };
  }

  /** Build OrgTags response for a given org ID */
  private buildOrgTagsResponse(orgId: string): unknown {
    // Find the first contact that links to this org
    const contact = [
      ...this.opts.contacts,
      ...(this.opts.otherContacts ?? []),
    ].find((c) => c.orgId === orgId);

    if (contact) {
      return buildOrgTags(contact);
    }

    // Unknown org — return empty
    return { entity: { name: "Unknown Org", tags: [] } };
  }

  /** Build edgesFrom response for a person entity */
  private buildEdgesFromResponse(entityId: string): unknown {
    const contact = [
      ...this.opts.contacts,
      ...(this.opts.otherContacts ?? []),
    ].find((c) => c.id === entityId);

    if (contact) {
      return buildEdgesFrom(contact);
    }

    // No edges for unknown entities
    return { edgesFrom: { edges: [] } };
  }
}

/**
 * Mock the Next.js internal outreach-touch API endpoint.
 * The test calls `POST /api/contacts/:id/outreach-touch` — this mocks it to
 * return 200 OK so the optimistic removal logic fires correctly.
 */
export async function mockOutreachTouchApi(page: Page): Promise<void> {
  await page.route("**/api/contacts/*/outreach-touch", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, newStage: "touched_1" }),
    });
  });
}

/**
 * Mock the new-batch API endpoint.
 */
export async function mockNewBatchApi(
  page: Page,
  response: { added: number; entityIds: string[]; note?: string } = {
    added: 0,
    entityIds: [],
  }
): Promise<void> {
  await page.route("**/api/outreach/new-batch", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}
