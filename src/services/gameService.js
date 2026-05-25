const gameSessionStore = require('../storage/gameSessionStore');
const {
  getRankThreshold,
  getCarryCapacity,
  getCommodityUnitPrice,
  listAvailableCommodities
} = require('../models/economy');
const {
  EVENT_PROBABILITIES,
  EVENT_SEVERITY_RANGES,
  EVENT_REWARD_RANGES,
  RUMOR_RELIABILITY,
  MARKET_MULTIPLIER_RANGES
} = require('../models/worldEvents');
const { MARKET_HISTORY } = require('../models/apiLimits');

const SETTLEMENTS = [
  'market-district',
  'raider-camp',
  'vault-refuge',
  'trading-post',
  'ghost-town'
];

const EVENT_COMMODITY_NAMES = ['water', 'food', 'chems', 'scrap', 'ammo'];

let randomNumberGenerator = Math.random;
let gameplayLoggingEnabled = parseBooleanFlag(process.env.GAMEPLAY_LOGS);

function parseBooleanFlag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function gameplayLog(eventName, payload) {
  if (!gameplayLoggingEnabled) {
    return;
  }

  if (payload === undefined) {
    console.log(`[gameplay] ${eventName}`);
    return;
  }

  console.log(`[gameplay] ${eventName}`, payload);
}

function canonicalizeSettlementKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SETTLEMENT_ALIAS_MAP = SETTLEMENTS.reduce((map, settlement) => {
  map[canonicalizeSettlementKey(settlement)] = settlement;
  return map;
}, {});

