# AGENTS.md — meta-ai-hackathon/rampart (maintained fork)

This is the **meta-ai-hackathon fork** of Rampart, maintained for the hackathon.
It is not the upstream `nationaldesignstudio/rampart` repo.

## Fork policy

- The fork-only feature is opt-in session persistence:
  `SessionEntityTable.serialize()` / `serializeObject()`,
  fail-closed `SessionEntityTable.deserialize(...)`, `ChatGuard.serialize()` /
  `serializeObject()`, and restore via `GuardOptions.session` in `createGuard`.
- **Never propose or open an upstream PR for `serialize()` / `deserialize()`.**
  The serialized form exports the raw token-to-PII map; upstream would
  predictably reject it for misuse potential. This stays fork-only.
- Serialized session data is raw PII, and everything around persisting it —
  what the caller (e.g. `meta-hack`) must do before writing it anywhere, what
  may appear in an error message, and exactly what `deserialize` must reject
  and accept — is governed by [`.github/claude-review/rules.md`](.github/claude-review/rules.md),
  whose P1 list is the authoritative statement of these requirements. This
  file's other mentions of them (e.g. the fork-only bullet above) are context
  only, and rules.md wins whenever they disagree.
- `.github/workflows/release.yml` is inert in this fork by design
  (`if: github.repository == 'nationaldesignstudio/rampart'`). Do not
  "fix" that guard without an explicit decision to publish from the fork.
- Do not casually rename the package (`@nationaldesignstudio/rampart`) or
  `RAMPART_MODEL_ID` in `src/ner/classifier.ts` — the latter is the runtime
  Hugging Face model id and renaming it breaks model loading.

## Commands (bun)

- Install: `bun install --frozen-lockfile`
- Tests: `npx vitest run` (the `test` script; note `verify:public` uses `bun test`)
- Type-check: `bun run type-check`
- Full public verification: `bun run verify:public`
  (build + test + type-check + strict public eval + Hugging Face export verify)

Gotcha: do **not** run bare `npx tsc` — it can fetch the wrong package.
Always use `bun run type-check`.

## Quality gates

- Never bypass checks (`--no-verify`, skipping or weakening tests/CI to go green).
- `main` is PR-only and CI-green; keep the existing CI check passing.
- Never hand-edit lockfiles; new dependencies must be pinned, with a rationale.
- Secrets only via environment / GitHub secrets — never committed or logged.
- Small, logical commits; stay in the scope of the issue you are working on.
