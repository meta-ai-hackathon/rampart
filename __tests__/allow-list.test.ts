import { describe, expect, it } from "vitest";
import { createGuard, type NerDetector } from "../src/guard";
import { dropAllowListed } from "../src/policy";
import { PII_LABELS } from "../src/session";
import type { PiiLabel, Span } from "../src/types";

/**
 * The label list under test is PII_LABELS from session.ts, which is
 * derived from ALL_LABELS there — a Record<PiiLabel, true> object
 * literal with no cast. That literal is the compile-time check the
 * tests below rely on: a PiiLabel member added without a case in
 * session.ts fails the build, and this file cannot shrink the list
 * behind the tests' coverage because they no longer own a copy.
 */
describe("PII_LABELS", () => {
  it("has no duplicates", () => {
    expect(new Set(PII_LABELS).size).toBe(PII_LABELS.length);
  });
});

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

describe("dropAllowListed skipLabels", () => {
  function span(overrides: Partial<Span> & { start: number; end: number; text: string }): Span {
    return { label: "GIVEN_NAME", score: 1, source: "ner", ...overrides };
  }

  it("keeps a person-name span whose text equals an entry when its label is excluded", () => {
    // "my son Chip": Rampart finds "Chip" as GIVEN_NAME and the entry "CHIP"
    // equals its text. Without the skip set the exemption would necessarily
    // also pass the name through, so the caller excludes person-name labels.
    const spans = [
      span({ start: 7, end: 11, text: "Chip" }),
      { label: "TAX_ID", score: 1, source: "ner", start: 15, end: 19, text: "CHIP" } as Span,
    ];
    const out = dropAllowListed(spans, ["CHIP"], new Set<PiiLabel>(["GIVEN_NAME", "SURNAME"]));
    expect(out.map((s) => s.text)).toEqual(["Chip"]);
  });

  it("exempts every label text-match when no label is excluded (default unchanged)", () => {
    const spans = [...PII_LABELS].map((label, i) =>
      ({ label, score: 1, source: "ner", start: i * 4, end: i * 4 + 4, text: "CHIP" } as Span),
    );
    expect(dropAllowListed(spans, ["chip"])).toEqual([]);
  });

  it("keeps only the excluded labels' spans, across every label", () => {
    const skips = new Set<PiiLabel>(["GIVEN_NAME", "SURNAME"]);
    const spans = [...PII_LABELS].map((label, i) =>
      ({ label, score: 1, source: "ner", start: i * 4, end: i * 4 + 4, text: "CHIP" } as Span),
    );
    const out = dropAllowListed(spans, ["CHIP"], skips);
    expect(out.map((s) => s.label).sort()).toEqual(["GIVEN_NAME", "SURNAME"]);
  });
});

describe("createGuard allowListSkipLabels", () => {
  function nerFindingChip(): NerDetector {
    return async (text) => {
      const finds: Awaited<ReturnType<NerDetector>> = [];
      const person = text.indexOf("Chip");
      if (person >= 0) {
        finds.push({ start: person, end: person + 4, label: "GIVEN_NAME", score: 0.9, source: "ner", text: "Chip" });
      }
      // The literal program mention too, tagged as a non-name label.
      const program = text.indexOf("CHIP");
      if (program >= 0) {
        finds.push({ start: program, end: program + 4, label: "TAX_ID", score: 0.9, source: "ner", text: "CHIP" });
      }
      return finds;
    };
  }

  it("redacts a person-name span that matches an allow-list entry when its label is excluded", async () => {
    const guard = await createGuard({
      ner: nerFindingChip(),
      allowList: ["CHIP"],
      allowListSkipLabels: ["GIVEN_NAME", "SURNAME"],
    });
    const { text } = await guard.protect("my son Chip wants CHIP");
    expect(text).toContain("[GIVEN_NAME_1]");
    expect(text).not.toContain("Chip");
    // The entry still exempts the program span the detector tags with
    // another label (TAX_ID here): that non-excluded span passes through
    // verbatim.
    expect(text).toContain("wants CHIP");
    expect(guard.reveal(text)).toContain("Chip");
    expect(guard.serialize()).toContain("Chip");
  });

  it("exempts the same span without a skip set (previous behavior)", async () => {
    const guard = await createGuard({ ner: nerFindingChip(), allowList: ["CHIP"] });
    const { text } = await guard.protect("my son Chip");
    expect(text).toBe("my son Chip");
    expect(guard.reveal(text)).toBe("my son Chip");
  });
});