function resolveSettlement(value) {
  const key = canonicalizeSettlementKey(value);
  return SETTLEMENT_ALIAS_MAP[key] || null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateUpdatePayload(payload) {
  if (!isPlainObject(payload)) {
    return {
      valid: false,
      message: 'Request body must be a JSON object.'
    };
  }

  return { valid: true };
}

function roundCaps(value) {
  return Math.round(value);
}

function getMaxPlayableDays(game) {
  return Number(game.maxDays || 30) + Number(game.extraDaysFromRanks || 0);
}

function ensureRankBonusFields(game) {
  if (!Array.isArray(game.rankBonusAwardedFor)) {
    game.rankBonusAwardedFor = [];
  }

  if (typeof game.extraDaysFromRanks !== 'number') {
    game.extraDaysFromRanks = 0;
  }
}

function ensureRankProgressFields(game) {
  if (typeof game.rankPromotionStreak !== 'number') {
    game.rankPromotionStreak = 0;
  }

  if (typeof game.rankDemotionStreak !== 'number') {
    game.rankDemotionStreak = 0;
  }

  if (typeof game.highestRankAchieved !== 'number') {
    game.highestRankAchieved = Number(game.rank || 0);
  }
}

function ensureInventoryFields(game) {
  if (!Array.isArray(game.inventory)) {
    game.inventory = [];
  }

  if (!Array.isArray(game.weapons)) {
    game.weapons = [];
  }
}

function ensureHideoutFields(game) {
  if (!game.hideouts || typeof game.hideouts !== 'object' || Array.isArray(game.hideouts)) {
    game.hideouts = {};
  }
}

function ensureEventFields(game) {
  if (!Array.isArray(game.eventLog)) {
    game.eventLog = [];
  }

  if (typeof game.lastEventTriggerDay !== 'number') {
    game.lastEventTriggerDay = 0;
  }

  if (!game.marketConditions || typeof game.marketConditions !== 'object' || Array.isArray(game.marketConditions)) {
    game.marketConditions = {};
  }

  if (!Array.isArray(game.marketPriceHistory)) {
    game.marketPriceHistory = [];
  }

  if (game.rivalBlockedSettlement !== null && game.rivalBlockedSettlement !== undefined) {
    const settlement = resolveSettlement(game.rivalBlockedSettlement);
    game.rivalBlockedSettlement = settlement || null;
  } else {
    game.rivalBlockedSettlement = null;
  }
}

function normalizeGameState(game) {
  ensureRankBonusFields(game);
  ensureRankProgressFields(game);
  ensureInventoryFields(game);
  ensureHideoutFields(game);
  ensureEventFields(game);

  game.rank = Number(game.rank || 0);
  game.highestRankAchieved = Math.max(Number(game.highestRankAchieved || 0), game.rank);
  game.carryCapacity = getCarryCapacity(game.rank);
}

function isRivalBlockedAtSettlement(game, settlement) {
  const blockedSettlement = resolveSettlement(game.rivalBlockedSettlement);
  const requestedSettlement = resolveSettlement(settlement);

  if (!blockedSettlement || !requestedSettlement) {
    return false;
  }

  return blockedSettlement === requestedSettlement;
}

function getRivalBlockError(game) {
  const blockedSettlement = resolveSettlement(game.rivalBlockedSettlement);

  if (!blockedSettlement) {
    return null;
  }

  return {
    error: 'bad-request',
    message: `A local rival has shut you out in ${blockedSettlement}. Leave and return before using market or medical services here.`
  };
}

function getRumorReliabilityForHighestRank(game) {
  const highestRank = Math.max(
    0,
    Math.min(RUMOR_RELIABILITY.topRankLevel, Number(game.highestRankAchieved || 0))
  );

  if (highestRank <= 0) {
    return 0;
  }

  if (highestRank === 1) {
    return RUMOR_RELIABILITY.levelOne;
  }

  const ratio = (highestRank - 1) / (RUMOR_RELIABILITY.topRankLevel - 1);

  return (
    RUMOR_RELIABILITY.levelOne +
    ratio * (RUMOR_RELIABILITY.topLevel - RUMOR_RELIABILITY.levelOne)
  );
}

function generateScarcityMultiplier() {
  const config = MARKET_MULTIPLIER_RANGES.scarcity;
  const baseMultiplier = config.baseMin + randomFloat() * (config.baseMax - config.baseMin);
  const fuzz = config.fuzzMin + randomFloat() * (config.fuzzMax - config.fuzzMin);
  return Math.max(config.clampMin, Math.min(config.clampMax, baseMultiplier * fuzz));
}

function generateAbundanceMultiplier() {
  const config = MARKET_MULTIPLIER_RANGES.abundance;
  const baseMultiplier = config.baseMin + randomFloat() * (config.baseMax - config.baseMin);
  const fuzz = config.fuzzMin + randomFloat() * (config.fuzzMax - config.fuzzMin);
  return Math.max(config.clampMin, Math.min(config.clampMax, baseMultiplier * fuzz));
}

function setMarketCondition(game, settlement, itemName, state) {
  const settlementKey = resolveSettlement(settlement) || SETTLEMENTS[0];
  const normalizedItemName = String(itemName || '').trim().toLowerCase();

  if (!normalizedItemName) {
    return null;
  }

  if (!game.marketConditions[settlementKey] || typeof game.marketConditions[settlementKey] !== 'object') {
    game.marketConditions[settlementKey] = {};
  }

  const effectiveDay = Number(game.day || 1) + 1;
  const multiplier = state === 'scarce' ? generateScarcityMultiplier() : generateAbundanceMultiplier();

  const condition = {
    state,
    multiplier,
    startDay: effectiveDay,
    endDay: effectiveDay
  };

  game.marketConditions[settlementKey][normalizedItemName] = condition;
  return {
    ...condition,
    settlement: settlementKey,
    itemName: normalizedItemName
  };
}

function setCustomMarketCondition(game, settlement, itemName, state, multiplier) {
  const settlementKey = resolveSettlement(settlement) || SETTLEMENTS[0];
  const normalizedItemName = String(itemName || '').trim().toLowerCase();

  if (!normalizedItemName) {
    return null;
  }

  if (!game.marketConditions[settlementKey] || typeof game.marketConditions[settlementKey] !== 'object') {
    game.marketConditions[settlementKey] = {};
  }

  const effectiveDay = Number(game.day || 1) + 1;
  const condition = {
    state,
    multiplier: Number(multiplier || 1),
    startDay: effectiveDay,
    endDay: effectiveDay
  };

  game.marketConditions[settlementKey][normalizedItemName] = condition;

  return {
    ...condition,
    settlement: settlementKey,
    itemName: normalizedItemName
  };
}

function pruneExpiredMarketConditions(game) {
  const currentDay = Number(game.day || 1);

  for (const settlementKey of Object.keys(game.marketConditions)) {
    const settlementConditions = game.marketConditions[settlementKey];

    if (!settlementConditions || typeof settlementConditions !== 'object') {
      delete game.marketConditions[settlementKey];
      continue;
    }

    for (const itemName of Object.keys(settlementConditions)) {
      const condition = settlementConditions[itemName];

      if (!condition || typeof condition !== 'object' || Number(condition.endDay || 0) < currentDay) {
        delete settlementConditions[itemName];
      }
    }

    if (Object.keys(settlementConditions).length === 0) {
      delete game.marketConditions[settlementKey];
    }
  }
}

function getActiveMarketCondition(game, settlement, itemName) {
  const settlementKey = resolveSettlement(settlement);
  const normalizedItemName = String(itemName || '').trim().toLowerCase();

  if (!settlementKey || !normalizedItemName) {
    return null;
  }

  const condition = game.marketConditions?.[settlementKey]?.[normalizedItemName];

  if (!condition || typeof condition !== 'object') {
    return null;
  }

  const currentDay = Number(game.day || 1);

  if (currentDay < Number(condition.startDay || 0) || currentDay > Number(condition.endDay || 0)) {
    return null;
  }

  return condition;
}

function getEffectiveCommodityUnitPrice(game, itemName, settlement) {
  const baseUnitPrice = getCommodityUnitPrice(itemName, settlement);

  if (!Number.isFinite(baseUnitPrice)) {
    return null;
  }

  const condition = getActiveMarketCondition(game, settlement, itemName);

  if (!condition) {
    return baseUnitPrice;
  }

  return Math.max(1, roundCaps(baseUnitPrice * Number(condition.multiplier || 1)));
}

function getLastMarketHistoryEntry(game, settlement, itemName) {
  const settlementKey = resolveSettlement(settlement);
  const normalizedItemName = String(itemName || '').trim().toLowerCase();

  if (!settlementKey || !normalizedItemName) {
    return null;
  }

  for (let index = game.marketPriceHistory.length - 1; index >= 0; index -= 1) {
    const entry = game.marketPriceHistory[index];

    if (!entry || typeof entry !== 'object') {
      continue;
    }

    if (
      String(entry.settlement || '').toLowerCase() === settlementKey &&
      String(entry.itemName || '').toLowerCase() === normalizedItemName
    ) {
      return entry;
    }
  }

  return null;
}

function upsertMarketHistoryEntry(game, settlement, itemName, unitPrice) {
  const settlementKey = resolveSettlement(settlement);
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const currentDay = Number(game.day || 1);

  if (!settlementKey || !normalizedItemName) {
    return;
  }

  const existingIndex = game.marketPriceHistory.findIndex((entry) => (
    Number(entry.day) === currentDay &&
    String(entry.settlement || '').toLowerCase() === settlementKey &&
    String(entry.itemName || '').toLowerCase() === normalizedItemName
  ));

  const previousEntry = getLastMarketHistoryEntry(game, settlementKey, normalizedItemName);
  const previousPrice = previousEntry ? Number(previousEntry.unitPrice) : null;
  const delta = Number.isFinite(previousPrice) ? Number(unitPrice) - previousPrice : 0;
  const direction = Number.isFinite(previousPrice)
    ? delta > 0
      ? 'higher'
      : delta < 0
        ? 'lower'
        : 'same'
    : 'new';

  const historyEntry = {
    day: currentDay,
    settlement: settlementKey,
    itemName: normalizedItemName,
    unitPrice: Number(unitPrice),
    previousPrice,
    delta,
    direction
  };

  if (existingIndex >= 0) {
    game.marketPriceHistory[existingIndex] = historyEntry;
    return;
  }

  game.marketPriceHistory.push(historyEntry);
}

function snapshotMarketPricesForCurrentDay(game) {
  for (const settlement of SETTLEMENTS) {
    for (const commodityName of EVENT_COMMODITY_NAMES) {
      const unitPrice = getEffectiveCommodityUnitPrice(game, commodityName, settlement);

      if (!Number.isFinite(unitPrice)) {
        continue;
      }

      upsertMarketHistoryEntry(game, settlement, commodityName, unitPrice);
    }
  }
}

function randomFloat() {
  const rolled = Number(randomNumberGenerator());

  if (!Number.isFinite(rolled)) {
    return Math.random();
  }

  if (rolled <= 0) {
    return 0;
  }

  if (rolled >= 1) {
    return 0.999999;
  }

  return rolled;
}

function randomInt(min, max) {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  const span = upper - lower + 1;
  return lower + Math.floor(randomFloat() * span);
}

function rollChance(probability) {
  const bounded = Math.max(0, Math.min(1, Number(probability || 0)));

  if (bounded <= 0) {
    return false;
  }

  if (bounded >= 1) {
    return true;
  }

  return randomFloat() < bounded;
}

function pickRandomCommodity(excludedItems = new Set()) {
  const available = EVENT_COMMODITY_NAMES.filter((itemName) => !excludedItems.has(itemName));

  if (available.length === 0) {
    return null;
  }

  return available[randomInt(0, available.length - 1)];
}

function removeWeaponOrAmmo(game) {
  if (Array.isArray(game.weapons) && game.weapons.length > 0) {
    const removedWeapon = game.weapons.shift();

    return {
      itemName: String(removedWeapon?.itemName || removedWeapon?.name || 'weapon').toLowerCase(),
      quantity: 1,
      source: 'weapons'
    };
  }

  const ammoStack = findInventoryItem(game, 'ammo');

  if (!ammoStack || Number(ammoStack.quantity || 0) <= 0) {
    return null;
  }

  ammoStack.quantity -= 1;

  if (ammoStack.quantity <= 0) {
    game.inventory = game.inventory.filter((item) => item !== ammoStack);
  }

  return {
    itemName: 'ammo',
    quantity: 1,
    source: 'inventory'
  };
}

function applyRankDayBonusIfNeeded(game) {
  ensureRankBonusFields(game);

  const rank = Number(game.rank || 0);

  if (rank <= 0) {
    return;
  }

  if (!game.rankBonusAwardedFor.includes(rank)) {
    game.rankBonusAwardedFor.push(rank);
    game.extraDaysFromRanks += 5;
  }
}

function getInventoryItemUnits(game) {
  return game.inventory.reduce((total, item) => {
    if (!item || typeof item !== 'object') {
      return total;
    }

    const quantity = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    return total + quantity;
  }, 0);
}

function calculateWeightedAverageUnitPrice(existingQuantity, existingUnitPrice, addedQuantity, addedUnitPrice) {
  const currentQty = Math.max(0, Number(existingQuantity || 0));
  const currentPrice = Math.max(0, Number(existingUnitPrice || 0));
  const incomingQty = Math.max(0, Number(addedQuantity || 0));
  const incomingPrice = Math.max(0, Number(addedUnitPrice || 0));

  const combinedQuantity = currentQty + incomingQty;

  if (combinedQuantity <= 0) {
    return 0;
  }

  const totalValue = currentQty * currentPrice + incomingQty * incomingPrice;
  return roundCaps(totalValue / combinedQuantity);
}

function isOverCarryCapacity(game) {
  const capacity = Number(game.carryCapacity || getCarryCapacity(game.rank));
  const currentUnits = getInventoryItemUnits(game);
  return currentUnits > capacity;
}

function getOverCapacityError(game) {
  const capacity = Number(game.carryCapacity || getCarryCapacity(game.rank));
  const currentUnits = getInventoryItemUnits(game);

  return {
    error: 'bad-request',
    message: `You are over carry capacity (${currentUnits}/${capacity}). Sell, dump, or stash items before sleeping or traveling.`
  };
}

function findInventoryItem(game, itemName) {
  const normalizedName = String(itemName || '').trim().toLowerCase();
  return game.inventory.find((item) => String(item.itemName || '').toLowerCase() === normalizedName);
}

function findCommodityStack(collection, itemName) {
  const normalizedName = String(itemName || '').trim().toLowerCase();
  return collection.find((item) => String(item.itemName || '').toLowerCase() === normalizedName);
}

function upsertInventoryCommodity(game, itemName, quantity, unitValue) {
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity || 0);

  if (!normalizedItemName || requestedQuantity <= 0) {
    return;
  }

  const existingItem = findInventoryItem(game, normalizedItemName);

  if (existingItem) {
    const nextAveragePrice = calculateWeightedAverageUnitPrice(
      existingItem.quantity,
      existingItem.avgPurchasePrice ?? existingItem.value,
      requestedQuantity,
      unitValue
    );

    existingItem.quantity += requestedQuantity;
    existingItem.avgPurchasePrice = nextAveragePrice;
    existingItem.value = nextAveragePrice;
    existingItem.sellValue = nextAveragePrice;
    return;
  }

  game.inventory.push({
    itemName: normalizedItemName,
    quantity: requestedQuantity,
    avgPurchasePrice: unitValue,
    value: unitValue,
    sellValue: unitValue
  });
}

