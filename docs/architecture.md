# Architecture

## Components

1. **Minecraft Realm** — the existing Java Edition realm, unmodified. No plugins or mods needed server-side.
2. **Bot account** — a second Microsoft/Minecraft account, invited to the realm like any other player. Mineflayer authenticates as this account.
3. **Mineflayer client** — a Node.js process that logs in via Microsoft auth and speaks the Minecraft protocol directly. To the server it looks like a normal player.
4. **Skills library** — functions built on Mineflayer plugins (`mineflayer-pathfinder`, `mineflayer-collectblock`, `mineflayer-pvp`, etc.): `goToPlayer()`, `collectBlock()`, `craftItem()`, `attackNearest()`, and so on.
5. **LLM brain** — on each chat command or decision tick, packages up context (message, inventory, nearby blocks/entities, current goal) and sends it to the configured model, which returns a skill call or short generated snippet to execute. See [model-options.md](model-options.md) for model selection.
6. **Memory/state** — local JSON files holding conversation history, current goal/plan, and anything the bot has learned (e.g. chest locations), giving it continuity across turns.

## Component diagram

```mermaid
flowchart TB
    You["You<br/>(Minecraft Java client)"]
    Realm["Your Realm<br/>(server)"]
    Bot["Mineflayer bot<br/>(Node.js client)"]

    subgraph Agent["Mindcraft agent process (Node.js)"]
        Memory["Memory / state<br/>(JSON files)"]
        LLM["LLM brain<br/>(configured model)"]
        Skills["Skills library<br/>(pathfinder, collectBlock, pvp, craft, build...)"]
    end

    You <-->|Minecraft protocol| Realm
    Realm <-->|"Minecraft protocol<br/>(bot joins as a normal player)"| Bot
    Bot <-->|chat events / world state| Agent
    Memory -->|context: chat, inventory, nearby blocks, goals| LLM
    LLM -->|plan / skill call / reply| Memory
    LLM --> Skills
    Skills -->|executes via Mineflayer API| Bot
```

## Interaction loop

```mermaid
sequenceDiagram
    participant U as You (chat)
    participant B as Mineflayer bot
    participant A as Agent process
    participant M as Memory/state
    participant L as LLM

    U->>B: "@Bot go chop some wood"
    B->>A: chat event + world state
    A->>M: read current goal/history
    A->>L: context (message, inventory, nearby blocks, goal)
    L-->>A: skill call, e.g. collectBlock('oak_log', 10)
    A->>B: execute via skills library
    B->>B: pathfind, mine, collect
    B-->>A: result (success/failure, new state)
    A->>M: persist updated state
    A-->>U: chat reply ("Got 10 oak logs.")
```

## Practical caveats

- **Second account required** — the bot needs its own Microsoft/Minecraft Java account invited to the realm; it can't share your account.
- **Needs to stay running** — the Node.js process (and a host machine) must be online whenever the bot should be present.
- **API costs** — each bot decision is an LLM call; cost scales with how chatty/active the bot is. See [model-options.md](model-options.md) for cheaper alternatives to frontier models.
- **Java Edition only** — this stack depends on Mineflayer's protocol support, which doesn't exist for Bedrock Realms.
