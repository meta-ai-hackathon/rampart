import { describe, expect, it } from "vitest";
import { createGuard } from "../src/guard";
import { SessionEntityTable } from "../src/session";

describe("SessionEntityTable serialize/deserialize", () => {
  it("round-trips an empty table", () => {
    const restored = SessionEntityTable.deserialize(new SessionEntityTable().serialize());
    expect(restored.serializeObject()).toEqual({ version: 1, entries: [], counters: {} });
    expect(restored.placeholderFor("GIVEN_NAME", "Alex")).toBe("[GIVEN_NAME_1]");
  });

  it("preserves token stability for repeat values, incl. case/whitespace variants", () => {
    const table = new SessionEntityTable();
    expect(table.placeholderFor("GIVEN_NAME", "Maria")).toBe("[GIVEN_NAME_1]");
    expect(table.placeholderFor("SURNAME", "Garcia")).toBe("[SURNAME_1]");
    const restored = SessionEntityTable.deserialize(table.serialize());
    expect(restored.placeholderFor("GIVEN_NAME", "  MARIA ")).toBe("[GIVEN_NAME_1]");
    expect(restored.placeholderFor("SURNAME", "garcia")).toBe("[SURNAME_1]");
  });

  it("rehydrates after restore; unknown tokens left intact", () => {
    const table = new SessionEntityTable();
    table.placeholderFor("GIVEN_NAME", "Maria");
    const restored = SessionEntityTable.deserialize(table.serialize());
    expect(restored.rehydrate("Hi [GIVEN_NAME_1], ref [SSN_9]")).toBe("Hi Maria, ref [SSN_9]");
    expect(restored.knows("[GIVEN_NAME_1]")).toBe(true);
    expect(restored.knows("[SSN_9]")).toBe(false);
  });

  it("continues counters without ordinal collision", () => {
    const table = new SessionEntityTable();
    table.placeholderFor("GIVEN_NAME", "Maria");
    const restored = SessionEntityTable.deserialize(table.serialize());
    expect(restored.placeholderFor("GIVEN_NAME", "James")).toBe("[GIVEN_NAME_2]");
  });

  it("does not corrupt [GIVEN_NAME_10] via [GIVEN_NAME_1] after restore", () => {
    const table = new SessionEntityTable();
    for (let i = 1; i <= 10; i++) table.placeholderFor("GIVEN_NAME", `Person${i}`);
    const restored = SessionEntityTable.deserialize(table.serialize());
    expect(restored.rehydrate("[GIVEN_NAME_10] and [GIVEN_NAME_1]")).toBe("Person10 and Person1");
    expect(restored.placeholderFor("GIVEN_NAME", "New")).toBe("[GIVEN_NAME_11]");
  });

  it("never moves counters backwards even if payload understates them", () => {
    const obj = { version: 1 as const, entries: [{ label: "GIVEN_NAME" as const, value: "Maria", token: "[GIVEN_NAME_5]" }], counters: { GIVEN_NAME: 1 } };
    const restored = SessionEntityTable.deserialize(obj);
    expect(restored.placeholderFor("GIVEN_NAME", "James")).toBe("[GIVEN_NAME_6]");
  });

  it("round-trips aliased tokens when same aliases supplied on restore", () => {
    const table = new SessionEntityTable({ GIVEN_NAME: "NAME" });
    expect(table.placeholderFor("GIVEN_NAME", "Alex")).toBe("[NAME_1]");
    const restored = SessionEntityTable.deserialize(table.serialize(), { GIVEN_NAME: "NAME" });
    expect(restored.placeholderFor("GIVEN_NAME", "alex")).toBe("[NAME_1]");
    expect(restored.placeholderFor("GIVEN_NAME", "Maya")).toBe("[NAME_2]");
    expect(restored.rehydrate("[NAME_1] called")).toBe("Alex called");
  });

  it("serializeObject returns a defensive copy", () => {
    const table = new SessionEntityTable();
    table.placeholderFor("GIVEN_NAME", "Maria");
    const obj = table.serializeObject();
    (obj.entries as unknown as { value: string }[])[0].value = "Tampered";
    expect(table.rehydrate("[GIVEN_NAME_1]")).toBe("Maria");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["wrong version", JSON.stringify({ version: 2, entries: [] })],
    ["entries not array", JSON.stringify({ version: 1, entries: {} })],
    ["unknown label", JSON.stringify({ version: 1, entries: [{ label: "NOPE", value: "x", token: "[NOPE_1]" }] })],
    ["empty value", JSON.stringify({ version: 1, entries: [{ label: "EMAIL", value: "", token: "[EMAIL_1]" }] })],
    ["bad token shape", JSON.stringify({ version: 1, entries: [{ label: "EMAIL", value: "a@b.c", token: "EMAIL_1" }] })],
    ["duplicate token", JSON.stringify({ version: 1, entries: [
      { label: "EMAIL", value: "a@b.c", token: "[EMAIL_1]" },
      { label: "EMAIL", value: "d@e.f", token: "[EMAIL_1]" },
    ] })],
    ["duplicate value (normalized)", JSON.stringify({ version: 1, entries: [
      { label: "EMAIL", value: "A@b.c", token: "[EMAIL_1]" },
      { label: "EMAIL", value: "a@B.c", token: "[EMAIL_2]" },
    ] })],
    ["bad counter", JSON.stringify({ version: 1, entries: [], counters: { EMAIL: -1 } })],
    ["root not an object", JSON.stringify(42)],
    ["entry not an object", JSON.stringify({ version: 1, entries: ["nope"] })],
    ["counters not an object", JSON.stringify({ version: 1, entries: [], counters: [] })],
    ["fractional counter", JSON.stringify({ version: 1, entries: [], counters: { EMAIL: 1.5 } })],
    ["counter name with digits", JSON.stringify({ version: 1, entries: [], counters: { EMAIL2: 1 } })],
    ["zero ordinal", JSON.stringify({ version: 1, entries: [{ label: "EMAIL", value: "a@b.c", token: "[EMAIL_0]" }] })],
    ["huge ordinal", JSON.stringify({ version: 1, entries: [{ label: "EMAIL", value: "a@b.c", token: "[EMAIL_999999999999999999999999999999]" }] })],
  ])("throws on %s", (_name, payload) => {
    expect(() => SessionEntityTable.deserialize(payload)).toThrow(/Invalid serialized session table/);
  });

  it("error messages never interpolate the payload", () => {
    const secret = "maria.garcia@example.com";
    const payload = JSON.stringify({ version: 1, entries: [{ label: "EMAIL", value: secret, token: "bad" }] });
    let err; // captured outside the assertion flow so expect.unreachable cannot
    const threw = (() => { try { SessionEntityTable.deserialize(payload); return false; } catch (e) { err = e; return true; } })();
    expect(threw, "deserialize() should reject the malformed payload").toBe(true);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(secret);
  });
});

describe("ChatGuard session restore", () => {
  it("serialize() -> new guard via session -> reveal() works", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    await guard.protect("my ssn is 472-81-0094");
    const saved = guard.serialize();
    const restored = await createGuard({ heuristicsOnly: true, session: saved });
    expect(restored.reveal("Your record [SSN_1] is updated.")).toBe("Your record 472-81-0094 is updated.");
    // Stability across the restart: same value reuses the same token.
    const { text } = await restored.protect("again, ssn 472-81-0094");
    expect(text).toContain("[SSN_1]");
  });

  it("accepts serializeObject() form for session", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    await guard.protect("my ssn is 472-81-0094");
    const restored = await createGuard({ heuristicsOnly: true, session: guard.serializeObject() });
    expect(restored.reveal("[SSN_1]")).toBe("472-81-0094");
  });

  it("fails closed on a malformed session instead of starting empty", async () => {
    await expect(createGuard({ heuristicsOnly: true, session: "{oops" })).rejects.toThrow(/Invalid serialized session table/);
  });
});