function buildEventEntry(game, triggeredBy, type, subType, description, impact, metadata = {}) {
  return {
    day: Number(game.day || 1),
    type,
    subType,
    description,
    impact,
    settlement: resolveSettlement(game.location) || SETTLEMENTS[0],
    triggeredBy,
    occurredAt: new Date().toISOString(),
    metadata
  };
}

function generateRandomEventsForCurrentDay(game, triggeredBy) {
  if (game.status !== 'active') {
    return [];
  }

  const currentDay = Number(game.day || 1);

  if (Number(game.lastEventTriggerDay || 0) === currentDay) {
    return [];
  }

  pruneExpiredMarketConditions(game);

  const events = [];

  if (rollChance(EVENT_PROBABILITIES.luckyFind)) {
    const foundCaps = randomInt(120, 520);
    game.cash = Number(game.cash || 0) + foundCaps;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'positive',
        'lucky-find',
        `You discover a hidden cache with ${foundCaps} caps.`,
        {
          cash: foundCaps,
          health: 0,
          inventory: []
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.scavengedCache)) {
    const itemName = pickRandomCommodity();

    if (itemName) {
      const quantity = randomInt(1, 2);
      const unitPrice = Number(getCommodityUnitPrice(itemName, game.location) || 0);
      upsertInventoryCommodity(game, itemName, quantity, unitPrice);

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'positive',
          'scavenged-cache',
          `You salvage ${quantity} ${itemName} from a nearby stash.`,
          {
            cash: 0,
            health: 0,
            inventory: [
              {
                itemName,
                quantity
              }
            ]
          }
        )
      );
    }
  }

  if (rollChance(EVENT_PROBABILITIES.illness)) {
    const healthBefore = Number(game.health || 0);
    const damage = randomInt(5, 12);
    const healthAfter = Math.max(1, healthBefore - damage);
    const lostHealth = healthBefore - healthAfter;
    game.health = healthAfter;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'negative',
        'illness',
        `You fall ill and lose ${lostHealth}% health.`,
        {
          cash: 0,
          health: -lostHealth,
          inventory: []
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.shakedown)) {
    const currentCash = Number(game.cash || 0);
    const percent = randomInt(8, 15);
    const lostCash = roundCaps((currentCash * percent) / 100);
    game.cash = currentCash - lostCash;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'negative',
        'shakedown',
        `Bandits shake you down for ${lostCash} caps.`,
        {
          cash: -lostCash,
          health: 0,
          inventory: []
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.weaponDamage)) {
    const removedItem = removeWeaponOrAmmo(game);

    if (removedItem) {
      const itemLabel = removedItem.itemName === 'ammo' ? 'ammo cache' : removedItem.itemName;

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'negative',
          'weapon-damage',
          `Your ${itemLabel} falls apart and becomes unusable.`,
          {
            cash: 0,
            health: 0,
            inventory: [
              {
                itemName: removedItem.itemName,
                quantity: -removedItem.quantity
              }
            ]
          },
          {
            source: removedItem.source
          }
        )
      );
    }
  }

  if (rollChance(EVENT_PROBABILITIES.ammoStash)) {
    const quantity = randomInt(
      EVENT_REWARD_RANGES.ammoStash.quantityMin,
      EVENT_REWARD_RANGES.ammoStash.quantityMax
    );
    const unitPrice = Number(getCommodityUnitPrice('ammo', game.location) || 0);

    upsertInventoryCommodity(game, 'ammo', quantity, unitPrice);

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'positive',
        'ammo-stash',
        `You uncover an ammo stash with ${quantity} rounds.`,
        {
          cash: 0,
          health: 0,
          inventory: [
            {
              itemName: 'ammo',
              quantity
            }
          ]
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.friendlyEncounter)) {
    const itemName = pickRandomCommodity();

    if (itemName) {
      const quantity = randomInt(
        EVENT_REWARD_RANGES.friendlyEncounter.quantityMin,
        EVENT_REWARD_RANGES.friendlyEncounter.quantityMax
      );
      const unitPrice = Number(getCommodityUnitPrice(itemName, game.location) || 0);

      upsertInventoryCommodity(game, itemName, quantity, unitPrice);

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'positive',
          'friendly-encounter',
          `A friendly scavver shares ${quantity} ${itemName} with you.`,
          {
            cash: 0,
            health: 0,
            inventory: [
              {
                itemName,
                quantity
              }
            ]
          }
        )
      );
    }
  }

  if (rollChance(EVENT_PROBABILITIES.rivalEncounter)) {
    const settlement = resolveSettlement(game.location) || SETTLEMENTS[0];
    game.rivalBlockedSettlement = settlement;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'negative',
        'rival-encounter',
        `A rival fixer blacklists you in ${settlement}. Leave and return before you can trade or use medical services there again.`,
        {
          cash: 0,
          health: 0,
          inventory: []
        },
        {
          blockedSettlement: settlement,
          blockClearsOnTravelAway: true
        }
      )
    );
  }

  if (triggeredBy === 'sleep' && rollChance(EVENT_PROBABILITIES.nighttimeRobbery)) {
    const currentCash = Number(game.cash || 0);
    const percent = randomInt(
      EVENT_SEVERITY_RANGES.nighttimeRobbery.percentMin,
      EVENT_SEVERITY_RANGES.nighttimeRobbery.percentMax
    );
    const lostCash = roundCaps((currentCash * percent) / 100);
    game.cash = currentCash - lostCash;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'negative',
        'nighttime-robbery',
        `You are robbed in your sleep and lose ${lostCash} caps.`,
        {
          cash: -lostCash,
          health: 0,
          inventory: []
        },
        {
          percentLost: percent
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.pickpocket)) {
    const currentCash = Number(game.cash || 0);
    const percent = randomInt(
      EVENT_SEVERITY_RANGES.pickpocket.percentMin,
      EVENT_SEVERITY_RANGES.pickpocket.percentMax
    );
    const lostCash = roundCaps((currentCash * percent) / 100);
    game.cash = currentCash - lostCash;

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'negative',
        'pickpocket',
        `A pickpocket slips away with ${lostCash} caps.`,
        {
          cash: -lostCash,
          health: 0,
          inventory: []
        },
        {
          percentLost: percent
        }
      )
    );
  }

  const signaledCommodities = new Set();

  if (rollChance(EVENT_PROBABILITIES.supplyShortage)) {
    const itemName = pickRandomCommodity(signaledCommodities);

    if (itemName) {
      signaledCommodities.add(itemName);
      const multiplier = (
        EVENT_SEVERITY_RANGES.supplyShortage.multiplierMin +
        randomFloat() * (
          EVENT_SEVERITY_RANGES.supplyShortage.multiplierMax -
          EVENT_SEVERITY_RANGES.supplyShortage.multiplierMin
        )
      );
      const condition = setCustomMarketCondition(
        game,
        game.location,
        itemName,
        'supply-shortage',
        multiplier
      );

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'market-signal',
          'supply-shortage',
          `Supply lines falter: ${itemName} may spike in ${resolveSettlement(game.location) || game.location} tomorrow.`,
          {
            cash: 0,
            health: 0,
            inventory: []
          },
          {
            itemName,
            signal: 'shortage',
            multiplier,
            effectiveDay: condition ? condition.startDay : Number(game.day || 1) + 1,
            targetSettlement: condition ? condition.settlement : resolveSettlement(game.location) || SETTLEMENTS[0]
          }
        )
      );
    }
  }

  if (rollChance(EVENT_PROBABILITIES.settlementUnrest)) {
    const rise = rollChance(0.5);
    const percent = randomInt(
      EVENT_SEVERITY_RANGES.settlementUnrest.percentMin,
      EVENT_SEVERITY_RANGES.settlementUnrest.percentMax
    );
    const signedPercent = rise ? percent : -percent;
    const multiplier = 1 + (signedPercent / 100);
    const settlement = resolveSettlement(game.location) || SETTLEMENTS[0];

    for (const itemName of EVENT_COMMODITY_NAMES) {
      setCustomMarketCondition(game, settlement, itemName, 'settlement-unrest', multiplier);
    }

    events.push(
      buildEventEntry(
        game,
        triggeredBy,
        'market-signal',
        'settlement-unrest',
        rise
          ? `Unrest drives prices up in ${settlement} for tomorrow's trading.`
          : `Unrest disrupts markets in ${settlement}; prices may dip tomorrow.`,
        {
          cash: 0,
          health: 0,
          inventory: []
        },
        {
          targetSettlement: settlement,
          percentShift: signedPercent,
          effectiveDay: Number(game.day || 1) + 1
        }
      )
    );
  }

  if (rollChance(EVENT_PROBABILITIES.marketRiseSignal)) {
    const itemName = pickRandomCommodity(signaledCommodities);

    if (itemName) {
      signaledCommodities.add(itemName);
      const reliability = getRumorReliabilityForHighestRank(game);
      const isAccurate = rollChance(reliability);
      const actualMarketState = isAccurate ? 'scarce' : 'abundant';
      const condition = setMarketCondition(game, game.location, itemName, actualMarketState);

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'market-signal',
          'price-rise-signal',
          `Rumor: ${itemName} may be scarce in ${resolveSettlement(game.location) || game.location} tomorrow.`,
          {
            cash: 0,
            health: 0,
            inventory: []
          },
          {
            itemName,
            signal: 'scarce',
            reliability,
            isAccurate,
            actualMarketState,
            effectiveDay: condition ? condition.startDay : Number(game.day || 1) + 1,
            targetSettlement: condition ? condition.settlement : resolveSettlement(game.location) || SETTLEMENTS[0]
          }
        )
      );
    }
  }

  if (rollChance(EVENT_PROBABILITIES.marketDropSignal)) {
    const itemName = pickRandomCommodity(signaledCommodities);

    if (itemName) {
      signaledCommodities.add(itemName);
      const reliability = getRumorReliabilityForHighestRank(game);
      const isAccurate = rollChance(reliability);
      const actualMarketState = isAccurate ? 'abundant' : 'scarce';
      const condition = setMarketCondition(game, game.location, itemName, actualMarketState);

      events.push(
        buildEventEntry(
          game,
          triggeredBy,
          'market-signal',
          'price-drop-signal',
          `Rumor: ${itemName} may be abundant in ${resolveSettlement(game.location) || game.location} tomorrow.`,
          {
            cash: 0,
            health: 0,
            inventory: []
          },
          {
            itemName,
            signal: 'abundant',
            reliability,
            isAccurate,
            actualMarketState,
            effectiveDay: condition ? condition.startDay : Number(game.day || 1) + 1,
            targetSettlement: condition ? condition.settlement : resolveSettlement(game.location) || SETTLEMENTS[0]
          }
        )
      );
    }
  }

  game.lastEventTriggerDay = currentDay;

  if (events.length > 0) {
    game.eventLog = game.eventLog.concat(events);
    gameplayLog('events.triggered', {
      gameId: game.id,
      day: currentDay,
      triggeredBy,
      count: events.length,
      subTypes: events.map((event) => event.subType)
    });
  }

  return events;
}

