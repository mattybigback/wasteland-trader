const COMBAT_DEFAULTS = {
  encounterChancePerDay: 0.08,
  raiderEncounterWeight: 0.7,
  debtCollectorTriggerDebt: 500,
  debtCollectorEncounterChance: 0.2,
  runSuccessChance: 0.5,
  basePlayerAttack: 10,
  debtCollectorPayAmount: 200,
  debtCollectorWinDebtReduction: 300,
  debtCollectorLossDebtIncrease: 100
};

const RUN_FAIL_DAMAGE = {
  min: 5,
  max: 12
};

const ENCOUNTER_TEMPLATES = {
  raider: {
    type: 'raider',
    enemyHealth: 26,
    enemyAttack: 12,
    rewardCashMin: 80,
    rewardCashMax: 220,
    surrenderPenaltyRate: 0.5,
    lootChance: 0.7
  },
  sandstorm: {
    type: 'sandstorm',
    enemyHealth: 20,
    enemyAttack: 9,
    rewardCashMin: 40,
    rewardCashMax: 120,
    surrenderPenaltyRate: 0.35,
    lootChance: 0.2
  },
  'debt-collector': {
    type: 'debt-collector',
    enemyHealth: 38,
    enemyAttack: 16,
    rewardCashMin: 0,
    rewardCashMax: 0,
    surrenderPenaltyRate: 0,
    lootChance: 0
  }
};

const GEAR_DEFINITIONS = {
  weapons: {
    shiv: {
      itemType: 'weapon',
      name: 'shiv',
      attackBonus: 4,
      sellValue: 90
    },
    'pipe-rifle': {
      itemType: 'weapon',
      name: 'pipe-rifle',
      attackBonus: 8,
      sellValue: 180
    },
    'assault-rifle': {
      itemType: 'weapon',
      name: 'assault-rifle',
      attackBonus: 14,
      sellValue: 320
    }
  },
  armor: {
    'leather-jacket': {
      itemType: 'armor',
      name: 'leather-jacket',
      defenseBonus: 3,
      sellValue: 120
    },
    'combat-vest': {
      itemType: 'armor',
      name: 'combat-vest',
      defenseBonus: 6,
      sellValue: 240
    },
    'riot-plate': {
      itemType: 'armor',
      name: 'riot-plate',
      defenseBonus: 10,
      sellValue: 420
    }
  }
};

const LOOT_DROPS = [
  'shiv',
  'pipe-rifle',
  'assault-rifle',
  'leather-jacket',
  'combat-vest',
  'riot-plate'
];

function getGearDefinition(name) {
  const normalizedName = String(name || '').trim().toLowerCase();

  return (
    GEAR_DEFINITIONS.weapons[normalizedName] ||
    GEAR_DEFINITIONS.armor[normalizedName] ||
    null
  );
}

module.exports = {
  COMBAT_DEFAULTS,
  RUN_FAIL_DAMAGE,
  ENCOUNTER_TEMPLATES,
  GEAR_DEFINITIONS,
  LOOT_DROPS,
  getGearDefinition
};
