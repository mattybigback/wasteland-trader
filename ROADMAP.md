# Wasteland Trader Roadmap

This document captures the implementation plan for the single-player, turn-based trading game API.

## Goals

- Keep gameplay logic centralized in services so storage can be swapped later.
- Build features in layers: stable core loop first, then depth systems.
- Ensure each phase is independently testable through HTTP endpoints.

## Phase 0: Foundation (Completed)

### Features
- Dockerized Node.js LTS development environment.
- Express API scaffold with health endpoint.
- JSON file persistence with UUID-based game sessions.
- Centralized storage abstraction for reads/writes.

### Delivered Endpoints
- `GET /`
- `GET /health`
- `POST /games`
- `GET /games/:id`
- `PATCH /games/:id`

## Phase 1: Core Survival Loop (Completed)

### Features
- Day progression actions (`sleep`, `travel`, `heal`).
- Debt growth and debt-collector warning/penalty flow.
- End-of-game finalization at day limit with liquidation score logic.
- Health/armor/death state handling.
- Debt repayment with quote/pay flow and early repayment fee model.

### Delivered Endpoints
- `POST /games/:id/actions/sleep`
- `POST /games/:id/actions/travel`
- `POST /games/:id/actions/heal`
- `POST /games/:id/debt` (`mode: quote | pay`)

### Test Coverage
- `test/phase1.test.js`: positive flow coverage (day maintenance, healing, debt quote/pay math).
- `test/phase1-negative.test.js`: guard coverage (invalid heal payloads, invalid debt requests, insufficient repayment caps, ended-game lockout for day actions).

## Phase 2: Economy and Progression (Completed)

### Features
- Commodity market by settlement with location-based pricing.
- Buy/sell actions and inventory management.
- Weighted average purchase price tracking per inventory stack.
- Rank progression and demotion streak rules.
- Carry-capacity enforcement tied to rank.
- Over-capacity lock on `sleep`/`travel` until inventory is reduced.
- Item disposal (`dump`) for emergency capacity recovery.
- Settlement hideouts for stash/retrieve overflow management.
- Settlement alias normalization (spaces, underscores, hyphens).

### Delivered Endpoints
- `GET /games/:id/market`
- `POST /games/:id/actions/buy-item`
- `POST /games/:id/actions/sell-item`
- `POST /games/:id/actions/dump-item`
- `GET /games/:id/hideout`
- `GET /games/:id/hideouts`
- `POST /games/:id/actions/stash-item`
- `POST /games/:id/actions/retrieve-item`

### Test Coverage
- `test/phase2.test.js`: positive flow coverage (weighted average inventory pricing, over-capacity block after demotion, stash/retrieve with settlement aliases).
- `test/phase2-negative.test.js`: guard coverage (unknown commodities/settlements, hideout filter validation, insufficient stash quantity, ended-game lockout for market actions).

## Phase 3: Dynamic World Events (Completed)

### Features
- Random event engine triggered by day advancement and travel.
- Market rumors and temporary price modifiers.
- Event log/history stored per game for debugging and UI use.
- Settlement/day/limit query filtering for event retrieval.
- Rank-scaled rumor reliability using highest rank achieved.
- Per-day market price history with higher/lower/same trend indicators.

### Delivered Endpoints
- `GET /games/:id/events`
- `GET /games/:id/market-history`

### Delivered Behavior
- Sleep/travel trigger random events during day advancement.
- Sleep/travel responses include only newly triggered events in an `events` field.
- Event history persists in game state and supports settlement/day/limit filtering.
- Rumor signals use scarce/abundant wording and set next-day market conditions.
- Market history tracks day, settlement, commodity, previous price, delta, and direction.
- Market-history responses default to the last 10 entries unless a `limit` is provided.

### Test Coverage
- `test/phase3-future.test.js` now contains deterministic Phase 3 integration tests for:
	- event generation on sleep/travel,
	- persisted history retrieval,
	- settlement filtering,
	- deterministic RNG behavior,
	- rumor reliability progression and demotion persistence,
	- scarcity/crash pricing effects,
	- market history snapshots and trend indicators.

### Completed for Phase 3
- Event probabilities and balancing multipliers moved to [src/models/worldEvents.js](src/models/worldEvents.js).
- API limits (market-history defaults and day-window guards) extracted to [src/models/apiLimits.js](src/models/apiLimits.js).
- Market-history queries now support fromDay/toDay bounded filtering with 120-day max window.
- Event log retention changed to unbounded (no truncation).
- Toggleable gameplay logging added via GAMEPLAY_LOGS environment variable.

### Remaining for Phase 3
- None.

### Phase 3 Event Expansion Checklist
- [x] Rebalance existing event probabilities (lucky-find, scavenged-cache, illness, shakedown, market signals).
- [x] Add event probabilities for new event types (`weapon-damage`, `ammo-stash`, `friendly-encounter`, `rival-encounter`, `nighttime-robbery`, `pickpocket`, `settlement-unrest`, `supply-shortage`).
- [x] Add event severity/reward config ranges in `src/models/worldEvents.js`.
- [x] Implement `weapon-damage` event (remove weapon/ammo from inventory when possible).
- [x] Implement `ammo-stash` event (add ammo loot to inventory).
- [x] Implement `friendly-encounter` event (gift random loot to inventory).
- [x] Implement `nighttime-robbery` event (higher cash loss than shakedown).
- [x] Implement `pickpocket` event (small cash loss event).
- [x] Implement `settlement-unrest` event (temporary one-day market volatility at current settlement).
- [x] Implement `supply-shortage` event (temporary one-day scarcity multiplier for random commodity).
- [x] Implement `rival-encounter` event state and block logic.
- [x] Enforce rival block on trade/heal/ammo-buy actions while blocked at settlement.
- [x] Clear rival block when player travels away.
- [x] Add deterministic tests for all new event types and rival-block behavior.
- [x] Run full test suite and verify no regressions.
- [x] Update docs and mark Phase 3 complete.

## Phase 4: Combat and Gear Systems (Planned)

### Features
- Encounter generation (raiders, hazards, etc.).
- Combat decision actions (fight, run, surrender).
- Weapon and armor systems (stats, durability, repair).
- Damage model integrated with health/armor and debt-collector exceptions.
- Loot/reward and loss outcomes tied to risk level.

### Proposed API Additions
- `GET /games/:id/encounter`
- `POST /games/:id/actions/combat`
- Gear management endpoints for equip/repair/trade

### Planned Tests
- `test/phase4-future.test.js` contains todo test specs for encounter generation, combat branching, and gear-influenced outcomes.

## Phase 5: Balance, Content, and Hardening (Planned)

### Features
- Economy balancing pass (price ranges, scarcity, rank pacing).
- Expanded item catalog, settlement differentiation, and encounter variety.
- Save/load integrity checks and migration strategy for schema evolution.
- Automated tests for core rules and edge cases.
- API documentation cleanup and examples.

### Quality Targets
- Deterministic tests for key game loops.
- Clear error contracts for invalid actions.
- Stable versioned save schema.

### Planned Tests
- `test/phase5-future.test.js` contains todo test specs for balancing constraints, migration integrity, deterministic fixtures, and API compatibility.

## Cross-Phase Technical Principles

- Keep route handlers thin; place gameplay rules in service layer.
- Keep persistence behind storage interfaces for easy backend replacement.
- Preserve backward compatibility on stable endpoints when possible.
- Add constants/config in models or config modules rather than magic values.

## Current Priority

- Begin Phase 4 combat and gear implementation.