function getHideoutItemsBySettlement(game, settlement) {
  const location = resolveSettlement(settlement) || resolveSettlement(game.location) || SETTLEMENTS[0];

  if (!Array.isArray(game.hideouts[location])) {
    game.hideouts[location] = [];
  }

  return game.hideouts[location];
}

function getActiveHideoutItems(game) {
  return getHideoutItemsBySettlement(game, game.location);
}

function applyRankProgressForDay(game) {
  const rank = Number(game.rank || 0);
  const cash = Number(game.cash || 0);
  const currentRankThreshold = getRankThreshold(rank);
  const nextRankThreshold = getRankThreshold(rank + 1);

  if (Number.isFinite(nextRankThreshold) && cash >= nextRankThreshold) {
    game.rankPromotionStreak += 1;
    game.rankDemotionStreak = 0;

    if (game.rankPromotionStreak >= 3) {
      game.rank = rank + 1;
      game.highestRankAchieved = Math.max(Number(game.highestRankAchieved || 0), game.rank);
      game.rankPromotionStreak = 0;
      game.rankDemotionStreak = 0;
      game.carryCapacity = getCarryCapacity(game.rank);
      applyRankDayBonusIfNeeded(game);
    }

    return;
  }

  if (rank > 0 && cash < currentRankThreshold) {
    game.rankDemotionStreak += 1;
    game.rankPromotionStreak = 0;

    if (game.rankDemotionStreak >= 3) {
      game.rank = rank - 1;
      game.rankPromotionStreak = 0;
      game.rankDemotionStreak = 0;
      game.carryCapacity = getCarryCapacity(game.rank);
    }

    return;
  }

  game.rankPromotionStreak = 0;
  game.rankDemotionStreak = 0;
}

