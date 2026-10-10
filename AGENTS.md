# AGENTS.md

## Debugging a running bot

Every `bun run dev` run appends its logs to [logs/dev.log](logs/dev.log) (gitignored), in
addition to the pretty-printed console output — see [src/logger/logger.ts](src/logger/logger.ts).
The file includes whatever level `LOG_LEVEL` is set to, so run with `LOG_LEVEL=debug` to get
decision-loop and skill-dispatch detail in it.

When debugging a crafting/skill/reflex issue, **read `logs/dev.log` directly** (it accumulates
across runs, newest at the bottom) instead of asking the user to paste terminal output.

## Local yalc forks — do not run a bare `bun install`

`mineflayer`, `minecraft-protocol`, `minecraft-data`, `prismarine-chunk`, and `prismarine-physics`
are yalc-linked to local, hand-patched forks under `.yalc/` (gitignored) to work around Minecraft
26.3 protocol bugs that aren't upstream yet. `package.json` points at them via `file:.yalc/...`
plus `overrides`. A plain `bun install` (or any command that touches `node_modules` without
re-running `yalc push` from the fork) silently reverts to the unpatched registry versions and
brings back the crashes those patches fixed — there is no other record of this than
[docs/pc-26.3-upstream-patches.md](docs/pc-26.3-upstream-patches.md). Before touching dependency
install/update commands, read that file. If you hit a protocol/data bug against 26.3 that looks
new, check that file first — it's probably already tracked (or is the next one to add, using the
same `docs: track ... bug (#N)` commit convention visible in `git log`).

## Testing conventions

- `bun test` (or `vitest run`) drives unit tests under `tests/unit/`; there's no browser or live
  connection involved — `tests/fakes/fakeBot.ts` provides a minimal `EventEmitter`-based fake
  `mineflayer` `Bot`, stubbing only the surface individual modules actually touch (not a full
  `Bot` — extend it rather than reaching for a real one).
- Nothing here talks to a real Minecraft server or LLM API. For that,
  [tests/smoke/SMOKE_TEST.md](tests/smoke/SMOKE_TEST.md) is a manual checklist to run against a
  local test server (and then the real realm) before treating a change as safe for live gameplay —
  run through it yourself when you can, and otherwise say explicitly that a change is
  unit-tested-only, not live-verified.
- `bun run typecheck:all` type-checks both `src/` and `tests/` (plain `bun run dev`/`start` do not
  type-check, since Bun runs TypeScript directly).
- Before starting the bot for real, `bun run check-env` validates `.env` without connecting.

## Design rationale lives in the code, not in docs

Module boundaries and non-obvious tradeoffs (e.g. why the decision loop is provider-agnostic, why
crash recovery abandons rather than resumes in-flight skills) are documented as comments at the
top of the relevant files in `src/`, not in a separate design doc. Check there before asking the
user why something is structured a certain way.
