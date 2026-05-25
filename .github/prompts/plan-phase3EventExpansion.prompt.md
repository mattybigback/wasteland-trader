# Plan: Phase 3 Event Expansion & Tuning

**TL;DR**: Expand from 6 to 12–14 events by adding weapon/ammo, NPC, settlement, and cargo mechanics. Rebalance probabilities from ~25% to ~30% cumulative trigger chance. Adjust existing rewards for thematic variety. Implement across `src/models/worldEvents.js` (config) and `src/services/gameService.js` (generation logic), then verify with deterministic Phase 3 tests.

---

## **Steps**

### **Phase A: Event Design & Probability Planning** *(no code yet)*

1. **Define 8 new events** grouped by category:
   - **Weapon/Ammo Events** (2):
     - `weaponDamage`: Weapon or ammo falls apart and is removed from inventory (narrative: weapon breaks, ammo spoils).
     - `ammoStash`: Find ammunition (tangible loot, thematic to wasteland)
   
   - **NPC Interaction Events** (2):
     - `friendlyEncounter`: Meet scavenger/trader, receive commodity gift (similar to scavenged-cache but more narrative).
     - `rivalEncounter`: Rival trader undermines you locally—blocks all trade, medical services, and ammo purchases at CURRENT settlement until you travel away and return (one-time block per settlement per game)
   
   - **Robbery/Theft Events** (2):
     - `nighttimeRobbery`: robbed while sleeping (8–20% cash loss; harsher than shakedown)
     - `pickpocket`: minor theft (subtle; 3–8% cash loss; lower probability but higher frequency potential)
   
   - **Settlement/Regional Events** (2):
     - `settlementUnrest`: local instability affects prices (temporary market volatility; random direction)
     - `supplyShortage`: regional supply crisis drives prices up temporarily (scarcity multiplier 2–6×)

2. **Rebalance probability targets**:
   - **Current**: 6 events at ~25% cumulative
   - **Target**: 12–14 events at ~30–32% cumulative
   - **Strategy**: Reduce some existing probabilities slightly, add new events at 0.01–0.03 range
   - **Proposed new distribution**:
     ```
     Existing (slightly reduced):
     - luckyFind: 0.06 → 0.05
     - scavengedCache: 0.04 → 0.03
     - illness: 0.05 → 0.04
     - shakedown: 0.04 → 0.03
     - marketRiseSignal: 0.03 → 0.025
     - marketDropSignal: 0.03 → 0.025
     
     New:
     - weaponDamage: 0.02
     - ammoStash: 0.02
     - friendlyEncounter: 0.02
     - rivalEncounter: 0.01
     - nighttimeRobbery: 0.02
     - pickpocket: 0.015
     - settlementUnrest: 0.015
     - supplyShortage: 0.015
     
     New cumulative: ~30.5%
     ```

3. **Define reward/penalty values**:
   - `weaponDamage`: Remove random weapon or ammo from inventory (if inventory is empty or has no weapons/ammo, no effect)
   - `ammoStash`: +1–3 units ammo (at current settlement price)
   - `friendlyEncounter`: +1–2 random commodity units (higher rarity potential)
   - `rivalEncounter`: Block trades/medical/ammo-sales at current settlement until player travels away (tracked as `game.rivalBlockedSettlement`; expires on next travel or immediately if player leaves settlement)
   - `nighttimeRobbery`: −8–20% cash (harsher than shakedown)
   - `pickpocket`: −3–8% cash (sneaky; low impact)
   - `settlementUnrest`: ±2–8% all prices for 1 day (random direction)
   - `supplyShortage`: +2–6× multiplier for 1 day (or random commodity)

---

### **Phase B: Update Configuration Module** *(depends on Phase A design)*

4. **Expand `src/models/worldEvents.js`**:
   - Add `EVENT_PROBABILITIES` entries for all 8 new events
   - Add `EVENT_SEVERITY_RANGES` object for weapon damage, robbery amounts, settlement volatility
   - Add `EVENT_REWARD_RANGES` object for ammo stash sizes, friendly encounter rewards
   - Preserve existing EVENT_PROBABILITIES, RUMOR_RELIABILITY, MARKET_MULTIPLIER_RANGES

