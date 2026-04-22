import { describe, it, expect } from "vitest";
import {
  assignContact,
  distributeContacts,
  generateMessage,
  ProspectContact,
  OutreachTask,
  TEAM_MEMBERS,
} from "../outreach";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeContact(overrides: Partial<ProspectContact> = {}): ProspectContact {
  return {
    id: "test-id",
    name: "John Doe",
    title: "CEO",
    company: "Acme Corp",
    sector: [],
    fitTier: "high",
    ...overrides,
  };
}

function makeTask(contact: ProspectContact, assignee: "Ben" | "Jake" | "Drew"): OutreachTask {
  return {
    id: `${contact.id}-${assignee}`,
    contact,
    assignee,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// assignContact
// ---------------------------------------------------------------------------

describe("assignContact", () => {
  it("assigns defense sector to Ben", () => {
    const c = makeContact({ sector: ["defense"] });
    expect(assignContact(c, 0)).toBe("Ben");
  });

  it("assigns evtol sector to Ben", () => {
    const c = makeContact({ sector: ["evtol"] });
    expect(assignContact(c, 0)).toBe("Ben");
  });

  it("assigns machine-vision sector to Jake", () => {
    const c = makeContact({ sector: ["machine-vision"] });
    expect(assignContact(c, 0)).toBe("Jake");
  });

  it("assigns enterprise-tech sector to Jake", () => {
    const c = makeContact({ sector: ["enterprise-tech"] });
    expect(assignContact(c, 0)).toBe("Jake");
  });

  it("assigns robotics sector to Jake", () => {
    const c = makeContact({ sector: ["robotics"] });
    expect(assignContact(c, 0)).toBe("Jake");
  });

  it("assigns rail-transportation-equipment to Drew", () => {
    const c = makeContact({ sector: ["rail-transportation-equipment"] });
    expect(assignContact(c, 0)).toBe("Drew");
  });

  it("assigns industrial-specialty-manufacturing to Drew", () => {
    const c = makeContact({ sector: ["industrial-specialty-manufacturing"] });
    expect(assignContact(c, 0)).toBe("Drew");
  });

  it("falls back to round-robin for unknown sector (index 0 → Ben)", () => {
    const c = makeContact({ sector: ["unknown-sector"] });
    expect(assignContact(c, 0)).toBe("Ben");
  });

  it("falls back to round-robin for unknown sector (index 1 → Jake)", () => {
    const c = makeContact({ sector: ["unknown-sector"] });
    expect(assignContact(c, 1)).toBe("Jake");
  });

  it("falls back to round-robin for unknown sector (index 2 → Drew)", () => {
    const c = makeContact({ sector: ["unknown-sector"] });
    expect(assignContact(c, 2)).toBe("Drew");
  });

  it("falls back to round-robin for empty sector (index 3 wraps to Ben)", () => {
    const c = makeContact({ sector: [] });
    expect(assignContact(c, 3)).toBe("Ben");
  });

  it("uses first matching sector tag when multiple sectors present", () => {
    // defense (Ben) is first, so should win over rail (Drew)
    const c = makeContact({ sector: ["defense", "rail-transportation-equipment"] });
    expect(assignContact(c, 0)).toBe("Ben");
  });
});

// ---------------------------------------------------------------------------
// distributeContacts
// ---------------------------------------------------------------------------

describe("distributeContacts", () => {
  it("returns empty arrays for all members when contacts is empty", () => {
    const result = distributeContacts([]);
    expect(result.Ben).toHaveLength(0);
    expect(result.Jake).toHaveLength(0);
    expect(result.Drew).toHaveLength(0);
  });

  it("assigns all known-sector contacts to correct members", () => {
    const contacts: ProspectContact[] = [
      makeContact({ id: "1", name: "Alice", sector: ["defense"] }),
      makeContact({ id: "2", name: "Bob", sector: ["enterprise-tech"] }),
      makeContact({ id: "3", name: "Carol", sector: ["rail-transportation-equipment"] }),
    ];
    const result = distributeContacts(contacts);
    expect(result.Ben.map((t) => t.contact.name)).toContain("Alice");
    expect(result.Jake.map((t) => t.contact.name)).toContain("Bob");
    expect(result.Drew.map((t) => t.contact.name)).toContain("Carol");
  });

  it("total tasks across all members equals total contacts", () => {
    const contacts = [
      makeContact({ id: "a", sector: ["defense"] }),
      makeContact({ id: "b", sector: ["robotics"] }),
      makeContact({ id: "c", sector: ["rail-transportation-equipment"] }),
      makeContact({ id: "d", sector: ["ev-battery"] }),
      makeContact({ id: "e", sector: ["fluid-control-water-tech"] }),
    ];
    const result = distributeContacts(contacts);
    const total = result.Ben.length + result.Jake.length + result.Drew.length;
    expect(total).toBe(contacts.length);
  });

  it("each task tracks the correct assignee", () => {
    const contacts = [
      makeContact({ id: "x", sector: ["machine-vision"] }),
    ];
    const result = distributeContacts(contacts);
    expect(result.Jake[0].assignee).toBe("Jake");
  });

  it("each task has a generatedAt timestamp", () => {
    const contacts = [makeContact({ id: "ts", sector: [] })];
    const result = distributeContacts(contacts);
    const allTasks = [...result.Ben, ...result.Jake, ...result.Drew];
    for (const task of allTasks) {
      expect(task.generatedAt).toBeTruthy();
      expect(() => new Date(task.generatedAt)).not.toThrow();
    }
  });

  it("no contact ID appears in more than one bucket (strict partition)", () => {
    const contacts: ProspectContact[] = [
      makeContact({ id: "1", name: "Alice", sector: ["defense"] }),
      makeContact({ id: "2", name: "Bob", sector: ["enterprise-tech"] }),
      makeContact({ id: "3", name: "Carol", sector: ["rail-transportation-equipment"] }),
      makeContact({ id: "4", name: "Dan", sector: [] }),
      makeContact({ id: "5", name: "Eve", sector: [] }),
      makeContact({ id: "6", name: "Frank", sector: [] }),
      makeContact({ id: "7", name: "Grace", sector: ["defense"] }),
      makeContact({ id: "8", name: "Hank", sector: ["robotics"] }),
    ];
    const result = distributeContacts(contacts);
    const allTasks = [...result.Ben, ...result.Jake, ...result.Drew];

    // Total contacts == total tasks
    expect(allTasks.length).toBe(contacts.length);

    // No contact ID appears more than once
    const ids = allTasks.map((t) => t.contact.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("round-robin fallback distributes unclassified contacts evenly (not by global index)", () => {
    // 3 unclassified contacts should go to Ben(0), Jake(1), Drew(2) in order
    // even though their global array positions might be mixed.
    const contacts: ProspectContact[] = [
      makeContact({ id: "s1", sector: ["defense"] }),   // → Ben (sector)
      makeContact({ id: "u1", sector: [] }),              // → Ben (fallback 0)
      makeContact({ id: "s2", sector: ["robotics"] }),   // → Jake (sector)
      makeContact({ id: "u2", sector: [] }),              // → Jake (fallback 1)
      makeContact({ id: "s3", sector: ["rail-transportation-equipment"] }), // → Drew (sector)
      makeContact({ id: "u3", sector: [] }),              // → Drew (fallback 2)
    ];
    const result = distributeContacts(contacts);

    // Sector-assigned contacts
    expect(result.Ben.some((t) => t.contact.id === "s1")).toBe(true);
    expect(result.Jake.some((t) => t.contact.id === "s2")).toBe(true);
    expect(result.Drew.some((t) => t.contact.id === "s3")).toBe(true);

    // Fallback-assigned contacts distribute Ben → Jake → Drew
    expect(result.Ben.some((t) => t.contact.id === "u1")).toBe(true);
    expect(result.Jake.some((t) => t.contact.id === "u2")).toBe(true);
    expect(result.Drew.some((t) => t.contact.id === "u3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateMessage
// ---------------------------------------------------------------------------

describe("generateMessage", () => {
  it("generates a message containing the contact's first name", () => {
    const contact = makeContact({ name: "Sarah Johnson", title: "CEO", company: "TestCo" });
    const task = makeTask(contact, "Ben");
    const result = generateMessage(task);
    expect(result.message).toContain("Sarah");
  });

  it("Ben messages use vision angle", () => {
    const contact = makeContact({ name: "Alice", title: "CEO", company: "TestCo" });
    const result = generateMessage(makeTask(contact, "Ben"));
    expect(result.angle).toBe("vision");
  });

  it("Jake messages use technical angle", () => {
    const contact = makeContact({ name: "Bob", title: "CTO", company: "TestCo" });
    const result = generateMessage(makeTask(contact, "Jake"));
    expect(result.angle).toBe("technical");
  });

  it("Drew messages use strategic angle", () => {
    const contact = makeContact({ name: "Carol", title: "CFO", company: "TestCo" });
    const result = generateMessage(makeTask(contact, "Drew"));
    expect(result.angle).toBe("strategic");
  });

  it("message mentions Eloso", () => {
    const contact = makeContact({ name: "Dan", title: "CEO", company: "TestCo" });
    const result = generateMessage(makeTask(contact, "Ben"));
    expect(result.message).toMatch(/eloso/i);
  });

  it("message is non-empty and reasonably long", () => {
    const contact = makeContact({ name: "Eve", title: "President", company: "TestCo" });
    const result = generateMessage(makeTask(contact, "Drew"));
    expect(result.message.length).toBeGreaterThan(100);
  });

  it("defense sector contact gets defense-specific hook", () => {
    const contact = makeContact({ name: "Frank", title: "CEO", company: "DefenseCo", sector: ["defense"] });
    const result = generateMessage(makeTask(contact, "Ben"));
    expect(result.message).toMatch(/defense|backlog|component/i);
  });

  it("rail sector contact gets rail-specific hook", () => {
    const contact = makeContact({ name: "Grace", title: "President", company: "RailCo", sector: ["rail-transportation-equipment"] });
    const result = generateMessage(makeTask(contact, "Drew"));
    expect(result.message).toMatch(/rail|backlog/i);
  });

  it("CFO/finance title gets finance-appropriate opener", () => {
    const contact = makeContact({ name: "Henry", title: "CFO", company: "FinanceCo" });
    const result = generateMessage(makeTask(contact, "Jake"));
    expect(result.message).toMatch(/financial|finance|vantage/i);
  });

  it("CEO title gets founder-appropriate opener", () => {
    const contact = makeContact({ name: "Iris", title: "CEO", company: "StartupCo" });
    const result = generateMessage(makeTask(contact, "Ben"));
    expect(result.message).toMatch(/following|reach out directly/i);
  });

  it("returns task reference in result", () => {
    const contact = makeContact({ name: "Jack", title: "CEO", company: "TestCo" });
    const task = makeTask(contact, "Drew");
    const result = generateMessage(task);
    expect(result.task).toBe(task);
  });
});

// ---------------------------------------------------------------------------
// TEAM_MEMBERS constant
// ---------------------------------------------------------------------------

describe("TEAM_MEMBERS", () => {
  it("contains exactly Ben, Jake, and Drew", () => {
    expect(TEAM_MEMBERS).toEqual(["Ben", "Jake", "Drew"]);
  });
});
