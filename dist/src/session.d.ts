/**
 * Session entity table: reversible placeholders for coherent chat.
 *
 * Blanket `[REDACTED]` makes the assistant's replies nonsense. Instead each
 * redacted value gets a stable, typed placeholder (`[GIVEN_NAME_1]`, `[SSN_2]`)
 * that survives across turns: the same raw value always maps to the same token,
 * so the model can reason about "GIVEN_NAME_1" and we {@link rehydrate} the real
 * value back into its reply before display.
 *
 * The map lives only on the client. What leaves the device is placeholdered
 * text; the table never crosses the wire.
 *
 * The one deliberate exception is {@link SessionEntityTable.serialize} /
 * {@link SessionEntityTable.deserialize}, which exist so the table can survive
 * a page reload or app restart. The serialized form contains raw PII — it is
 * exactly as sensitive as the unredacted conversation. Callers MUST
 * encrypt it before persisting with AES-256-GCM (not another scheme),
 * using a fresh IV on every write and a device-only, non-extractable
 * key (for example a WebCrypto key created with `extractable: false`
 * and stored in IndexedDB; never keep the key bytes where a script can
 * read them, such as localStorage). Keep it on the device and never
 * send, sync, or log it. Rampart intentionally does not encrypt: key
 * management belongs to the host app.
 */
import { type PiiLabel, type Span } from "./types";
/** Result of scrubbing one message. */
export interface ScrubResult {
    /** Text with PII replaced by placeholders. Safe to send/log. */
    readonly text: string;
    /** Placeholders introduced or reused in this message. */
    readonly placeholders: readonly string[];
}
/**
 * Optional display aliases for placeholder tokens. By default a GIVEN_NAME span
 * becomes `[GIVEN_NAME_1]`; pass `{ GIVEN_NAME: "NAME" }` to get `[NAME_1]` instead.
 * Only the visible token changes — detection and policy are unaffected.
 */
export type PlaceholderAliases = Partial<Record<PiiLabel, string>>;
/** Token shape minted by the table; also the regex used to find them on the
 * way back. Kept in one place so scrub and rehydrate can never disagree. */
export declare const PLACEHOLDER_PATTERN: RegExp;
/**
 * Every member of PiiLabel, as a runtime list. Derived from ALL_LABELS,
 * a Record<PiiLabel, true> literal with no cast, so this list cannot
 * drift from the union in either direction: adding a member without a
 * case above fails the type check, and removing one shrinks the record
 * until it no longer satisfies its own type.
 */
export declare const PII_LABELS: readonly PiiLabel[];
/**
 * One restored mapping: the raw value behind a placeholder.
 *
 * Warning: `value` is raw, unredacted PII. A serialized table is exactly as
 * sensitive as the unredacted conversation — see
 * {@link SerializedSessionEntityTable}.
 */
export interface SerializedSessionEntry {
    /** Entity class that produced the placeholder. */
    readonly label: PiiLabel;
    /** The original raw value, exactly as first seen by the table. */
    readonly value: string;
    /** The placeholder the value maps to, e.g. `[GIVEN_NAME_1]`. */
    readonly token: string;
}
/**
 * Portable form of a {@link SessionEntityTable}, produced by
 * {@link SessionEntityTable.serializeObject} and consumed by
 * {@link SessionEntityTable.deserialize}.
 *
 * Warning: **This contains raw PII.** The substitution map is the one thing
 * Rampart exists to keep on-device: whoever holds it can undo every
 * placeholder. If it is persisted at all it MUST first be encrypted with
 * AES-256-GCM (not another scheme), using a fresh IV on every write and a
 * device-only, non-extractable key (for example a WebCrypto key created
 * with `extractable: false` and stored in IndexedDB; never keep the key
 * bytes anywhere a script can read them, such as localStorage, and never
 * send, sync, or log the data). Rampart deliberately does not encrypt:
 * key management belongs to the host app, which owns the platform key
 * store.
 *
 * Aliases and keep-labels are configuration, not table state, and are
 * deliberately not stored here; supply the same configuration on restore.
 */
export interface SerializedSessionEntityTable {
    /** Schema version. Only `1` exists; anything else is rejected. */
    readonly version: 1;
    /** Minted mappings, in mint order. */
    readonly entries: readonly SerializedSessionEntry[];
    /**
     * Last issued ordinal per display name, so numbering never restarts.
     * Optional on input: restore re-derives it from entry tokens and only
     * ever moves a counter forward, never backwards.
     */
    readonly counters?: Readonly<Record<string, number>>;
}
/**
 * A per-conversation store mapping raw PII values to stable placeholders.
 * Keyed by `label + normalized value` so "John" stays `GIVEN_NAME_1` on every turn
 * and casing/whitespace noise doesn't mint duplicate tokens.
 */
export declare class SessionEntityTable {
    private readonly aliases;
    private readonly keepLabels;
    private readonly forward;
    private readonly reverse;
    private readonly counters;
    constructor(aliases?: PlaceholderAliases, keepLabels?: ReadonlySet<PiiLabel>);
    /** The visible name used in tokens for a label (alias or the label itself). */
    private displayName;
    /** Get or mint the placeholder for a given label+value. Idempotent. */
    placeholderFor(label: PiiLabel, value: string): string;
    /**
     * Replace each redactable span with its placeholder. Spans are pre-sorted
     * right-to-left by {@link applyPolicy}, so splicing never invalidates an
     * earlier offset.
     */
    scrub(raw: string, spans: readonly Span[]): ScrubResult;
    /**
     * Restore real values in an assistant reply. Used on the *outbound* response
     * so the user sees "John", not "[NAME_1]". Unknown tokens are left intact.
     */
    rehydrate(text: string): string;
    /** True if `token` is a placeholder this table can resolve. */
    knows(token: string): boolean;
    /**
     * Export the table's mappings as a plain object (see
     * {@link SerializedSessionEntityTable} for the handling rules — this
     * contains raw PII). Returns a defensive copy; mutating it does not
     * affect the table.
     */
    serializeObject(): SerializedSessionEntityTable;
    /**
     * Export the table as a JSON string, ready to encrypt and persist on the
     * device. Warning: the string contains raw PII; persist it only in the
     * encrypted form the {@link SerializedSessionEntityTable} warning
     * requires (AES-256-GCM, fresh IV per write, device-only
     * non-extractable key), and never send or log it.
     */
    serialize(): string;
    /**
     * Rebuild a table from {@link serialize} / {@link serializeObject} output,
     * restoring placeholder identity across a page reload or app restart.
     *
     * Validation is fail-closed: any malformation throws and no table is
     * returned, rather than silently producing an empty or partial table that
     * would re-mint already-used ordinals and scramble the conversation.
     *
     * Minted tokens are restored verbatim, so replies written before the
     * restart still rehydrate. New placeholders use the `aliases`/`keepLabels`
     * supplied here, so pass the same configuration the original table used.
     */
    static deserialize(data: string | SerializedSessionEntityTable, aliases?: PlaceholderAliases, keepLabels?: ReadonlySet<PiiLabel>): SessionEntityTable;
}
//# sourceMappingURL=session.d.ts.map