function calculateSellableValue(collection) {
  if (!Array.isArray(collection)) {
    return 0;
  }

  return collection.reduce((total, item) => {
    if (!item || typeof item !== 'object') {
      return total;
    }

    const quantity = Number.isFinite(item.quantity) ? item.quantity : 1;
    const unitValue = Number.isFinite(item.sellValue)
      ? item.sellValue
      : Number.isFinite(item.value)
        ? item.value
        : Number.isFinite(item.price)
          ? item.price
          : 0;

    return total + unitValue * quantity;
  }, 0);
}

function calculateFinalScore(game) {
  const inventoryValue = calculateSellableValue(game.inventory);
  const weaponsValue = calculateSellableValue(game.weapons);
  const armorValue = game.armorItem && typeof game.armorItem === 'object'
    ? Number(game.armorItem.sellValue || game.armorItem.value || game.armorItem.price || 0)
    : 0;

  return roundCaps(Number(game.cash || 0) + inventoryValue + weaponsValue + armorValue);
}

function endGame(game, reason) {
  if (game.status === 'ended') {
    return;
  }

  game.status = 'ended';
  game.endReason = reason;
  game.endedAt = new Date().toISOString();
  game.score = calculateFinalScore(game);
}

function applyDebtCollectorPenalty(game) {
  if (Number(game.debt || 0) <= 0) {
    return;
  }

  if (Number(game.day || 1) < Number(game.debtDueDay || 8)) {
    return;
  }

  game.debtWarnings = Number(game.debtWarnings || 0) + 1;

  if (game.debtWarnings === 2) {
    game.health = Number(game.health || 0) - 30;
    return;
  }

  if (game.debtWarnings === 3) {
    game.health = Number(game.health || 0) - 40;
    return;
  }

  if (game.debtWarnings >= 4) {
    game.health = 0;
  }
}

function applyDailyMaintenance(game) {
  game.cash = roundCaps(Number(game.cash || 0) - 10);

  if (Number(game.debt || 0) > 0) {
    const interestRate = Number(game.debtInterestRateDaily || 0.15);
    game.debt = roundCaps(Number(game.debt) * (1 + interestRate));
  }

  applyDebtCollectorPenalty(game);

  if (Number(game.health || 0) <= 0) {
    endGame(game, 'killed-by-debt-collectors');
    game.health = 0;
  }
}

function calculateEarlyRepaymentFee(game, principalAmount) {
  const debtDueDay = Number(game.debtDueDay || 8);
  const currentDay = Number(game.day || 1);
  const remainingDays = Math.max(0, debtDueDay - currentDay);

  if (remainingDays <= 0) {
    return 0;
  }

  const rate = Number(game.debtInterestRateDaily || 0.15);
  const futureInterest = Number(principalAmount) * (Math.pow(1 + rate, remainingDays) - 1);

  // Early repayment fee: 80% of projected remaining interest.
  return roundCaps(futureInterest * 0.8);
}

function buildDebtTransactionDetails(game, amount, amountErrorMessage) {
  const outstandingDebt = Math.max(0, Number(game.debt || 0));

  if (outstandingDebt <= 0) {
    return {
      error: 'bad-request',
      message: 'Debt is already fully paid.'
    };
  }

  const requestedAmount = Number(amount);

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return {
      error: 'bad-request',
      message: amountErrorMessage
    };
  }

  const principalPaid = Math.min(roundCaps(requestedAmount), outstandingDebt);
  const earlyRepaymentFee = calculateEarlyRepaymentFee(game, principalPaid);
  const totalCost = principalPaid + earlyRepaymentFee;

  return {
    principalPaid,
    earlyRepaymentFee,
    totalCost,
    outstandingDebt
  };
}

function finalizeIfDayLimitReached(game) {
  if (game.status === 'ended') {
    return;
  }

  const maxPlayableDays = getMaxPlayableDays(game);

  if (Number(game.day || 1) >= maxPlayableDays) {
    endGame(game, 'day-limit-reached');
  }
}

async function saveGame(game) {
  game.updatedAt = new Date().toISOString();
  await gameSessionStore.saveGame(game);
  return game;
}

async function loadActiveGame(gameId) {
  const game = await gameSessionStore.getGame(gameId);

  if (!game) {
    return { error: 'not-found' };
  }

  normalizeGameState(game);

  if (game.status === 'ended') {
    return { error: 'game-ended', game };
  }

  return { game };
}

async function advanceDay(gameId, options = {}) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const mutateGame = typeof options === 'function' ? options : options.mutateGame;
  const triggeredBy = typeof options === 'function'
    ? 'sleep'
    : String(options.triggeredBy || 'sleep').trim().toLowerCase();

  const game = loaded.game;
  const previousDay = Number(game.day || 1);
  const previousCash = Number(game.cash || 0);
  const previousDebt = Number(game.debt || 0);
  const previousHealth = Number(game.health || 0);
  const previousLocation = game.location;

  if (typeof mutateGame === 'function') {
    mutateGame(game);
  }

  finalizeIfDayLimitReached(game);

  let events = [];

  if (game.status === 'active') {
    game.day = Number(game.day || 1) + 1;
    applyDailyMaintenance(game);
    applyRankProgressForDay(game);
    finalizeIfDayLimitReached(game);

    if (game.status === 'active') {
      events = generateRandomEventsForCurrentDay(game, triggeredBy);
    }

    snapshotMarketPricesForCurrentDay(game);
  }

  await saveGame(game);

  gameplayLog('day.advanced', {
    gameId: game.id,
    triggeredBy,
    fromDay: previousDay,
    toDay: Number(game.day || previousDay),
    fromLocation: previousLocation,
    toLocation: game.location,
    cashDelta: Number(game.cash || 0) - previousCash,
    debtDelta: Number(game.debt || 0) - previousDebt,
    healthDelta: Number(game.health || 0) - previousHealth,
    eventCount: events.length,
    status: game.status
  });

  return { game, events };
}

