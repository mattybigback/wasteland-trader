const EVENT_PROBABILITIES = {
  luckyFind: 0.05,
  scavengedCache: 0.03,
  illness: 0.04,
  shakedown: 0.03,
  marketRiseSignal: 0.025,
  marketDropSignal: 0.025,
  weaponDamage: 0.02,
  ammoStash: 0.02,
  friendlyEncounter: 0.02,
  rivalEncounter: 0.01,
  nighttimeRobbery: 0.02,
  pickpocket: 0.015,
  settlementUnrest: 0.015,
  supplyShortage: 0.015
};

const EVENT_SEVERITY_RANGES = {
  nighttimeRobbery: {
    percentMin: 8,
    percentMax: 20
  },
  pickpocket: {
    percentMin: 3,
    percentMax: 8
  },
  settlementUnrest: {
    percentMin: 2,
    percentMax: 8
  },
  supplyShortage: {
    multiplierMin: 2,
    multiplierMax: 6
  }
};

const EVENT_REWARD_RANGES = {
  ammoStash: {
    quantityMin: 1,
    quantityMax: 3
  },
  friendlyEncounter: {
    quantityMin: 1,
    quantityMax: 2
  }
};

const RUMOR_RELIABILITY = {
  levelOne: 0.4,
  topLevel: 0.9,
  topRankLevel: 5
};

const MARKET_MULTIPLIER_RANGES = {
  scarcity: {
    baseMin: 4,
    baseMax: 20,
    fuzzMin: 0.92,
    fuzzMax: 1.08,
    clampMin: 4,
    clampMax: 20
  },
  abundance: {
    baseMin: 0.08,
    baseMax: 0.3,
    fuzzMin: 0.85,
    fuzzMax: 1.15,
    clampMin: 0.05,
    clampMax: 0.4
  }
};

module.exports = {
  EVENT_PROBABILITIES,
  EVENT_SEVERITY_RANGES,
  EVENT_REWARD_RANGES,
  RUMOR_RELIABILITY,
  MARKET_MULTIPLIER_RANGES
};