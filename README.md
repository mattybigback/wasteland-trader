# Wasteland Trader

Monorepo for the Wasteland Trader backend API and frontend client.

Disclaimer: this is an experimental, fast-iteration project focused AI experimentation. Expect rough edges.

Roadmap: see `ROADMAP.md` for phased feature planning and status.

## Repository layout

```text
apps/
	backend/   Express API, gameplay logic, tests, backend Dockerfile
	frontend/  Vanilla Vite frontend, nginx release image, frontend Dockerfile
data/        Persisted backend game sessions for local/dev container runs
```

## Workspace commands

Install workspace dependencies:

```bash
npm install
```

Run backend tests:

```bash
npm run backend:test
```

Run tests with gameplay logs enabled:

```bash
GAMEPLAY_LOGS=1 npm run backend:test
```

Run backend phase-specific suites:

```bash
npm run backend:test:phase1
npm run backend:test:phase2
npm run backend:test:future
npm run backend:test:e2e
npm run backend:test:mechanisms
```

Run frontend dev server locally:

```bash
npm run frontend:dev
```

Build the frontend release bundle locally:

```bash
npm run frontend:build
```

Test files are organized by function/mechanism:
- `apps/backend/test/debt-progression.test.js` (migrated from Phase 1 debt/day-progression coverage)
- `apps/backend/test/contracts-negative.test.js` (migrated contract and overflow guard coverage from Phase 1 and Phase 5 negative suites)
- `apps/backend/test/economy-market.test.js` (migrated from Phase 2 market/economy coverage)
- `apps/backend/test/inventory-hideouts.test.js` (migrated from Phase 2 inventory/hideouts coverage)
- `apps/backend/test/events-history.test.js` and `apps/backend/test/events-history-negative.test.js` (migrated Phase 3 events/market-history coverage)
- `apps/backend/test/combat-encounters.test.js` and `apps/backend/test/combat-encounters-negative.test.js` (migrated Phase 4 combat/encounter coverage)
- `apps/backend/test/hardening-determinism.test.js` (migrated Phase 5 foundation/hardening/determinism coverage for migration, long-run seeded simulation stability, and balance-boundary assertions)
- `apps/backend/test/e2e-gameplay.test.js` (cross-system end-to-end scenarios for trading, encounters/combat locks, and full lifecycle endgame behavior)

## Dockerized development

Requirements:
- Docker Engine
- Docker Compose (v2)

Start backend only:

```bash
docker compose -f docker-compose.backend.yml up --build
```

Start frontend only:

```bash
docker compose -f docker-compose.frontend.yml up --build
```

Start the full stack:

```bash
docker compose up --build
```

Run detached:

```bash
docker compose up --build -d
```

Stop:

```bash
docker compose down
```

Check backend logs:

```bash
docker compose logs -f backend
```

Check frontend logs:

```bash
docker compose logs -f frontend
```

Backend health check:

```bash
curl http://localhost:3000/health
```

Frontend shell:

```bash
curl http://localhost:4173/
```

Backend root endpoint:

```bash
curl http://localhost:3000/
```

For Docker-based backend test runs:

```bash
docker compose -f docker-compose.backend.yml run --rm backend npm test
docker compose -f docker-compose.backend.yml run --rm -e GAMEPLAY_LOGS=1 backend npm test
```

Run the backend hardening suite directly in Docker:

```bash
docker compose -f docker-compose.backend.yml run --rm backend node --test test/hardening-determinism.test.js
```

## Frontend status

- `apps/frontend` is a new vanilla Vite app that talks to the backend through `VITE_API_BASE_URL`.
- The current shell provides a minimal create-game flow and renders the returned session snapshot.
- The release container builds static assets and serves them from nginx.
- The default local browser target is `http://localhost:3000` for the API and `http://localhost:4173` for the frontend.

## Current API

- `GET /health` -> `{ "status": "ok" }`
- `GET /` -> service metadata response: `{ "name": "wasteland-trader", "message": "Wasteland Trader API is online." }`
- `POST /games` -> create a game session and persist it to `data/games/<uuid>.json`
- `GET /games/:id` -> load a game session by UUID
- `PATCH /games/:id` -> apply partial updates to a game session
- `POST /games/:id/actions/sleep` -> stay overnight, heal 5%, advance day, and return newly triggered random events in `events`
	- Response shape: full game object plus `events: []`
