# Wasteland Trader Roadmap

This document captures the implementation plan for the Wasteland Trader monorepo, including the single-player API and the new frontend client.

## Goals

- Keep gameplay logic centralized in services so storage can be swapped later.
- Build features in layers: stable core loop first, then depth systems.
- Ensure each phase is independently testable through HTTP endpoints.
- Keep frontend and backend deployable as separate release artifacts.

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
- `test/debt-progression.test.js`: coverage for day maintenance, healing, debt quote/pay math, and debt repayment constraints.
- `test/contracts-negative.test.js`: contract/guard coverage for invalid heal payloads and ended-game lockout for day actions.

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
- Atomic hideout transfer transactions with mixed stash/retrieve operations.
- Global once-per-day hideout transfer lock to prevent inventory-capacity bypass.
- Settlement alias normalization (spaces, underscores, hyphens).
- Item availability weighting per settlement: each item has a per-settlement availability probability that is rolled on day advance. If unavailable, the item is hidden from market and blocks buy/sell.

### Delivered Endpoints
- `GET /games/:id/market`
- `POST /games/:id/actions/buy-item`
- `POST /games/:id/actions/sell-item`
- `POST /games/:id/actions/dump-item`
- `GET /games/:id/hideout`
- `GET /games/:id/hideouts`
- `POST /games/:id/actions/stash-item`
- `POST /games/:id/actions/retrieve-item`
- `POST /games/:id/actions/stash-transaction`

### Test Coverage
- `test/economy-market.test.js`: market/economy coverage (weighted average inventory pricing, item availability day-1 fallback, availability rolling on sleep/travel, buy/sell rejection when unavailable, unknown commodity guard, ended-game market lockout).
- `test/inventory-hideouts.test.js`: inventory/hideout coverage (over-capacity block after demotion, travel day-advance invariant, current-settlement stash invariant, atomic mixed stash/retrieve transactions, daily lock conflict/reset behavior, no-partial-commit guard, encounter-vs-lock precedence, hideout filter validation, unknown settlement alias and insufficient stash quantity guards).

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
- `test/events-history.test.js` contains deterministic Phase 3 integration tests for:
	- event generation on sleep/travel,
	- persisted history retrieval,
	- settlement filtering,
	- deterministic RNG behavior,
	- rumor reliability progression and demotion persistence,
	- scarcity/crash pricing effects,
	- market history snapshots and trend indicators,
	- all new event types (weapon-damage, ammo-stash, friendly-encounter, rival-encounter, nighttime-robbery, pickpocket, settlement-unrest, supply-shortage).
- `test/events-history-negative.test.js` contains guard/validation tests for:
	- events endpoint: invalid day/settlement/limit filters with correct error responses,
	- market-history endpoint: invalid settlement/item/fromDay/toDay/limit filters, day window validation, and boundary checks.

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

## Phase 4: Combat and Gear Systems (Completed)

### Features
- Encounter generation (raiders, hazards, etc.).
- Combat decision actions (fight, run, surrender).
- Weapon and armor systems (simple flat stat bonuses, no durability/repair in MVP).
- Damage model integrated with health/armor and debt-collector armor-ignore exception.
- Loot/reward and loss outcomes tied to risk level.

### Delivered Endpoints
- `GET /games/:id/encounter`
- `POST /games/:id/actions/combat`
- `POST /games/:id/actions/equip-weapon`
- `POST /games/:id/actions/equip-armor`
- `POST /games/:id/actions/sell-gear`

### Delivered Behavior
- Sleep/travel day advancement can generate and persist an active encounter in `currentEncounter`.
- Encounter set includes `raider`, `sandstorm`, and `debt-collector`.
- Combat supports regular actions (`fight`, `run`, `surrender`) and debt-collector actions (`fight`, `run`, `pay`).
- Pending encounters lock non-combat action endpoints until combat is resolved.
- Weapon and armor gear stats affect combat outcomes via flat attack/defense bonuses.
- Debt-collector combat ignores armor defense and supports debt-reduction payoff flow.
- Combat win/loss/run outcomes persist health/cash/debt updates and clear or retain encounter state appropriately.
- Loot drops populate `unequippedGear`; equip actions swap into `equippedWeapon`/`equippedArmor`.

### Test Coverage
- `test/combat-encounters.test.js`: positive flow coverage for encounter generation, combat win/run branches, debt-collector pay flow, and equip flows.
- `test/combat-encounters-negative.test.js`: guard coverage for invalid combat actions, missing encounters, invalid debt-collector actions, and invalid gear/equipment requests.

## Phase 5: Balance, Content, and Hardening (Completed - Hardening MVP)