5. **Example new config structure**:
   ```javascript
   EVENT_PROBABILITIES: {
     // ... existing 6 events (adjusted) ...
     weaponDamage: 0.02,
     ammoStash: 0.02,
     friendlyEncounter: 0.02,
     rivalEncounter: 0.01,
     nighttimeRobbery: 0.02,
     pickpocket: 0.015,
     settlementUnrest: 0.015,
     supplyShortage: 0.015,
   },
   
   EVENT_SEVERITY_RANGES: {
     weaponDamage: { inventorySearchLimit: 5 }, // Search up to 5 items for weapon/ammo to remove
     nighttimeRobbery: { percentMin: 8, percentMax: 20 },
     pickpocket: { percentMin: 3, percentMax: 8 },
     settlementUnrest: { priceChangeMin: -8, priceChangeMax: 8 },
     supplyShortage: { multiplierMin: 2, multiplierMax: 6 },
   },
   
   EVENT_REWARD_RANGES: {
     ammoStash: { quantityMin: 1, quantityMax: 3 },
     friendlyEncounter: { quantityMin: 1, quantityMax: 2 },
   },
   ```

---

### **Phase C: Implement Event Generation Logic** *(depends on Phase B)*

**Rival Settlement Blocking Mechanism**:
- When `rivalEncounter` triggers, set `game.rivalBlockedSettlement = game.currentSettlement`
- During trade/heal/ammo-buy actions (in `src/server.js`), check `isRivalBlockedAtSettlement(game, game.currentSettlement)` and reject with 409 error if blocked
- When `travel()` action completes, clear `game.rivalBlockedSettlement = null` (player can now trade at other settlements, and when they return to blocked settlement, no longer blocked)
- **Note**: Blocking is per-settlement, not per-game; player can still trade at OTHER settlements

6. **Update `src/services/gameService.js` `generateRandomEventsForCurrentDay()`**:
   - Add probability checks for all 8 new events (matching existing pattern)
   - Implement each event's impact logic:
     - `weaponDamage`: Search inventory for first weapon/ammo item and remove it (narrative: weapon breaks, ammo spoils)
     - `ammoStash`: Add commodity (ammo) to inventory
     - `friendlyEncounter`: Add commodity to inventory with narrative
     - `rivalEncounter`: Set `game.rivalBlockedSettlement = currentSettlement`; flag blocks trade/heal/ammo-buy actions until player travels away
     - `nighttimeRobbery`: Reduce cash by harsher percentage
     - `pickpocket`: Reduce cash by smaller percentage (subtle)
     - `settlementUnrest`: Apply 1-day market volatility flag to current settlement
     - `supplyShortage`: Apply 1-day scarcity flag for random commodity at current settlement
   - Update `signaledCommodities` conflict prevention to include new events
   - Ensure all new events log via `gameplayLog()` (11 → 15+ log points)

7. **Add state tracking for temporary effects**:
   - `game.rivalBlockedSettlement`: string (settlement name) or null; blocks trades/heal/ammo-buy at that settlement; cleared when player travels away
   - `game.tempMarketVolatility`: object with `{ settlement, direction, priceChange, effectiveDay }`; applied to next-day pricing at that settlement
   - `game.tempScarcityMultiplier`: object with `{ itemName, multiplier, effectiveDay }`; applied to next-day pricing
   - **Clearing logic**: On `travel()` action, clear `rivalBlockedSettlement`; on each new day after `advanceDay()`, clear expired tempMarketVolatility and tempScarcityMultiplier by checking `effectiveDay < currentDay`

8. **Create helper methods** (if not already present):
   - `removeRandomInventoryItem(game)` — find and remove first weapon/ammo from inventory
   - `isRivalBlockedAtSettlement(game, settlement)` — check if player can trade at settlement
   - `calculateEventSeverity(eventType)` — randomizes within EVENT_SEVERITY_RANGES
   - `recordEventToHistory(game, eventEntry)` — handles persisting event with metadata

---

### **Phase D: Update Event History & API** *(depends on Phase C)*