- `POST /games/:id/actions/travel` -> travel to a settlement, advance day, and return newly triggered random events in `events`
	- Response shape: full game object plus `events: []`
- `POST /games/:id/actions/heal` -> pay 200 caps per 10% health restored
	- Response shape: updated game object
- `GET /games/:id/events` -> list persisted random events
	- Response shape: `{ total, items }`
	- Retention: unbounded (events are not truncated)
	- Optional filters: `?day=2`, `?settlement=Vault_Refuge`, `?limit=10`
- `GET /games/:id/market` -> list commodity prices (defaults to current settlement)
	- Response shape: `{ currentLocation, location, commodities: [{ itemName, unitPrice }] }`
	- Optional filter: `GET /games/:id/market?settlement=Vault_Refuge`
	- Note: commodities list is filtered to only items available at the settlement today (availability is rolled on day advance)
- `GET /games/:id/market-history` -> list historical prices per day, settlement, and commodity
	- Response shape: `{ total, items }` where each item includes `day`, `settlement`, `itemName`, `unitPrice`, `previousPrice`, `delta`, `direction`
	- Default response window: last 10 entries
	- Optional filters: `?settlement=market_district`, `?itemName=water`, `?fromDay=10`, `?toDay=20`, `?limit=30`
	- Day-window guard: requests over 120 days are rejected
- `GET /games/:id/hideout` -> view stash contents (defaults to current settlement)
	- Response shape: `{ currentLocation, location, items }`
	- Optional filter: `GET /games/:id/hideout?settlement=Market District`
- `GET /games/:id/hideouts` -> view stash contents across all settlements
	- Response shape without filter: `{ currentLocation, bySettlement }`
	- Response shape with `settlement` filter: `{ currentLocation, settlement, items }`
	- Optional filter: `GET /games/:id/hideouts?settlement=market-district`
- `POST /games/:id/actions/buy-item` -> buy commodity units into inventory
	- Response shape: `{ game, trade }`
- `POST /games/:id/actions/sell-item` -> sell commodity units from inventory
	- Response shape: `{ game, trade }`
- `POST /games/:id/actions/dump-item` -> discard commodity units from inventory without earning caps
	- Response shape: `{ game, trade }`
- `POST /games/:id/actions/stash-item` -> move commodity units from inventory into current settlement hideout
	- Response shape: `{ game, transfer }`
- `POST /games/:id/actions/retrieve-item` -> move commodity units from current settlement hideout into inventory
	- Response shape: `{ game, transfer }`
- `POST /games/:id/actions/stash-transaction` -> run a single atomic hideout transfer transaction with mixed stash/retrieve operations
	- Request body: `{ operations: [{ action: "stash" | "retrieve", itemName, quantity }] }`
	- Response shape: `{ game, transfer }` where `transfer.operations` lists each applied operation in order
	- Limits: one successful hideout transaction per day (global), up to two operations per commodity in the game catalog (one stash + one retrieve per commodity) in a single transaction
	- Conflict behavior: after one successful transfer transaction (including legacy `stash-item` or `retrieve-item`), hideout transfers return `409` until day advances via `sleep` or `travel`
- `GET /games/:id/encounter` -> read current active encounter, if any
	- Response shape: `{ encounter }` where encounter is either `null` or `{ type, day, settlement, enemyHealth, enemyAttack, rewardCash, surrenderPenaltyRate, lootChance }`
- `POST /games/:id/actions/combat` -> resolve encounter action
	- Request body for regular encounters: `{ "action": "fight" | "run" | "surrender" }`
	- Request body for debt-collector encounters: `{ "action": "fight" | "run" | "pay" }`
	- Response shape: `{ game, combatResult }`
- `POST /games/:id/actions/equip-weapon` -> equip a weapon from `unequippedGear`
	- Request body: `{ "weaponName": "pipe-rifle" }`
	- Response shape: `{ game, equipment }`
- `POST /games/:id/actions/equip-armor` -> equip armor from `unequippedGear`
	- Request body: `{ "armorName": "combat-vest" }`
	- Response shape: `{ game, equipment }`
