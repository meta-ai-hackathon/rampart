/**
 * Span reconciliation + default-deny policy.
 *
 * Detectors (heuristic + NER) emit overlapping, possibly conflicting spans.
 * {@link mergeSpans} resolves them into a non-overlapping set, then
 * {@link applyPolicy} drops anything in the keep-set so only redactable spans
 * remain. This is Option A: redact detected entities whose label is not kept.
 */
import { type PiiLabel, type Span } from "./types";
/**
 * Reduce overlapping spans to a disjoint set. When two spans overlap, the
 * higher-confidence one wins; ties break toward the longer span, then toward
 * heuristics (validator-backed, so most trustworthy). Biased to *keep* a
 * redaction rather than drop one — recall over precision, per the threat model.
 *
 * On partial overlap (neither span contains the other) the previous span
 * covers bytes the winner does not. Taking only the winner exposes those
 * bytes; we take the byte-union under the preferred label so no detected
 * bytes are silently dropped. Full containment still collapses to the winner.
 */
export declare function mergeSpans(spans: readonly Span[]): Span[];
/**
 * Apply the keep-set. Returns only spans that must be redacted, sorted right to
 * left so callers can splice from the end and keep earlier offsets valid.
 */
export declare function applyPolicy(spans: readonly Span[], keepLabels?: ReadonlySet<PiiLabel>): Span[];
/**
 * Drop spans covered by a caller allow-list — see Presidio's `allow_list` and
 * its equivalents — i.e.
 * domain terms the app asserts are never PII (benefits program names and
 * similar false positives). Matching is whole-span: a span is suppressed only
 * when its text equals a list entry case-insensitively (entries are trimmed).
 * Since the list itself comes from the calling app, this can never silently
 * weaken the default-deny policy — an omitted or empty list changes nothing.
 *
 * `skipLabels` is the labels the list never exempts. A short entry such as
 * "CHIP" also matches a person's given name, and this function does not know
 * a name from a program: without a skip set, a detected "Chip" (GIVEN_NAME)
 * whose text equals "CHIP" would go out verbatim, past the redaction the
 * whole guard exists to enforce. A caller that allows such terms should pass
 * the person-name labels here (GIVEN_NAME, SURNAME) so a span carrying one of
 * them is always redacted, entry or not.

 * Match whole spans, never substrings: an entry matched inside a larger span
 * would let the surrounding bytes (possibly real PII) through, against
 * Presidio's "whole finding is dropped" semantics and AWS Macie's
 * "text that exactly matches an entry" definition.
 */
export declare function dropAllowListed(spans: readonly Span[], allowList?: readonly string[], skipLabels?: ReadonlySet<PiiLabel>): Span[];
//# sourceMappingURL=policy.d.ts.map