const RANK_THRESHOLDS = {
  0: 0,
  1: 5000,
  2: 10000,
  3: 20000,
  4: 40000,
  5: 80000
};

const CARRY_CAPACITY_BY_RANK = {
  0: 10,
  1: 15,
  2: 20,
  3: 25,
  4: 30,
  5: 35
};

const COMMODITY_BASE_PRICES = {
  water: 30,
  food: 50,
  chems: 200,
  scrap: 120,
  ammo: 80
};

const SETTLEMENT_PRICE_MULTIPLIER = {
  'market-district': 1.0,
  'raider-camp': 0.85,
  'vault-refuge': 1.15,
  'trading-post': 1.2,
  'ghost-town': 0.75
};

// Availability probability per item, per settlement.
// 'default' applies to any settlement not listed.
// 0 = never available; 1 = always available.
const COMMODITY_AVAILABILITY = {
  water: {
    default: 0.9,
    'market-district': 1.0,
    'trading-post': 1.0,
    'vault-refuge': 0.95,
    'raider-camp': 0.5,
    'ghost-town': 0.4
  },
  food: {
    default: 0.85,
    'market-district': 1.0,
    'trading-post': 0.95,
    'vault-refuge': 0.9,
    'raider-camp': 0.3,
    'ghost-town': 0.35
  },
  chems: {
    default: 0.55,
    'market-district': 0.7,
    'trading-post': 0.6,
    'vault-refuge': 0.2,
    'raider-camp': 0.9,
    'ghost-town': 0.5
  },
  scrap: {
    default: 0.75,
    'market-district': 0.8,
    'trading-post': 0.85,
    'vault-refuge': 0.4,
    'raider-camp': 0.9,
    'ghost-town': 0.7
  },
  ammo: {
    default: 0.65,
    'market-district': 0.8,
    'trading-post': 0.75,
    'vault-refuge': 0.3,
    'raider-camp': 0.95,
    'ghost-town': 0.45
  }
};

function getRankThreshold(rank) {
  return Number(RANK_THRESHOLDS[rank] ?? Number.MAX_SAFE_INTEGER);
}

function getCarryCapacity(rank) {
  return Number(CARRY_CAPACITY_BY_RANK[rank] ?? CARRY_CAPACITY_BY_RANK[0]);
}

function getCommodityUnitPrice(itemName, settlement) {
  const normalizedItem = String(itemName || '').trim().toLowerCase();
  const normalizedSettlement = String(settlement || '').trim().toLowerCase();

  const basePrice = COMMODITY_BASE_PRICES[normalizedItem];
  const settlementMultiplier = SETTLEMENT_PRICE_MULTIPLIER[normalizedSettlement] ?? 1;

  if (!Number.isFinite(basePrice)) {
    return null;
  }

  return Math.round(basePrice * settlementMultiplier);
}

function listAvailableCommodities(settlement) {
  return Object.keys(COMMODITY_BASE_PRICES).map((itemName) => ({
    itemName,
    unitPrice: getCommodityUnitPrice(itemName, settlement)
  }));
}

function getCommodityAvailabilityChance(itemName, settlement) {
  const normalizedItem = String(itemName || '').trim().toLowerCase();
  const normalizedSettlement = String(settlement || '').trim().toLowerCase();

  const itemAvailability = COMMODITY_AVAILABILITY[normalizedItem];

  if (!itemAvailability) {
    return 0;
  }

  const chance = Object.prototype.hasOwnProperty.call(itemAvailability, normalizedSettlement)
    ? itemAvailability[normalizedSettlement]
    : itemAvailability.default ?? 1;

  return Number(chance);
}

module.exports = {
  RANK_THRESHOLDS,
  getRankThreshold,
  getCarryCapacity,
  getCommodityUnitPrice,
  listAvailableCommodities,
  getCommodityAvailabilityChance,
  COMMODITY_BASE_PRICES
};
