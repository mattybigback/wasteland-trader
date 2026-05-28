const path = require('node:path');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { ensureDirectory, readJsonFile, writeJsonFile } = require('./jsonFileStore');

const GAME_SESSIONS_DIR = process.env.GAME_SESSIONS_DIR
  ? path.resolve(process.env.GAME_SESSIONS_DIR)
  : path.resolve(process.cwd(), 'data', 'games');

function gameFilePath(gameId) {
  return path.join(GAME_SESSIONS_DIR, `${gameId}.json`);
}

async function initializeGameStore() {
  await ensureDirectory(GAME_SESSIONS_DIR);
}

function buildDefaultGame() {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    day: 1,
    maxDays: 30,
    extraDaysFromRanks: 0,
    rank: 0,
    highestRankAchieved: 0,
    rankBonusAwardedFor: [],
    rankPromotionStreak: 0,
    rankDemotionStreak: 0,
    cash: 2000,
    debt: 1000,
    debtInterestRateDaily: 0.15,
    debtDueDay: 8,
    debtWarnings: 0,
    health: 100,
    armor: 0,
    carryCapacity: 10,
    location: 'market-district',
    inventory: [],
    hideouts: {},
    weapons: [],
    equippedWeapon: null,
    equippedArmor: null,
    unequippedGear: [],
    currentEncounter: null,
    eventLog: [],
    lastEventTriggerDay: 0,
    marketConditions: {},
    marketAvailability: {},
    marketPriceHistory: [],
    status: 'active',
    endReason: null,
    endedAt: null,
    score: null
  };
}

async function createGame(overrides = {}) {
  const game = {
    ...buildDefaultGame(),
    ...overrides
  };

  await saveGame(game);
  return game;
}

async function getGame(gameId) {
  try {
    return await readJsonFile(gameFilePath(gameId));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function sanitizeUpdates(updates = {}) {
  const { id, createdAt, updatedAt, ...allowedUpdates } = updates;
  return allowedUpdates;
}

async function updateGame(gameId, updates = {}) {
  const existing = await getGame(gameId);

  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const updatedGame = {
    ...existing,
    ...sanitizeUpdates(updates),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  await saveGame(updatedGame);
  return updatedGame;
}

async function saveGame(game) {
  await writeJsonFile(gameFilePath(game.id), game);
}

async function gameExists(gameId) {
  try {
    await fs.access(gameFilePath(gameId));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

module.exports = {
  initializeGameStore,
  createGame,
  getGame,
  updateGame,
  saveGame,
  gameExists
};