### Features
- Save/load integrity checks and in-place schema migration for schema evolution.
- Deterministic fixture coverage for short-run and long-run replay stability.
- Hardening guards for transaction overflow and error-contract consistency.
- Baseline balance-boundary assertions across economy/event/combat configuration.
- API documentation updates for migration and deterministic fixture workflows.

### Quality Targets
- Deterministic tests for key game loops.
- Clear error contracts for invalid actions.
- Stable versioned save schema.

### Planned Tests
- `test/hardening-determinism.test.js` now includes implemented foundation coverage for:
	- schema-version persistence on new game creation,
	- in-place schema migration and legacy market-availability canonicalization,
	- deterministic seeded simulation repeatability (short-run and long-run fixtures),
	- baseline market-price multiplier assertions across settlements,
	- balance-config boundary assertions for economy/event/combat tuning values,
	- API bad-request contract compatibility.
- `test/contracts-negative.test.js` includes implemented hardening coverage for:
	- 400/404/409 error-contract response shapes,
	- buy/sell overflow transaction rejection,
	- sell-gear cash-overflow rejection.
- `test/e2e-gameplay.test.js` provides deterministic cross-system end-to-end scenarios for trading/debt workflows, encounter lock and combat resolution unlocks, and endgame lockout behavior.

### Completed for Phase 5 (Foundation)
- Added `schemaVersion` to persisted game state defaults.
- Added in-place schema migration on load via state normalization.
- Added migration persistence when legacy saves are loaded through action/query paths.
- Added foundational Phase 5 tests for migration integrity and deterministic replay behavior.

### Completed for Phase 5 (Hardening Slice 5B)
- Added numeric overflow guards for buy/sell item transactions.
- Added numeric overflow guards for sell-gear cash mutation.
- Added API error-contract matrix tests to lock 400/404/409 response expectations.

### Completed for Phase 5 (Determinism and Balance Slice 5C)
- Added long-run deterministic seeded simulation tests (15-day replay stability).
- Added baseline settlement market-price assertions against configured multipliers.
- Added balance-boundary assertions for economy availability, event probabilities, and combat configuration ranges.

### Remaining for Phase 5
- None for the hardening MVP roadmap scope.

## Post-Roadmap Enhancements (Deferred)

- Expanded item catalog and deeper settlement differentiation.
- Encounter variety/content expansion beyond current Phase 4 set.
- Additional balancing passes (price ranges, scarcity tuning, rank pacing) informed by playtest telemetry.
- Broader hardening matrix for very large-volume simulation edge cases.

## Phase 6: Monorepo and Frontend Foundation (In Progress)

### Features
- Split the repository into `apps/backend` and `apps/frontend` workspaces.
- Preserve backend API behavior while relocating runtime code and tests into the backend workspace.
- Add a vanilla frontend shell that can create a game session and display returned game state.
- Provide separate Docker compose entrypoints for backend-only and frontend-only development.
- Provide a combined root compose file that launches both services together.
- Prepare the frontend release path as static assets served by nginx.

### Delivered So Far
- Backend source, tests, and Dockerfile moved under `apps/backend`.
- Frontend scaffold added under `apps/frontend` with Vite-based local development and nginx release image.
- Frontend static MVP interaction layout scaffold added (events panel, market column, center action controls, inventory column with capacity, and status panel).
- Frontend prototype interactions added: selectable market/inventory rows and a quantity modal (`OK`/`Cancel`) for `buy`/`sell`/`dump` action flow scaffolding.
- Added a dedicated frontend live-reload Docker compose path (`docker-compose.frontend.dev.yml`) for Vite HMR editing without nginx image rebuilds.
- Root `package.json` converted to a workspace orchestrator with frontend/backend-specific scripts.
- Added `docker-compose.backend.yml` and `docker-compose.frontend.yml` alongside the combined root `docker-compose.yml`.
- Backend storage default remains rooted at the repo-level `data/games` path after the move.

### Remaining
- Wire the static frontend MVP layout to live API state (session create/load, events, market, inventory, status).
- Connect center action controls (`buy`, `sell`, `dump`, `sleep`, `travel`) to backend endpoints with response refresh.
- Add shared environment documentation/examples for local and release builds.
- Decide and implement a release pipeline for separate frontend/backend image publishing.
- Add CI automation for workspace install, backend tests, frontend build, and combined smoke checks.

## Cross-Phase Technical Principles

- Keep route handlers thin; place gameplay rules in service layer.
- Keep persistence behind storage interfaces for easy backend replacement.
- Preserve backward compatibility on stable endpoints when possible.
- Add constants/config in models or config modules rather than magic values.

## Current Priority

- Finish the frontend foundation on top of the new monorepo layout, then add release automation for independent frontend/backend artifacts.
