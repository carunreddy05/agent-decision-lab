import { describe, expect, it } from "vitest";
import { createTicket, readTicket, searchTickets } from "@/tools/jira-tool";

describe("searchTickets", () => {
  it("matches by exact ticket id", () => {
    expect(searchTickets("ENG-142").some((t) => t.id === "ENG-142")).toBe(true);
  });

  it("matches by title/body content", () => {
    expect(searchTickets("logged out").some((t) => t.id === "ENG-118")).toBe(true);
  });
});

describe("readTicket", () => {
  it("is case-insensitive", () => {
    expect(readTicket("eng-142")?.title).toBe("Checkout request occasionally times out");
  });

  it("returns undefined for an unknown id", () => {
    expect(readTicket("ENG-9999")).toBeUndefined();
  });
});

describe("createTicket", () => {
  it("is a pure function: same input produces the same id", () => {
    const input = { title: "Alerting is noisy", body: "Too many pages at 3am." };
    expect(createTicket(input).id).toBe(createTicket(input).id);
  });

  it("produces different ids for different input", () => {
    const a = createTicket({ title: "A", body: "one" });
    const b = createTicket({ title: "B", body: "two" });
    expect(a.id).not.toBe(b.id);
  });

  it("starts new tickets as Open", () => {
    expect(createTicket({ title: "x", body: "y" }).status).toBe("Open");
  });
});
