# Wasteland Trader

Express.js backend for a single-player, turn-based trading game inspired by Dope Wars / Drug Lord 2.

Roadmap: see `ROADMAP.md` for phased feature planning and status.

Run tests:

```bash
npm test
```

Run phase-specific suites:

```bash
npm run test:phase1
npm run test:phase2
npm run test:future
```

Test files are organized by phase:
- `test/phase1.test.js` and `test/phase1-negative.test.js`
- `test/phase2.test.js` and `test/phase2-negative.test.js`
- `test/phase3-future.test.js`, `test/phase4-future.test.js`, and `test/phase5-future.test.js` (todo scaffolds)

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
- `GET /` -> service metadata response
- `POST /games` -> create a game session and persist it to `data/games/<uuid>.json`
- `GET /games/:id` -> load a game session by UUID
- `PATCH /games/:id` -> apply partial updates to a game session
- `POST /games/:id/actions/sleep` -> stay overnight, heal 5%, advance day
- `POST /games/:id/actions/travel` -> travel to a settlement and advance day
- `POST /games/:id/actions/heal` -> pay 200 caps per 10% health restored
- `GET /games/:id/market` -> list commodity prices (defaults to current settlement)
	- Optional filter: `GET /games/:id/market?settlement=Vault_Refuge`
- `GET /games/:id/hideout` -> view stash contents (defaults to current settlement)
	- Optional filter: `GET /games/:id/hideout?settlement=Market District`
- `GET /games/:id/hideouts` -> view stash contents across all settlements
	- Optional filter: `GET /games/:id/hideouts?settlement=market-district`
- `POST /games/:id/actions/buy-item` -> buy commodity units into inventory
- `POST /games/:id/actions/sell-item` -> sell commodity units from inventory
- `POST /games/:id/actions/dump-item` -> discard commodity units from inventory without earning caps
- `POST /games/:id/actions/stash-item` -> move commodity units from inventory into current settlement hideout
- `POST /games/:id/actions/retrieve-item` -> move commodity units from current settlement hideout into inventory
- `POST /games/:id/debt` -> unified debt endpoint with mode:
	- `{ "mode": "quote", "amount": 500 }` previews principal, early fee, and total repayment cost
	- `{ "mode": "pay", "amount": 500 }` applies repayment and persists game state

## Temporary storage model

- Each game session is stored as a JSON file in `data/games/`.
- File naming convention: `<uuid>.json`.
- Route handlers call a game service, which calls a storage module.
- All file writes are centralized in `writeJsonFile` inside `src/storage/jsonFileStore.js` so the storage engine can be swapped later.

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
	- Debt can be repaid at any time via `pay-debt`
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