async function sleep(gameId) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  if (isOverCarryCapacity(loaded.game)) {
    return getOverCapacityError(loaded.game);
  }

  return advanceDay(gameId, {
    triggeredBy: 'sleep',
    mutateGame: (game) => {
      game.health = Math.min(100, Number(game.health || 0) + 5);
    }
  });
}

async function travel(gameId, destination) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  if (isOverCarryCapacity(loaded.game)) {
    return getOverCapacityError(loaded.game);
  }

  if (typeof destination !== 'string' || destination.trim().length === 0) {
    return { error: 'bad-request', message: 'Destination settlement is required.' };
  }

  const normalizedDestination = resolveSettlement(destination);

  if (!normalizedDestination) {
    return { error: 'bad-request', message: 'Unknown settlement destination.' };
  }

  return advanceDay(gameId, {
    triggeredBy: 'travel',
    mutateGame: (game) => {
      const blockedSettlement = resolveSettlement(game.rivalBlockedSettlement);

      if (blockedSettlement && blockedSettlement !== normalizedDestination) {
        game.rivalBlockedSettlement = null;
      }

      game.location = normalizedDestination;
    }
  });
}

async function getEventLog(gameId, options = {}) {
  const game = await gameSessionStore.getGame(gameId);

  if (!game) {
    return { error: 'not-found' };
  }

  normalizeGameState(game);

  const queryDay = options.day;
  const settlementInput = String(options.settlement || '').trim();
  const queryLimit = options.limit;

  let events = Array.isArray(game.eventLog) ? [...game.eventLog] : [];

  if (queryDay !== undefined && queryDay !== null && String(queryDay).trim() !== '') {
    const parsedDay = Number(queryDay);

    if (!Number.isInteger(parsedDay) || parsedDay <= 0) {
      return { error: 'bad-request', message: 'day filter must be a positive integer.' };
    }

    events = events.filter((event) => Number(event.day) === parsedDay);
  }

  if (settlementInput) {
    const settlement = resolveSettlement(settlementInput);

    if (!settlement) {
      return { error: 'bad-request', message: 'Unknown settlement filter.' };
    }

    events = events.filter((event) => String(event.settlement || '').toLowerCase() === settlement);
  }

  if (queryLimit !== undefined && queryLimit !== null && String(queryLimit).trim() !== '') {
    const parsedLimit = Number(queryLimit);

    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return { error: 'bad-request', message: 'limit filter must be a positive integer.' };
    }

    events = events.slice(-parsedLimit);
  }

  return {
    events: {
      total: events.length,
      items: events
    }
  };
}

async function getMarketPriceHistory(gameId, options = {}) {
  const game = await gameSessionStore.getGame(gameId);

  if (!game) {
    return { error: 'not-found' };
  }

  normalizeGameState(game);

  if (game.marketPriceHistory.length === 0) {
    snapshotMarketPricesForCurrentDay(game);
    await saveGame(game);
  }

  const settlementInput = String(options.settlement || '').trim();
  const itemNameInput = String(options.itemName || '').trim().toLowerCase();
  const queryLimit = options.limit;
  const fromDayInput = options.fromDay;
  const toDayInput = options.toDay;

  let items = [...game.marketPriceHistory];

  if (settlementInput) {
    const settlement = resolveSettlement(settlementInput);

    if (!settlement) {
      return { error: 'bad-request', message: 'Unknown settlement filter.' };
    }

    items = items.filter((entry) => String(entry.settlement || '').toLowerCase() === settlement);
  }

  if (itemNameInput) {
    if (!EVENT_COMMODITY_NAMES.includes(itemNameInput)) {
      return { error: 'bad-request', message: 'Unknown commodity filter.' };
    }

    items = items.filter((entry) => String(entry.itemName || '').toLowerCase() === itemNameInput);
  }

  const hasFromDay = fromDayInput !== undefined && fromDayInput !== null && String(fromDayInput).trim() !== '';
  const hasToDay = toDayInput !== undefined && toDayInput !== null && String(toDayInput).trim() !== '';

  let parsedFromDay = null;
  let parsedToDay = null;

  if (hasFromDay) {
    parsedFromDay = Number(fromDayInput);

    if (!Number.isInteger(parsedFromDay) || parsedFromDay <= 0) {
      return { error: 'bad-request', message: 'fromDay filter must be a positive integer.' };
    }
  }

  if (hasToDay) {
    parsedToDay = Number(toDayInput);

    if (!Number.isInteger(parsedToDay) || parsedToDay <= 0) {
      return { error: 'bad-request', message: 'toDay filter must be a positive integer.' };
    }
  }

  if (hasFromDay || hasToDay) {
    const effectiveFromDay = parsedFromDay ?? 1;
    const effectiveToDay = parsedToDay ?? Number(game.day || 1);

    if (effectiveFromDay > effectiveToDay) {
      return { error: 'bad-request', message: 'fromDay must be less than or equal to toDay.' };
    }

    if ((effectiveToDay - effectiveFromDay + 1) > MARKET_HISTORY.maxDayWindow) {
      return {
        error: 'bad-request',
        message: `Requested day window exceeds maximum of ${MARKET_HISTORY.maxDayWindow} days.`
      };
    }

    items = items.filter((entry) => {
      const entryDay = Number(entry.day || 0);
      return entryDay >= effectiveFromDay && entryDay <= effectiveToDay;
    });
  }

  if (queryLimit !== undefined && queryLimit !== null && String(queryLimit).trim() !== '') {
    const parsedLimit = Number(queryLimit);

    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return { error: 'bad-request', message: 'limit filter must be a positive integer.' };
    }

    items = items.slice(-parsedLimit);
  } else {
    items = items.slice(-MARKET_HISTORY.defaultReturnLimit);
  }

  return {
    marketHistory: {
      total: items.length,
      items
    }
  };
}

async function createGame(overrides = {}) {
  const game = await gameSessionStore.createGame(overrides);

  normalizeGameState(game);
  snapshotMarketPricesForCurrentDay(game);

  await saveGame(game);

  gameplayLog('game.created', {
    gameId: game.id,
    day: game.day,
    location: game.location,
    cash: game.cash,
    debt: game.debt
  });

  return game;
}