- `POST /games/:id/actions/sell-gear` -> sell equipped or unequipped gear for caps
	- Request body: `{ "itemType": "weapon" | "armor", "name": "pipe-rifle" }`
	- Response shape: `{ game, trade }`
- `POST /games/:id/debt` -> unified debt endpoint with mode:
	- `{ "mode": "quote", "amount": 500 }` returns a quote object with principal, early fee, total cost, and projected balances
	- `{ "mode": "pay", "amount": 500 }` returns `{ game, repayment }`

## Temporary storage model

- Each game session is stored as a JSON file in `data/games/`.
- File naming convention: `<uuid>.json`.
- Route handlers call a game service, which calls a storage module.
- All file writes are centralized in `writeJsonFile` inside `apps/backend/src/storage/jsonFileStore.js` so the storage engine can be swapped later.
- Save schema includes `schemaVersion` (currently `2`) and supports in-place migration on load for legacy saves.

### Migration Example

Legacy-shaped payloads are normalized to the current schema when loaded/updated.

```bash
# 1) Create a game
GAME_ID=$(curl -s -X POST http://localhost:3000/games | jq -r '.id')

# 2) Patch in legacy-ish values (old schema version + non-canonical settlement)
curl -s -X PATCH "http://localhost:3000/games/$GAME_ID" \
	-H 'Content-Type: application/json' \
	-d '{
		"schemaVersion": 1,
		"location": "Vault Refuge",
		"marketAvailability": {
			"Market District": { "day": "2", "items": ["Water", "food", "unknown-item"] }
		}
	}'

# 3) Read back normalized state
curl -s "http://localhost:3000/games/$GAME_ID"
```

Expected normalization outcomes:
- `schemaVersion` upgraded to `2`
- `location` canonicalized to `vault-refuge`
- `marketAvailability` settlement and commodity names canonicalized with unknown commodities removed

### Deterministic Test Fixtures

Deterministic replay for balancing/hardening is available in test harnesses via seeded RNG injection.

- Use `buildSequenceRng(values, fallback)` in `apps/backend/test/helpers/rng.js` and `apps/backend/test/hardening-determinism.test.js`
- Inject through `gameService.__setRandomNumberGeneratorForTests(...)`
- Re-run the same sequence across multiple games and assert identical snapshots

## Implemented phase 1 rules

- New game defaults:
	- Day 1, 2000 caps cash, 1000 caps debt
	- 100% health, 0% armor
	- Starting location: `market-district`
	- Carry capacity: 10 items
- Daily progression:
	- `sleep` and `travel` both trigger day advancement
	- Each new day applies a 10 caps food cost
	- Debt grows by 15% daily (compound)
- Debt collectors:
	- Debt due day is day 8, but this does not immediately end the game
	- Warning 1: warning only
	- Warning 2: lose 30% health
	- Warning 3: lose 40% health
	- Warning 4+: death
	- Armor does not reduce debt-collector damage
	- Debt can be repaid at any time via `POST /games/:id/debt` with `{ "mode": "pay" }`
	- If repaid before due day, an early repayment fee is charged:
	  - Fee = 80% of projected interest for remaining days until due day
- Game length and scoring:
	- Base game length is 30 days
	- At end-game, score is caps on hand plus sellable value of inventory/weapons/armor
	- Rank bonus day fields are included (`extraDaysFromRanks`, `rankBonusAwardedFor`) for future rank logic

## Implemented phase 2 core loop

- Trading commodities:
	- Available commodities: water, food, chems, scrap, ammo
	- Prices vary by settlement
	- Buying and selling updates cash and inventory quantities
- Carry capacity:
	- Capacity is enforced as total item units in inventory
	- Base capacity is 10 at rank 0
	- If you are over capacity, you cannot sleep or travel until inventory is reduced to capacity or below
	- You can reduce carried units by selling, dumping, or stashing items at your current settlement
- Rank progression and demotion:
	- Promotion: hold enough caps for next rank threshold for 3 consecutive day advances
	- Demotion: stay below current rank threshold for 3 consecutive day advances
	- Promotions and demotions happen one rank at a time
	- On first achievement of each rank, game length gets a one-time +5 day bonus
	- If a demotion lowers your capacity below your current inventory count, day progression is blocked until you sell or dump enough items

