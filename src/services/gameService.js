const gameSessionStore = require('../storage/gameSessionStore');
const {
  getRankThreshold,
  getCarryCapacity,
  getCommodityUnitPrice,
  listAvailableCommodities
} = require('../models/economy');

const SETTLEMENTS = [
  'market-district',
  'raider-camp',
  'vault-refuge',
  'trading-post',
  'ghost-town'
];

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

function normalizeGameState(game) {
  ensureRankBonusFields(game);
  ensureRankProgressFields(game);
  ensureInventoryFields(game);
  ensureHideoutFields(game);

  game.rank = Number(game.rank || 0);
  game.carryCapacity = getCarryCapacity(game.rank);
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

async function advanceDay(gameId, mutateGame) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;

  if (typeof mutateGame === 'function') {
    mutateGame(game);
  }

  finalizeIfDayLimitReached(game);

  if (game.status === 'active') {
    game.day = Number(game.day || 1) + 1;
    applyDailyMaintenance(game);
    applyRankProgressForDay(game);
    finalizeIfDayLimitReached(game);
  }

  await saveGame(game);
  return { game };
}

async function sleep(gameId) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  if (isOverCarryCapacity(loaded.game)) {
    return getOverCapacityError(loaded.game);
  }

  return advanceDay(gameId, (game) => {
    game.health = Math.min(100, Number(game.health || 0) + 5);
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

  return advanceDay(gameId, (game) => {
    game.location = normalizedDestination;
  });
}

async function heal(gameId, percentage) {
  const loaded = await loadActiveGame(gameId);

  if (loaded.error) {
    return loaded;
  }

  const game = loaded.game;
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
  const normalizedItemName = String(itemName || '').trim().toLowerCase();
  const requestedQuantity = Number(quantity);

  if (!normalizedItemName) {
    return { error: 'bad-request', message: 'itemName is required.' };
  }

  if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
    return { error: 'bad-request', message: 'quantity must be a positive integer.' };
  }

  const unitPrice = getCommodityUnitPrice(normalizedItemName, game.location);

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

  const unitPrice = getCommodityUnitPrice(normalizedItemName, game.location);

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

  return {
    market: {
      currentLocation: game.location,
      location,
      commodities: listAvailableCommodities(location)
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
  createGame: gameSessionStore.createGame,
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
  getHideout,
  getAllHideouts,
  getMarket,
  validateUpdatePayload,
  settlements: SETTLEMENTS,
  resolveSettlement
};
