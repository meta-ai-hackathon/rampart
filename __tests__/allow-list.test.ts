import { describe, expect, it } from "vitest";
import { createGuard, type NerDetector } from "../src/guard";
import { dropAllowListed } from "../src/policy";
import type { Span } from "../src/types";

describe("dropAllowListed", () => {
  function span(overrides: Partial<Span> & { start: number; end: number; text: string }): Span {
    return { label: "GIVEN_NAME", score: 1, source: "ner", ...overrides };
  }

  it("passes every span through when the list is omitted or empty", () => {
    const spans = [span({ start: 0, end: 5, text: "Alex" }), span({ start: 6, end: 10, text: "Maya" })];
    expect(dropAllowListed(spans)).toEqual(spans);
    expect(dropAllowListed(spans, [])).toEqual(spans);
  });

  it("drops whole spans whose text equals a list entry, case-insensitively", () => {
    const spans = [
      span({ start: 0, end: 8, text: "Medicare" }),
      span({ start: 9, end: 13, text: "Alex" }),
    ];
    expect(dropAllowListed(spans, ["medicare"]).map((s) => s.text)).toEqual(["Alex"]);
  });

  it("never suppresses a span merely because an entry matches part of it", () => {
    expect(dropAllowListed([span({ start: 0, end: 13, text: "SNAP benefits" })], ["SNAP"])).toEqual([
      span({ start: 0, end: 13, text: "SNAP benefits" }),
    ]);
  });

  it("requires a whole-span match; a longer entry cannot widen suppression", () => {
    expect(dropAllowListed([span({ start: 0, end: 11, text: "Social Sec" })], ["Social Security"])).toEqual([
      span({ start: 0, end: 11, text: "Social Sec" }),
    ]);
  });

  it("trims entries to a case-insensitive key and ignores blank ones", () => {
    expect(dropAllowListed([span({ start: 0, end: 8, text: "CalFresh" })], [" calfresh ", "", "   "])).toEqual([]);
  });

  it("keeps an entry working across all labels that carry the same text", () => {
    const spans = [
      { label: "PHONE", score: 0.9, source: "ner", start: 0, end: 8, text: "Medicare" } as Span,
      span({ start: 9, end: 17, text: "Medicare" }),
    ];
    expect(dropAllowListed(spans, ["Medicare"])).toEqual([]);
  });
});

describe("createGuard allowList", () => {
  it("does not change placeholder behavior without a list", async () => {
    const guard = await createGuard({ heuristicsOnly: true });
    const { text } = await guard.protect("ssn 888-12-3456");
    expect(text).not.toContain("888-12-3456");
  });

  it("keeps a listed finding verbatim while still redacting everything else", async () => {
    const guard = await createGuard({ heuristicsOnly: true, allowList: ["888-12-3456"] });
    const { text } = await guard.protect("ssn 888-12-3456 and 472-81-0094");
    expect(text).toContain("888-12-3456");
    expect(text).toContain("[SSN_1]");
    expect(text).not.toContain("472-81-0094");
    // The allow-listed value was never minted a placeholder to begin with.
    expect(guard.reveal("record [SSN_1]")).toBe("record 472-81-0094");
  });

  it("matches entries case-insensitively against the detected span", async () => {
    const guard = await createGuard({ heuristicsOnly: true, allowList: ["888-12-3456"] });
    const { text } = await guard.protect("SSN 888-12-3456");
    expect(text).toBe("SSN 888-12-3456");
  });

  it("suppresses nothing when an entry is not a whole span", async () => {
    const guard = await createGuard({ heuristicsOnly: true, allowList: ["917-555-01"] });
    const { text } = await guard.protect("ssn 472-81-0094");
    expect(text).not.toContain("472-81-0094");
  });

  it("exempts a case-insensitive NER span and mints it no placeholder", async () => {
    // Stand-in detector finding "Medicare" on the (already premasked) input.
    const ner: NerDetector = async (text) => {
      const at = text.indexOf("Medicare");
      return at < 0
        ? []
        : [{ start: at, end: at + 8, label: "GIVEN_NAME", score: 0.9, source: "ner", text: "Medicare" }];
    };
    const guard = await createGuard({ ner, allowList: ["medicare"] });
    const { text } = await guard.protect("does Medicare cover this?");
    expect(text).toBe("does Medicare cover this?");
    // No placeholder was ever minted: the span is gone before the table scrubs.
    expect(guard.reveal(text)).toBe(text);
    expect(guard.serialize()).not.toContain("Medicare");
  });

  it("redacts that same NER span when no list is given", async () => {
    const ner: NerDetector = async (text) => {
      const at = text.indexOf("Medicare");
      return at < 0
        ? []
        : [{ start: at, end: at + 8, label: "GIVEN_NAME", score: 0.9, source: "ner", text: "Medicare" }];
    };
    const guard = await createGuard({ ner });
    const { text } = await guard.protect("does Medicare cover this?");
    expect(text).toBe("does [GIVEN_NAME_1] cover this?");
  });
});