async function heal(gameId, percentage) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;

  if (isRivalBlockedAtSettlement(game, game.location)) {
    return getRivalBlockError(game);
  }

  const healAmount = Number(percentage);

  if (!Number.isInteger(healAmount) || healAmount <= 0 || healAmount % 10 !== 0) {
    return { error: 'bad-request', message: 'Heal percentage must be a positive multiple of 10.' };
  }

  const missingHealth = Math.max(0, 100 - Number(game.health || 0));
  const appliedHeal = Math.min(healAmount, missingHealth);

  if (appliedHeal === 0) {
    return { error: 'bad-request', message: 'Health is already full.' };
  }

  const cost = (appliedHeal / 10) * 200;

  if (Number(game.cash || 0) < cost) {
    return { error: 'bad-request', message: 'Not enough caps to heal.' };
  }

  game.cash = Number(game.cash || 0) - cost;
  game.health = Math.min(100, Number(game.health || 0) + appliedHeal);

  await saveGame(game);

  gameplayLog('player.healed', {
    gameId: game.id,
    healAmount: appliedHeal,
    cost,
    health: game.health,
    cash: game.cash
  });

  return { game };
}

async function payDebt(gameId, amount) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const details = buildDebtTransactionDetails(
    game,
    amount,
    'Debt payment amount must be a positive number.'
  );

  if (details.error) {
    return details;
  }

  const { principalPaid, earlyRepaymentFee, totalCost, outstandingDebt } = details;

  if (Number(game.cash || 0) < totalCost) {
    return {
      error: 'bad-request',
      message: `Not enough caps to pay debt. Required: ${totalCost} (principal ${principalPaid} + early fee ${earlyRepaymentFee}).`
    };
  }

  game.cash = Number(game.cash || 0) - totalCost;
  game.debt = Math.max(0, roundCaps(outstandingDebt - principalPaid));

  await saveGame(game);

  gameplayLog('debt.paid', {
    gameId: game.id,
    principalPaid,
    earlyRepaymentFee,
    totalCost,
    remainingDebt: game.debt,
    remainingCash: game.cash
  });

  return {
    game,
    repayment: {
      principalPaid,
      earlyRepaymentFee,
      totalCost,
      remainingDebt: game.debt,
      remainingCash: game.cash
    }
  };
}

async function getDebtQuote(gameId, amount) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const details = buildDebtTransactionDetails(game, amount, 'Quote amount must be a positive number.');

  if (details.error) {
    return details;
  }

  const { principalPaid, earlyRepaymentFee, totalCost, outstandingDebt } = details;

  return {
    quote: {
      principalPaid,
      earlyRepaymentFee,
      totalCost,
      currentDebt: outstandingDebt,
      currentCash: Number(game.cash || 0),
      projectedRemainingDebt: Math.max(0, roundCaps(outstandingDebt - principalPaid)),
      projectedRemainingCash: Number(game.cash || 0) - totalCost,
      payableNow: Number(game.cash || 0) >= totalCost
    }
  };
}

async function handleDebtOperation(gameId, mode, amount) {
  const normalizedMode = String(mode || '').trim().toLowerCase();

  if (normalizedMode === 'quote') {
    return getDebtQuote(gameId, amount);
  }

  if (normalizedMode === 'pay') {
    return payDebt(gameId, amount);
  }

  return {
    error: 'bad-request',
    message: 'Debt mode must be either "quote" or "pay".'
  };
}

async function buyItem(gameId, itemName, quantity) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;

  if (isRivalBlockedAtSettlement(game, game.location)) {
    return getRivalBlockError(game);
  }

  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const unitPrice = getEffectiveCommodityUnitPrice(game, normalizedItemName, game.location);

  if (!Number.isFinite(unitPrice)) {
    return { error: 'bad-request', message: 'Unknown commodity.' };
  }

  const currentUnits = getInventoryItemUnits(game);
  const capacity = Number(game.carryCapacity || getCarryCapacity(game.rank));

  if (currentUnits + requestedQuantity > capacity) {
    return {
      error: 'bad-request',
      message: `Not enough carry space. Capacity ${capacity}, currently carrying ${currentUnits}.`
    };
  }

  const totalCost = unitPrice * requestedQuantity;

  if (Number(game.cash || 0) < totalCost) {
    return { error: 'bad-request', message: 'Not enough caps to buy items.' };
  }

  const existingItem = findInventoryItem(game, normalizedItemName);

  if (existingItem) {
    const nextAveragePrice = calculateWeightedAverageUnitPrice(
      existingItem.quantity,
      existingItem.avgPurchasePrice ?? existingItem.value,
      requestedQuantity,
      unitPrice
    );

    existingItem.quantity += requestedQuantity;
    existingItem.avgPurchasePrice = nextAveragePrice;
    existingItem.value = nextAveragePrice;
    existingItem.sellValue = nextAveragePrice;
  } else {
    game.inventory.push({
      itemName: normalizedItemName,
      quantity: requestedQuantity,
      avgPurchasePrice: unitPrice,
      value: unitPrice,
      sellValue: unitPrice
    });
  }

  game.cash = Number(game.cash || 0) - totalCost;

  await saveGame(game);

  gameplayLog('trade.buy', {
    gameId: game.id,
    location: game.location,
    itemName: normalizedItemName,
    quantity: requestedQuantity,
    unitPrice,
    totalCost,
    cash: game.cash
  });

  return {
    game,
    trade: {
      action: 'buy',
      itemName: normalizedItemName,
      quantity: requestedQuantity,
      unitPrice,
      totalCost
    }
  };
}

async function sellItem(gameId, itemName, quantity) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;

  if (isRivalBlockedAtSettlement(game, game.location)) {
    return getRivalBlockError(game);
  }

  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const inventoryItem = findInventoryItem(game, normalizedItemName);

  if (!inventoryItem || inventoryItem.quantity < requestedQuantity) {
    return { error: 'bad-request', message: 'Not enough quantity in inventory to sell.' };
  }

  const unitPrice = getEffectiveCommodityUnitPrice(game, normalizedItemName, game.location);

  if (!Number.isFinite(unitPrice)) {
    return { error: 'bad-request', message: 'Unknown commodity.' };
  }

  const totalRevenue = unitPrice * requestedQuantity;
  inventoryItem.quantity -= requestedQuantity;

  if (inventoryItem.quantity <= 0) {
    game.inventory = game.inventory.filter((item) => item !== inventoryItem);
  }

  game.cash = Number(game.cash || 0) + totalRevenue;

  await saveGame(game);

  gameplayLog('trade.sell', {
    gameId: game.id,
    location: game.location,
    itemName: normalizedItemName,
    quantity: requestedQuantity,
    unitPrice,
    totalRevenue,
    cash: game.cash
  });

  return {
    game,
    trade: {
      action: 'sell',
      itemName: normalizedItemName,
      quantity: requestedQuantity,
      unitPrice,
      totalRevenue
    }
  };
}

async function dumpItem(gameId, itemName, quantity) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const inventoryItem = findInventoryItem(game, normalizedItemName);

  if (!inventoryItem || inventoryItem.quantity < requestedQuantity) {
    return { error: 'bad-request', message: 'Not enough quantity in inventory to dump.' };
  }

  inventoryItem.quantity -= requestedQuantity;

  if (inventoryItem.quantity <= 0) {
    game.inventory = game.inventory.filter((item) => item !== inventoryItem);
  }

  await saveGame(game);

  gameplayLog('trade.dump', {
    gameId: game.id,
    location: game.location,
    itemName: normalizedItemName,
    quantity: requestedQuantity
  });

  return {
    game,
    trade: {
      action: 'dump',
      itemName: normalizedItemName,
      quantity: requestedQuantity
    }
  };
}

