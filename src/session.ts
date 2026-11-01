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

import { applyPolicy } from "./policy";
import { KEEP_LABELS, type PiiLabel, type Span } from "./types";

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
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z_]*_\d+\]/g;

/** Anchored form of {@link PLACEHOLDER_PATTERN} for validating a single token. */
const PLACEHOLDER_TOKEN = /^\[[A-Z][A-Z_]*_\d+\]$/;

/** Captures the display name and ordinal of a minted token: `[NAME_12]`. */
const TOKEN_PARTS = /^\[([A-Z][A-Z_]*)_(\d+)\]$/;

/** Every label the table can store, mirrored from {@link PiiLabel} so
 * deserialization can reject unknown labels without trusting the payload. */
const PII_LABELS: ReadonlySet<string> = new Set<string>([
  "SSN", "CREDIT_CARD", "IP_ADDRESS", "GIVEN_NAME", "SURNAME", "EMAIL",
  "PHONE", "URL", "TAX_ID", "BANK_ACCOUNT", "ROUTING_NUMBER",
  "GOVERNMENT_ID", "PASSPORT", "DRIVERS_LICENSE", "BUILDING_NUMBER",
  "STREET_NAME", "SECONDARY_ADDRESS", "CITY", "STATE", "ZIP_CODE",
]);

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
 *  * Warning: **This contains raw PII.** The substitution map is the one thing
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

/** Case/whitespace-insensitive identity of a value within a label. */
function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The forward-map key for a label+value pair. */
function forwardKey(label: PiiLabel, value: string): string {
  return `${label}:${normalizeValue(value)}`;
}

/**
 * Rejection for a malformed serialized table. Reasons never interpolate the
 * payload: it contains raw PII and errors routinely end up in logs.
 */
function invalid(reason: string): Error {
  return new Error(`Invalid serialized session table: ${reason}`);
}

/**
 * A per-conversation store mapping raw PII values to stable placeholders.
 * Keyed by `label + normalized value` so "John" stays `GIVEN_NAME_1` on every turn
 * and casing/whitespace noise doesn't mint duplicate tokens.
 */
