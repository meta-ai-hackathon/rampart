/**
 * ChatGuard: per-conversation PII filter for wiring into a chat app.
 *
 *   const guard = await createGuard();
 *   const safe = await guard.protect(userInput);
 *   const reply = await llm(safe.text);
 *   guard.reveal(reply);                    // non-streaming
 *   stream.pipeThrough(guard.revealTransform()); // streaming
 *
 * The entity table lives only on the client; the real values never leave the
 * device. Each guard keeps placeholder identity stable across every turn of a
 * conversation.
 *
 *   user message
 *     → heuristics (sync, structured PII)
 *     → NER (optional, async, contextual PII)
 *     → merge + default-deny policy (keep {city, state, zip})
 *     → session table: replace with stable placeholders
 *   assistant reply
 *     → rehydrate placeholders → render to user
 */
import { type NerOptions } from "./ner/classifier";
import { type PlaceholderAliases, type ScrubResult, type SerializedSessionEntityTable } from "./session";
import { type PiiLabel, type Span } from "./types";
/** An async contextual detector. Matches both the in-process and worker forms. */
export type NerDetector = (text: string) => Promise<Span[]>;
/**
 * Default placeholder aliases. Empty: names are split into GIVEN_NAME/SURNAME
 * and a household may share a surname, so each keeps its own typed token
 * (`[GIVEN_NAME_1]`, `[SURNAME_1]`) rather than collapsing to a single `NAME`.
 */
export declare const DEFAULT_ALIASES: PlaceholderAliases;
export interface GuardOptions {
    /** Placeholder aliases. Defaults to `{}` — typed tokens like `[GIVEN_NAME_1]`. */
    readonly aliases?: PlaceholderAliases;
    /** Labels to preserve; defaults to `{CITY, STATE, ZIP_CODE}`. */
    readonly keepLabels?: readonly PiiLabel[];
    /**
     * Domain terms the app asserts are never PII (same idea as Presidio's
     * `allow_list` and AWS Macie's allow lists): detected spans whose text
     * equals an entry case-insensitively are dropped from detection and left
     * verbatim — benefits program names and similar known false positives.
     * Matching is whole-span, never substring, so the surrounding bytes of a
     * larger finding stay protected; an omitted or empty list changes nothing.
     */
    readonly allowList?: readonly string[];
    /**
     * Labels the allow-list never exempts (default: none). A short entry such as
     * "CHIP" also equals a person's given name; pass the person-name labels
     * (GIVEN_NAME, SURNAME) so a span carrying one of them is always redacted,
     * entry or not. Omitting it keeps raw text-matching behavior.
     */
    readonly allowListSkipLabels?: readonly PiiLabel[];
    /**
     * Restore the session entity table from
     * {@link SessionEntityTable.deserialize} output (`serialize()` /
     * `serializeObject()`) so placeholder identity survives a page reload or
     * app restart.
     *
     * Warning: A serialized table contains raw PII — it is the substitution map
     * Rampart exists to keep on-device. Only ever pass data that was
     * decrypted from on-device storage using the encryption the
     * {@link SerializedSessionEntityTable} warning requires (AES-256-GCM,
     * fresh IV per write, device-only non-extractable key); never fetch it
     * from, or send it to, a server, and never log it. Restore with the
     * same `aliases` / `keepLabels` the original guard used.
     */
    readonly session?: string | SerializedSessionEntityTable;
    /**
     * When `true`, skip the structured-PII premask before the model. Required for
     * a model trained without prefilter (no-prefilter ablation) whose classes
     * include SSN / CREDIT_CARD / IP_ADDRESS. Heuristic spans for those types
     * still run as a safety net.
     */
    readonly noPrefilter?: boolean;
    /** Pre-built NER detector. When set, `model` is ignored. */
    readonly ner?: NerDetector;
    /** When `true`, skip the classifier and run heuristics only. */
    readonly heuristicsOnly?: boolean;
    /**
     * Hugging Face model id or local directory path (q4 ONNX). Defaults to
     * {@link RAMPART_MODEL_ID}.
     */
    readonly model?: string;
    /** Worker script URL. When set, NER runs off the main thread. */
    readonly worker?: string | URL;
    /** Backend. `"wasm"`/`"webgpu"` in browsers; `"cpu"` for Node. */
    readonly device?: NerOptions["device"];
    /** Spans below this score are discarded. */
    readonly minScore?: number;
}
type ChatGuardConfig = Pick<GuardOptions, "ner" | "aliases" | "allowList" | "allowListSkipLabels" | "keepLabels" | "noPrefilter" | "session">;
export declare class ChatGuard {
    private readonly table;
    private readonly ner?;
    private readonly noPrefilter;
    private readonly allowList;
    private readonly allowListSkipLabels;
    constructor(config?: ChatGuardConfig);
    private detect;
    private detectSpans;
    /**
     * Run this on the user's text *before* handing it to the AI SDK. Returns the
     * placeholdered text to send plus the placeholders introduced this turn.
     */
    protect(text: string): Promise<ScrubResult>;
    /** Restore real values in a complete (non-streaming) assistant reply. */
    reveal(reply: string): string;
    /**
     * Export the session entity table (see {@link SessionEntityTable.serialize}).
     * Warning: The result contains raw PII; persist it only in the encrypted
     * form the {@link SerializedSessionEntityTable} warning requires
     * (AES-256-GCM with a fresh IV per write, device-only non-extractable
     * key), keep it on the device, and never send or log it. Restore by
     * passing it as `session` to {@link createGuard}
     */
    serialize(): string;
    /**
     * Object form of {@link serialize}. Same handling rules apply: it
     * contains raw PII and must be encrypted (AES-256-GCM, fresh IV per
     * write, device-only non-extractable key) before it is stored anywhere.
     */
    serializeObject(): SerializedSessionEntityTable;
    /**
     * A Web Streams transform that reveals placeholders in a streamed reply,
     * correctly handling placeholders split across chunks. Pipe an AI SDK
     * `textStream` through it before rendering.
     */
    revealTransform(): TransformStream<string, string>;
    /**
     * Defense in depth: scrub the model's *output* before logging/persisting it,
     * since a model can emit PII the user never typed. Returns placeholdered text.
     */
    protectReply(reply: string): Promise<ScrubResult>;
}
/**
 * Build a conversation guard. Loads the Rampart classifier (q4 ONNX) by default.
 * Pass `model` for a different Hugging Face id or local path, `heuristicsOnly:
 * true` to skip NER, or `ner` to inject a custom detector.
 */
export declare function createGuard(options?: GuardOptions): Promise<ChatGuard>;
export {};
//# sourceMappingURL=guard.d.ts.map