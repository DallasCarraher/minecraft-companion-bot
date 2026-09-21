# Minecraft Companion Bot

An LLM-controlled Minecraft player that joins your realm as a bot, listens to your chat, and carries out tasks — mining, building, following, fighting, fetching items — based on natural-language instructions.

## Status

Implemented and ready to iterate on against a real realm. Core loop (chat -> LLM decision tick ->
skill execution -> memory -> reply), skills library, dual LLM provider support, and reconnect
handling are all in place. See [`docs/architecture.md`](docs/architecture.md) for the system
design this was built against.

## Concept

The bot connects to a Minecraft Java Edition realm as a real player account via [Mineflayer](https://github.com/PrismarineJS/mineflayer). A [Bun](https://bun.sh) process wraps that connection with a library of "skills" (pathfinding, mining, crafting, combat) and an LLM brain that decides which skill to invoke based on your chat messages and the bot's current view of the world. This approach follows the pattern established by the open-source [Mindcraft](https://github.com/kolbytn/mindcraft) project, though this codebase is a from-scratch implementation on raw Mineflayer rather than a fork.

## Requirements

- A Minecraft Java Edition realm (or a self-hosted server for local testing)
- A second Microsoft/Minecraft account for the bot, invited to the realm
- [Bun](https://bun.sh) 1.4+ (runs the TypeScript source directly — no separate build step)
- An API key for the chosen LLM provider (Anthropic and/or OpenAI)

## Getting started

```bash
bun install
cp .env.example .env   # fill in BOT_USERNAME, CONNECTION_MODE, realm/server details, API key(s)
bun run check-env      # validates .env without connecting
bun run dev            # or: bun run start
```

On first run, the console prints a Microsoft device-code URL and code — sign in with the bot's
account in a browser. This is a one-time step; the token is cached under
`MS_AUTH_PROFILES_FOLDER` (gitignored) and reused silently afterward.

Once connected, mention the bot by username in chat (or use `CHAT_TRIGGER_PREFIX`/`CHAT_TRIGGER_MODE`
to change how it's addressed) — e.g. `TestBot come here`, `TestBot chop some wood`, `TestBot stop`.

Before trusting a change against a live realm, run through
[`tests/smoke/SMOKE_TEST.md`](tests/smoke/SMOKE_TEST.md) — the automated tests cover logic in
isolation, but connecting, pathfinding, and mining on real terrain can only be verified live.

## Development

```bash
bun run typecheck:all   # type-checks src/ and tests/ (bun runs TS directly but doesn't type-check it)
bun run lint            # oxlint
bun run format          # oxfmt --write (bun run format:check for CI-style verification)
bun test                # vitest, run via bun
```

Tooling is deliberately npm/Node-free: [Bun](https://bun.sh) as the runtime and package manager
(`bun.lock` is the committed lockfile), [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for
linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for formatting — both part of
the [oxc](https://oxc.rs) toolchain, in place of ESLint/Prettier. `tsc` is still used, but only for
type-checking (`noEmit: true` everywhere); nothing is compiled to a `dist/` — Bun runs `src/`
directly in both dev and production.

## Documentation

- [Architecture](docs/architecture.md) — components, diagrams, and the request/response loop
- [Model options](docs/model-options.md) — comparison of LLM backends for the decision loop, evaluated for cost and tool-calling reliability
- [pc-26.3 upstream patches](docs/pc-26.3-upstream-patches.md) — temporary: tracks the yalc-linked local forks this project currently depends on to run against Minecraft 26.3, and the upstream PRs that will make them unnecessary. Delete once those land.

Module boundaries and the tradeoffs behind them (e.g. why the decision loop is provider-agnostic, why crash recovery abandons rather than resumes in-flight skills) are documented as comments at the top of the relevant files in `src/`, not in a separate design doc.

## License

MIT