export class SessionEntityTable {
  private readonly forward = new Map<string, string>();
  private readonly reverse = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly aliases: PlaceholderAliases = {},
    private readonly keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS,
  ) {}

  /** The visible name used in tokens for a label (alias or the label itself). */
  private displayName(label: PiiLabel): string {
    return this.aliases[label] ?? label;
  }

  /** Get or mint the placeholder for a given label+value. Idempotent. */
  placeholderFor(label: PiiLabel, value: string): string {
    const key = forwardKey(label, value);
    const existing = this.forward.get(key);
    if (existing !== undefined) return existing;
    const name = this.displayName(label);
    const next = (this.counters.get(name) ?? 0) + 1;
    this.counters.set(name, next);
    const token = `[${name}_${next}]`;
    this.forward.set(key, token);
    this.reverse.set(token, value);
    return token;
  }

  /**
   * Replace each redactable span with its placeholder. Spans are pre-sorted
   * right-to-left by {@link applyPolicy}, so splicing never invalidates an
   * earlier offset.
   */
  scrub(raw: string, spans: readonly Span[]): ScrubResult {
    const redactable = applyPolicy(spans, this.keepLabels);
    const placeholders: string[] = [];
    let text = raw;
    for (const span of redactable) {
      const token = this.placeholderFor(span.label, span.text);
      placeholders.push(token);
      text = `${text.slice(0, span.start)}${token}${text.slice(span.end)}`;
    }
    return { text, placeholders: placeholders.reverse() };
  }

  /**
   * Restore real values in an assistant reply. Used on the *outbound* response
   * so the user sees "John", not "[NAME_1]". Unknown tokens are left intact.
   */
  rehydrate(text: string): string {
    return text.replace(PLACEHOLDER_PATTERN, (token) => this.reverse.get(token) ?? token);
  }

  /** True if `token` is a placeholder this table can resolve. */
  knows(token: string): boolean {
    return this.reverse.has(token);
  }

  /**
   * Export the table's mappings as a plain object (see
   * {@link SerializedSessionEntityTable} for the handling rules — this
   * contains raw PII). Returns a defensive copy; mutating it does not
   * affect the table.
   */
  serializeObject(): SerializedSessionEntityTable {
    const entries: SerializedSessionEntry[] = [];
    for (const [key, token] of this.forward) {
      const value = this.reverse.get(token);
      if (value === undefined) continue; // unreachable: maps are written together
      const label = key.slice(0, key.indexOf(":")) as PiiLabel;
      entries.push({ label, value, token });
    }
    return { version: 1, entries, counters: Object.fromEntries(this.counters) };
  }

  /**
   * Export the table as a JSON string, ready to encrypt and persist on the
   * device. Warning: the string contains raw PII; persist it only in the
   * encrypted form the {@link SerializedSessionEntityTable} warning
   * requires (AES-256-GCM, fresh IV per write, device-only
   * non-extractable key), and never send or log it.
   */
  serialize(): string {
    return JSON.stringify(this.serializeObject());
  }

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
  static deserialize(
    data: string | SerializedSessionEntityTable,
    aliases: PlaceholderAliases = {},
    keepLabels: ReadonlySet<PiiLabel> = KEEP_LABELS,
  ): SessionEntityTable {
    let parsed: unknown = data;
    if (typeof data === "string") {
      try {
        parsed = JSON.parse(data);
      } catch {
        throw invalid("malformed JSON");
      }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw invalid("expected an object");
    }
    const form = parsed as { version?: unknown; entries?: unknown; counters?: unknown };
    if (form.version !== 1) throw invalid("unsupported version");
    if (!Array.isArray(form.entries)) throw invalid("entries must be an array");

    const table = new SessionEntityTable(aliases, keepLabels);
    const counters = new Map<string, number>();
    for (const entry of form.entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw invalid("entry must be an object");
      }
      const { label, value, token } = entry as {
        label?: unknown;
        value?: unknown;
        token?: unknown;
      };
      if (typeof label !== "string" || !PII_LABELS.has(label)) {
        throw invalid("entry has an unknown label");
      }
      if (typeof value !== "string" || value.length === 0) {
        throw invalid("entry value must be a non-empty string");
      }
      if (typeof token !== "string" || !PLACEHOLDER_TOKEN.test(token)) {
        throw invalid("entry token is not a placeholder");
      }
      if (table.reverse.has(token)) throw invalid("duplicate token");
      const key = forwardKey(label as PiiLabel, value);
      if (table.forward.has(key)) throw invalid("duplicate value");
      table.forward.set(key, token);
      table.reverse.set(token, value);
      const parts = TOKEN_PARTS.exec(token);
      if (parts !== null) {
        const ordinal = Number(parts[2]);
        if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
          throw invalid("entry token ordinal must be a positive safe integer");
        }
        if (ordinal > (counters.get(parts[1]) ?? 0)) {
          counters.set(parts[1], ordinal);
        }
      }
    }
    if (form.counters !== undefined) {
      if (typeof form.counters !== "object" || form.counters === null || Array.isArray(form.counters)) {
        throw invalid("counters must be an object");
      }
      for (const [name, ordinal] of Object.entries(form.counters as Record<string, unknown>)) {
        if (
          !/^[A-Z][A-Z_]*$/.test(name) ||
          typeof ordinal !== "number" ||
          !Number.isSafeInteger(ordinal) ||
          ordinal < 0
        ) {
          throw invalid("counter must be a non-negative integer");
        }
        // Never move numbering backwards, even if the payload understates it.
        if (ordinal > (counters.get(name) ?? 0)) counters.set(name, ordinal);
      }
    }
    for (const [name, ordinal] of counters) table.counters.set(name, ordinal);
    return table;
  }
}