9. **Enhance event entry structure** in event records:
   - Add `durationDays` field for temp effects (default 1)
   - Add `appliesTo` field (e.g., `settlement: "market-district"` for settlement unrest)
   - Keep existing fields: `day`, `type`, `subType`, `description`, `impact`, `settlement`, `triggeredBy`, `metadata`

10. **No API changes required** (existing `GET /games/:id/events` already handles new event types)

---

### **Phase E: Testing & Balancing** *(depends on Phase D)*

11. **Expand `test/phase3-future.test.js`**:
    - Add 8 new test cases for new events:
      - "weapon damage removes weapon/ammo from inventory" (verify item removal)
      - "ammo stash adds inventory" (verify commodity in inventory)
      - "friendly encounter adds commodity" (narrative + inventory check)
      - "rival encounter blocks trade at settlement" (verify trade rejection and clear on travel)
      - "night robbery applies harsh cash penalty" (verify cash delta)
      - "pickpocket applies subtle cash penalty" (verify smaller cash delta)
      - "settlement unrest affects prices next day" (market condition check)
      - "supply shortage creates scarcity" (verify multiplier application)
    - Verify all events persist to history correctly
    - Verify cumulative probability is ~30% (event count distribution)

12. **Deterministic RNG test scenarios**:
    - Create test vectors for all new events
    - Verify no conflicts between new events and existing market-signal logic
    - Test multi-event scenarios (e.g., friendly encounter + settlement unrest same day)

13. **Manual gameplay validation**:
    - Run game through 30+ days with logging enabled (`GAMEPLAY_LOGS=1`)
    - Verify new events appear in expected frequency
    - Check event descriptions are clear and narrative-consistent
    - Verify temporary market effects resolve correctly

---

## **Relevant files**

- `src/models/worldEvents.js` — Expand EVENT_PROBABILITIES with 8 new events; add severity/reward range configs
- `src/services/gameService.js` — Implement event generation logic in `generateRandomEventsForCurrentDay()`; add temp effect tracking in game state
- `test/phase3-future.test.js` — Add 6–8 new test cases with deterministic RNG for each event
- `src/server.js` — No changes required (events API already generic)

---

## **Verification**

1. **Unit tests**: All 27 existing tests still pass + 6–8 new Phase 3 event tests passing
2. **Deterministic RNG**: Each new event type tested with seeded RNG to verify trigger and impact
3. **Probability distribution**: Run 1000-day simulation, verify event frequency matches expected ~30% cumulative
4. **Integration**: Run full game through 30+ days with `GAMEPLAY_LOGS=1`; confirm event log shows all new types
5. **Market consistency**: Verify temporary market effects don't break price history or next-day calculations
6. **No regressions**: All existing Phase 1–2–3 behaviors unchanged

---

## **Decisions**

- **No Phase 4 combat yet**: New events are all Phase 3 scope (non-combat); weapon/ammo removal is flavor, not weapon stats
- **Settlement-scoped blocking**: `rivalEncounter` blocks current settlement only; player can trade elsewhere; penalty clears on travel away
- **1-day effect duration**: Temp effects (unrest, shortage) expire after 1 day; rival penalty expires on travel (not day-based)
- **Cumulative probability**: Targeting 30–32% (slight increase from 25%) to add flavor without overwhelming gameplay
- **No NPC persistence**: Friendly/rival encounters are one-off events, not relationship tracking (reserved for Phase 4+)
- **Ammo as commodity**: Treating ammo as existing commodity (already in COMMODITY_BASE_PRICES), not new item type
- **Weapon/ammo removal**: If inventory empty or no weapons/ammo present, `weaponDamage` event has no effect (no error)

---

## **Further Considerations**

1. **Event text narratives**: Do you want flavor descriptions for each event (e.g., "You sleep poorly and wake with a fever" vs. generic "illness")? Recommend yes for immersion.
2. **Settlement impact scope**: Should settlement unrest apply only to current settlement or cascade to neighbors? Recommend current-only for Phase 3 (avoid complexity).
3. **Rival penalty mechanic**: Should rival encounter reduce ALL sales or just specific items sold in that settlement? Recommend all sales in settlement for simplicity.
