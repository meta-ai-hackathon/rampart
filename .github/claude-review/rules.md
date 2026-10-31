# Claude review rules for rampart

The Claude review bot (`scripts/claude_review.py`) sends this file to the model on every push to a pull request, together with `AGENTS.md` when the base branch has one. It always reads both from the base branch, so a change to this file takes effect once it merges to `main`, never inside the PR that makes it.

## What this repo is

Rampart is a PII redaction library that runs on the device. `createGuard()` in `src/guard.ts` returns a `ChatGuard` that finds personal data with the deterministic layer (`src/heuristics.ts` and `src/validators.ts`) and the ONNX token classifier (`src/ner/`). Under the default deny policy in `src/policy.ts`, every value it finds becomes a placeholder unless its label is in `KEEP_LABELS` (`src/types.ts`). The `SessionEntityTable` in `src/session.ts` maps each placeholder back to its raw value so `reveal()` can restore the assistant's reply, and that table never leaves the device.

This repo is a fork of `nationaldesignstudio/rampart` that we maintain only for the hackathon. The fork adds `serialize()`, `serializeObject()` and `deserialize()` to `SessionEntityTable`, along with `ChatGuard.serialize()`, `ChatGuard.serializeObject()` and the `session` option of `createGuard()`, so an app can save the table on the device and restore it after a reload. The serialized form (`SerializedSessionEntityTable`) holds every raw value the table has seen, so it is exactly as sensitive as the conversation before redaction.

## Severities

### P1, must fix before merge

A P1 fails the `claude-review` check. Use P1 only when the change does one of these things.

* It lets serialized session data go somewhere it must not. The output of `serialize()` or `serializeObject()` is raw PII, so no code logs or prints it, sends it off the device, or puts it in an error message, and no serialized table from a real session is ever committed, whether in a fixture, a snapshot, an example or a code comment. The same goes for anything taken from it, such as the `entries` list or one entry's `value`. A test that builds its table from fake values is fine, as the last section says.
* It persists serialized data without encrypting it on the device first. Rampart does not encrypt on purpose, because key management belongs to the app, so whoever calls `serialize()` has to encrypt the result with AES-256-GCM before writing it anywhere, including localStorage, IndexedDB, a file or a cache. The key exists only on the device and every write gets a fresh IV. A doc or an example that writes the plain JSON to storage, uses another cipher, hard codes the key, or keeps the key where a script can read its bytes back, such as exported key bytes in localStorage, is a P1. A WebCrypto key created with `extractable: false` and kept in IndexedDB is fine.
* It puts payload or session contents in an error message. An error anywhere in the library never includes user text, a span's text, a value from the table, or any part of a serialized payload, such as a value, a token, a label or a counter name. `deserialize()` keeps the `Invalid serialized session table: <reason>` shape with fixed reasons, because errors end up in logs.
* It makes `deserialize()` stop failing closed. Malformed input has to throw and return no table, and `createGuard()` with a bad `session` has to reject instead of starting with an empty table. That means checking the JSON and the object shape, accepting only `version` 1, checking every entry's label against `PII_LABELS`, requiring a value that is a string and not empty, requiring a token that matches the placeholder pattern, rejecting a duplicate token or a duplicate value after the same normalization `placeholderFor()` uses, and accepting only placeholder names mapped to whole numbers of zero or more in `counters`. Counters never move backwards, so the restored counter for a name is never lower than the highest ordinal in the entry tokens or the counter in the payload. Skipping a bad entry, falling back to an empty or partial table, or letting numbering restart is a P1.
* It proposes `serialize()` or `deserialize()` for upstream. Nothing in this repo opens, drafts or scripts a pull request to `nationaldesignstudio/rampart`, and no doc, comment or PR description suggests sending this work there. The same goes for anything that would publish the fork under the upstream names, such as removing the `github.repository == 'nationaldesignstudio/rampart'` guards in `.github/workflows/release.yml`.
* It sends raw PII off the device in any other way. Library code (`index.ts` and `src/`) never sends user text, a span's text or a value from the table over the network, to a log or the console, or into analytics. A change to `KEEP_LABELS`, `applyPolicy()` or `mergeSpans()` that lets through by default a value that used to be redacted is a P1 too.
* It exposes a secret, such as a key or token that is committed, printed by a workflow, or put in a prompt. The release workflow uses `NPM_TOKEN` and `HF_TOKEN`, and the review workflow uses `ANTHROPIC_REVIEW_KEY`.
* It weakens this reviewer. The review workflow holds the review key, so making `.github/workflows/claude-review.yml` check out, install or run anything from the PR head is a P1. So is moving it off `pull_request_target`, adding a skip beyond the fork check, or giving it more than `contents: read` and `pull-requests: write`. Weakening `scripts/claude_review.py` or this file counts too.
* It would break `main`, meaning it fails `bun run verify:public` in CI, which builds the package, runs the tests and the strict type check, and runs `eval:public:strict` and the Hugging Face export check.

### P2, should fix soon

These are real bugs and risks that do not need to block the merge.

* Library code makes a new network call at runtime. Today the only network traffic Rampart starts is transformers.js downloading the model weights from Hugging Face, and apps can point it at a local copy instead. That download never carries user text. A new call that carries no PII is still a P2, since apps choose this library because nothing leaves the device, and one that carries PII is a P1.
* Library code adds telemetry, analytics or console output. Anything that records inputs, outputs, spans or table contents is a P1, so this covers the rest, such as timings and counts.
* A test is loosened so it passes, for example an expected value changed to match new output with no reason given, a case removed, a test skipped, or a tolerance widened. When the test checks that PII is redacted, that the serialized table round trips, or that `deserialize()` rejects bad input (`__tests__/session-serialize.test.ts`), or when the change lowers the floors in `eval/run-public-eval.ts`, it is a P1, because that is how a leak ships without anyone noticing.
* A detector change in `src/heuristics.ts`, `src/validators.ts` or `src/ner/` could stop catching a form of PII it caught before, and no test shows that it still does.
* `PiiLabel` in `src/types.ts` changes without the same change to `PII_LABELS` in `src/session.ts`, so `deserialize()` would reject tables that hold the new label.
* New logic has no test, an edge case gives a wrong result, or a new dependency has no pinned version or stated reason.
* Docs now say the wrong thing, such as README numbers that no longer match the code, or a new doc comment on serialized data that leaves out how to handle it.

### P3, nit

P3 is for naming, small cleanups and suggestions, so keep these few. This repo has no linter or formatter, so do not report formatting at all.

## What not to flag

* The tests and eval cases are full of fake SSNs, card numbers, phone numbers and emails, because they test the detectors, and the bot redacts those values before you see them. A `[REDACTED ...]` marker in `__tests__/` or `eval/` is expected and is not a finding by itself. A serialized table in a test is fine when the test builds it from fake values the way `__tests__/session-serialize.test.ts` does, and one that looks captured from a real session is a P1.
* Do not flag files the bot did not send (lockfiles such as `bun.lock`, binaries, generated assets, data files, secret files, files over the budget), beyond saying they were not reviewed. The files under `model/` that `.gitattributes` keeps in Git LFS show up as pointer files, so their diff is only an oid and a size.
* Do not flag the writing style of `WHITEPAPER.md`, `MODEL_CARD.md` or `latex/`.
* Do not flag hypothetical problems with no path through the changed code.