async function stashItem(gameId, itemName, quantity) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const inventoryItem = findInventoryItem(game, normalizedItemName);

  if (!inventoryItem || inventoryItem.quantity < requestedQuantity) {
    return { error: 'bad-request', message: 'Not enough quantity in inventory to stash.' };
  }

  const hideoutItems = getActiveHideoutItems(game);
  const hideoutStack = findCommodityStack(hideoutItems, normalizedItemName);
  const movedAverage = Number(inventoryItem.avgPurchasePrice ?? inventoryItem.value ?? 0);

  if (hideoutStack) {
    const nextAverage = calculateWeightedAverageUnitPrice(
      hideoutStack.quantity,
      hideoutStack.avgPurchasePrice ?? hideoutStack.value,
      requestedQuantity,
      movedAverage
    );

    hideoutStack.quantity += requestedQuantity;
    hideoutStack.avgPurchasePrice = nextAverage;
    hideoutStack.value = nextAverage;
    hideoutStack.sellValue = nextAverage;
  } else {
    hideoutItems.push({
      itemName: normalizedItemName,
      quantity: requestedQuantity,
      avgPurchasePrice: movedAverage,
      value: movedAverage,
      sellValue: movedAverage
    });
  }

  inventoryItem.quantity -= requestedQuantity;

  if (inventoryItem.quantity <= 0) {
    game.inventory = game.inventory.filter((item) => item !== inventoryItem);
  }

  await saveGame(game);

  gameplayLog('transfer.stash', {
    gameId: game.id,
    location: game.location,
    itemName: normalizedItemName,
    quantity: requestedQuantity
  });

  return {
    game,
    transfer: {
      action: 'stash',
      location: game.location,
      itemName: normalizedItemName,
      quantity: requestedQuantity
    }
  };
}

async function retrieveItem(gameId, itemName, quantity) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const currentUnits = getInventoryItemUnits(game);
  const capacity = Number(game.carryCapacity || getCarryCapacity(game.rank));

  if (currentUnits + requestedQuantity > capacity) {
    return {
      error: 'bad-request',
      message: `Not enough carry space. Capacity ${capacity}, currently carrying ${currentUnits}.`
    };
  }

  const hideoutItems = getActiveHideoutItems(game);
  const hideoutStack = findCommodityStack(hideoutItems, normalizedItemName);

  if (!hideoutStack || hideoutStack.quantity < requestedQuantity) {
    return { error: 'bad-request', message: 'Not enough quantity in hideout to retrieve.' };
  }

  const inventoryItem = findInventoryItem(game, normalizedItemName);
  const movedAverage = Number(hideoutStack.avgPurchasePrice ?? hideoutStack.value ?? 0);

  if (inventoryItem) {
    const nextAverage = calculateWeightedAverageUnitPrice(
      inventoryItem.quantity,
      inventoryItem.avgPurchasePrice ?? inventoryItem.value,
      requestedQuantity,
      movedAverage
    );

    inventoryItem.quantity += requestedQuantity;
    inventoryItem.avgPurchasePrice = nextAverage;
    inventoryItem.value = nextAverage;
    inventoryItem.sellValue = nextAverage;
  } else {
    game.inventory.push({
      itemName: normalizedItemName,
      quantity: requestedQuantity,
      avgPurchasePrice: movedAverage,
      value: movedAverage,
      sellValue: movedAverage
    });
  }

  hideoutStack.quantity -= requestedQuantity;

  if (hideoutStack.quantity <= 0) {
    const locationKey = String(game.location || '').trim().toLowerCase();
    game.hideouts[locationKey] = hideoutItems.filter((item) => item !== hideoutStack);
  }

  await saveGame(game);

  gameplayLog('transfer.retrieve', {
    gameId: game.id,
    location: game.location,
    itemName: normalizedItemName,
    quantity: requestedQuantity
  });

  return {
    game,
    transfer: {
      action: 'retrieve',
      location: game.location,
      itemName: normalizedItemName,
      quantity: requestedQuantity
    }
  };
}

async function getHideout(gameId, settlement) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const selectedSettlement = resolveSettlement(settlement) || resolveSettlement(game.location) || SETTLEMENTS[0];
  const hideoutItems = getHideoutItemsBySettlement(game, selectedSettlement);

  return {
    hideout: {
      currentLocation: game.location,
      location: selectedSettlement,
      items: hideoutItems
    }
  };
}

async function getAllHideouts(gameId) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const bySettlement = {};

  for (const settlement of SETTLEMENTS) {
    const settlementKey = String(settlement).toLowerCase();
    const items = Array.isArray(game.hideouts[settlementKey])
      ? game.hideouts[settlementKey]
      : [];

    bySettlement[settlementKey] = items;
  }

  return {
    hideouts: {
      currentLocation: game.location,
      bySettlement
    }
  };
}

async function getMarket(gameId, settlement) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
  const location = resolveSettlement(settlement) || resolveSettlement(game.location) || SETTLEMENTS[0];
  pruneExpiredMarketConditions(game);

  const commodities = listAvailableCommodities(location).map((commodity) => ({
    itemName: commodity.itemName,
    unitPrice: getEffectiveCommodityUnitPrice(game, commodity.itemName, location)
  }));

  return {
    market: {
      currentLocation: game.location,
      location,
      commodities
    }
  };
}

function sanitizeStateUpdates(updates = {}) {
  const {
    id,
    createdAt,
    updatedAt,
    status,
    endReason,
    endedAt,
    score,
    ...allowed
  } = updates;

  return allowed;
}

async function updateGameState(gameId, updates = {}) {
  const existing = await gameSessionStore.getGame(gameId);

  if (!existing) {
    return { error: 'not-found' };
  }

  const merged = {
    ...existing,
    ...sanitizeStateUpdates(updates)
  };

  normalizeGameState(merged);
  finalizeIfDayLimitReached(merged);

  await saveGame(merged);
  return { game: merged };
}

module.exports = {
  initialize: gameSessionStore.initializeGameStore,
  createGame,
  getGame: gameSessionStore.getGame,
  updateGameState,
  sleep,
  travel,
  heal,
  handleDebtOperation,
  buyItem,
  sellItem,
  dumpItem,
  stashItem,
  retrieveItem,
  getEventLog,
  getMarketPriceHistory,
  getHideout,
  getAllHideouts,
  getMarket,
  validateUpdatePayload,
  settlements: SETTLEMENTS,
  resolveSettlement,
  __setGameplayLoggingForTests: (enabled) => {
    gameplayLoggingEnabled = Boolean(enabled);
  },
  __setRandomNumberGeneratorForTests: (rng) => {
    randomNumberGenerator = typeof rng === 'function' ? rng : Math.random;
  },
  __resetRandomNumberGeneratorForTests: () => {
    randomNumberGenerator = Math.random;
  }
};
