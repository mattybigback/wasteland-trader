# Wasteland Trader

Express.js backend for a single-player, turn-based post-apocalyptic trading game.

Disclaimer: this is an experimental, fast-iteration project focused AI experimentation. Expect rough edges.

Roadmap: see `ROADMAP.md` for phased feature planning and status.

Run tests:

```bash
npm test
```

Run tests with gameplay logs enabled:

```bash
GAMEPLAY_LOGS=1 npm test
```

For Docker-based runs:

```bash
docker compose exec -e GAMEPLAY_LOGS=1 app npm test
```

Run phase-specific suites:

```bash
npm run test:phase1
npm run test:phase2
npm run test:future
```

Run Phase 5 suites directly:

```bash
docker compose exec app node --test test/phase5-future.test.js test/phase5-negative.test.js
```

Test files are organized by phase:
- `test/phase1.test.js` and `test/phase1-negative.test.js`
- `test/phase2.test.js` and `test/phase2-negative.test.js`
- `test/phase3-future.test.js` and `test/phase3-negative.test.js` (implemented Phase 3 coverage)
- `test/phase4-future.test.js` and `test/phase4-negative.test.js` (implemented Phase 4 coverage)
- `test/phase5-future.test.js` and `test/phase5-negative.test.js` (implemented Phase 5 foundation/hardening/determinism coverage for migration, long-run seeded simulation stability, balance-boundary assertions, error-contract shape checks, and overflow guardrails)

## Dockerized development

Requirements:
- Docker Engine
- Docker Compose (v2)

Start the dev environment:

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

Check logs:

```bash
docker compose logs -f app
```

Health check:

```bash
curl http://localhost:3000/health
```

Root endpoint:

```bash
curl http://localhost:3000/
```

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
- All file writes are centralized in `writeJsonFile` inside `src/storage/jsonFileStore.js` so the storage engine can be swapped later.
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

- Use `buildSequenceRng(values, fallback)` in [test/phase5-future.test.js](test/phase5-future.test.js)
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

### API Limits ([src/models/apiLimits.js](src/models/apiLimits.js))
- `MARKET_HISTORY.defaultReturnLimit`: 10 (number of entries returned by default in market-history queries)
- `MARKET_HISTORY.maxDayWindow`: 120 (maximum day range allowed in market-history fromDay/toDay queries)

### World Events and Economy ([src/models/worldEvents.js](src/models/worldEvents.js))
- `EVENT_PROBABILITIES`: rates for luckyFind, scavengedCache, illness, shakedown, marketRiseSignal, marketDropSignal, weaponDamage, ammoStash, friendlyEncounter, rivalEncounter, nighttimeRobbery, pickpocket, settlementUnrest, supplyShortage
- `EVENT_SEVERITY_RANGES`: tuning ranges for robbery percentages, settlement unrest shifts, and supply-shortage multipliers
- `EVENT_REWARD_RANGES`: tuning ranges for ammo stash and friendly encounter loot quantities
- `RUMOR_RELIABILITY`: rumor accuracy scaling from rank 1 to rank 5 (40% to 90%)
- `MARKET_MULTIPLIER_RANGES`: price multiplier min/max/fuzz ranges for scarcity and abundance conditions

### Gameplay Settings ([src/models/economy.js](src/models/economy.js))
- `RANK_THRESHOLDS`: caps required per rank tier
- `CARRY_CAPACITY_BY_RANK`: inventory unit capacity per rank
- `COMMODITY_BASE_PRICES`: base unit price per commodity type
- `SETTLEMENT_PRICE_MULTIPLIER`: price variance factor per settlement

### Combat Balance ([src/models/combatBalance.js](src/models/combatBalance.js))
- `COMBAT_DEFAULTS`: encounter chance, run success, base player attack, debt-collector tuning
- `RUN_FAIL_DAMAGE`: random damage range when run fails
- `ENCOUNTER_TEMPLATES`: per-encounter base enemy stats and reward ranges
- `GEAR_DEFINITIONS`: weapon/armor stat bonuses and sell values
- `LOOT_DROPS`: eligible gear names that can drop from combat wins
