# Manual smoke test

Not automated, not run in CI. Unit tests cover logic in isolation (arg validation, the decision
loop, memory persistence, chat filtering); this checklist covers the things that only a real
Minecraft server/realm and a real LLM API key can verify: does the bot actually connect, and does
a skill survive real, messy terrain.

Run against a local test server first (a throwaway Paper/vanilla server is fine), then once against
the real realm before considering a change "ready for live gameplay."

## Setup

1. Copy `.env.example` to `.env` and fill in real values (`BOT_USERNAME`, `MINECRAFT_VERSION`
   matching the server, `CONNECTION_MODE`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).
2. `npm run build && npm start` (or `npm run dev` while iterating).
3. On first run, the console prints a Microsoft device-code URL + code — sign in with the bot's
   account in a browser. This is a one-time step; the token is cached under
   `MS_AUTH_PROFILES_FOLDER` afterward.

## Checklist

- [ ] Bot connects and reaches `spawn` (log line: `bot spawned and ready`).
- [ ] `<mention> status` replies without any LLM call happening (check logs for no `createTurn`
      activity) — confirms built-in commands bypass the model.
- [ ] `<mention> stop` while idle replies `Stopped.` without error.
- [ ] `<mention> come here` (as `goToPlayer`) — bot paths to the sender and confirms in chat.
- [ ] `<mention> chop some wood` (as `collectBlock`) — bot mines and picks up logs, confirms count.
- [ ] `<mention> attack that zombie` near a mob (as `attackNearest`) — bot engages and reports the
      outcome.
- [ ] `<mention> craft a stick` with no crafting table nearby and no table in inventory — bot
      replies that it can't, rather than hanging.
- [ ] `<mention> craft a crafting table` then `<mention> craft 4 sticks` with a table now placed —
      succeeds.
- [ ] Kill/restart the server (or disconnect networking) while the bot is mid-`goToPlayer` —
      confirm it logs a disconnect, reconnects with backoff once the server is back, and does
      **not** silently resume the old pathfinding goal (check the next `status` reply shows the
      task as `interrupted`, not silently retried).
- [ ] Send two triggering messages back-to-back from different players while the bot is busy —
      confirm the second gets a "still working on X — say stop" reply instead of being dropped or
      silently canceling the first.
- [ ] Say "stop" mid-task — confirm the active skill actually halts (bot stops moving/mining/
      attacking within a couple seconds), not just that the chat reply says "Stopped."
- [ ] Repeat the full checklist once with `LLM_PROVIDER=openai` if that provider is in use, since
      the two providers are only unit-tested through the shared normalized interface, not against
      each other's live API quirks.