- Commodity pricing in inventory:
	- Each commodity stack keeps an average purchase price
	- Buying more of an existing commodity recalculates a weighted average unit price
	- Example: buy 5 at 10 and 2 at 8 results in 7 units with average purchase price 9

- Settlement hideouts:
	- Every settlement has its own stash (unlimited capacity)
	- You can only stash/retrieve at your current settlement
	- Hideout transfers are allowed once per day globally across all settlements
	- Use `POST /games/:id/actions/stash-transaction` to move multiple item types (and mix stash/retrieve) in one atomic request
	- Legacy single-item endpoints (`stash-item`, `retrieve-item`) are still supported but consume the same daily transfer allowance
	- Retrieved items still respect carry-capacity limits
	- Settlement inputs support alias formats such as `market-district`, `market_district`, or `Market District`

## Implemented phase 4 combat MVP

- Encounter generation:
	- Day advancement can roll a combat encounter and persist it to `currentEncounter`
	- Encounter types include `raider`, `sandstorm`, and `debt-collector`
	- Use `GET /games/:id/encounter` to inspect pending encounter state
- Combat actions:
	- Regular encounters support `fight`, `run`, and `surrender`
	- Debt-collector encounters support `fight`, `run`, and `pay`
	- While an encounter is active, non-combat action endpoints are locked until the encounter is resolved
	- `fight` uses flat stats: base attack + equipped weapon bonus, with armor defense applied except against debt-collector (armor ignored)
	- `run` has success/failure branching; failed runs keep the encounter active and apply damage
	- `surrender` (regular only) applies cash penalty and clears encounter
	- `pay` (debt-collector only) reduces debt and clears encounter
- Gear system:
	- Gear drops can be added to `unequippedGear`
	- `equip-weapon` and `equip-armor` swap equipped gear from `unequippedGear`
	- `sell-gear` removes gear and grants fixed caps based on gear definition values

## Configuration

Tunable game constants are centralized in model config files:

### API Limits (`apps/backend/src/models/apiLimits.js`)
- `MARKET_HISTORY.defaultReturnLimit`: 10 (number of entries returned by default in market-history queries)
- `MARKET_HISTORY.maxDayWindow`: 120 (maximum day range allowed in market-history fromDay/toDay queries)

### World Events and Economy (`apps/backend/src/models/worldEvents.js`)
- `EVENT_PROBABILITIES`: rates for luckyFind, scavengedCache, illness, shakedown, marketRiseSignal, marketDropSignal, weaponDamage, ammoStash, friendlyEncounter, rivalEncounter, nighttimeRobbery, pickpocket, settlementUnrest, supplyShortage
- `EVENT_SEVERITY_RANGES`: tuning ranges for robbery percentages, settlement unrest shifts, and supply-shortage multipliers
- `EVENT_REWARD_RANGES`: tuning ranges for ammo stash and friendly encounter loot quantities
- `RUMOR_RELIABILITY`: rumor accuracy scaling from rank 1 to rank 5 (40% to 90%)
- `MARKET_MULTIPLIER_RANGES`: price multiplier min/max/fuzz ranges for scarcity and abundance conditions

### Gameplay Settings (`apps/backend/src/models/economy.js`)
- `RANK_THRESHOLDS`: caps required per rank tier
- `CARRY_CAPACITY_BY_RANK`: inventory unit capacity per rank
- `COMMODITY_BASE_PRICES`: base unit price per commodity type
- `SETTLEMENT_PRICE_MULTIPLIER`: price variance factor per settlement

### Combat Balance (`apps/backend/src/models/combatBalance.js`)
- `COMBAT_DEFAULTS`: encounter chance, run success, base player attack, debt-collector tuning
- `RUN_FAIL_DAMAGE`: random damage range when run fails
- `ENCOUNTER_TEMPLATES`: per-encounter base enemy stats and reward ranges
- `GEAR_DEFINITIONS`: weapon/armor stat bonuses and sell values
- `LOOT_DROPS`: eligible gear names that can drop from combat wins
