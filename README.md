# Minecraft Companion Bot

An LLM-controlled Minecraft player that joins your realm as a bot, listens to your chat, and carries out tasks — mining, building, following, fighting, fetching items — based on natural-language instructions.

## Status

Early planning. Documentation and architecture are being laid down before implementation starts. See [`docs/architecture.md`](docs/architecture.md) for the system design.

## Concept

The bot connects to a Minecraft Java Edition realm as a real player account via [Mineflayer](https://github.com/PrismarineJS/mineflayer). A Node.js process wraps that connection with a library of "skills" (pathfinding, mining, crafting, combat) and an LLM brain that decides which skill to invoke based on your chat messages and the bot's current view of the world. This approach follows the pattern established by the open-source [Mindcraft](https://github.com/kolbytn/mindcraft) project.

## Requirements

- A Minecraft Java Edition realm
- A second Microsoft/Minecraft account for the bot, invited to the realm
- Node.js
- An API key for the chosen LLM provider

## Documentation

- [Architecture](docs/architecture.md) — components, diagrams, and the request/response loop
- [Model options](docs/model-options.md) — comparison of LLM backends for the decision loop, evaluated for cost and tool-calling reliability

## License

MIT
