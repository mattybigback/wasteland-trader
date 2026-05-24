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

module.exports = {
  RANK_THRESHOLDS,
  getRankThreshold,
  getCarryCapacity,
  getCommodityUnitPrice,
  listAvailableCommodities
};
