const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase4-negative');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');

async function resetTestDataDir() {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
}

async function createGame() {
  const response = await request(app).post('/games').send({});
  assert.equal(response.status, 201);
  return response.body;
}

beforeEach(async () => {
  await resetTestDataDir();
  gameService.__resetRandomNumberGeneratorForTests();
});

afterEach(() => {
  gameService.__resetRandomNumberGeneratorForTests();
});

after(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Phase 4 negative: combat rejects unknown action', async () => {
  const game = await createGame();

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      currentEncounter: {
        type: 'raider',
        enemyHealth: 18,
        enemyAttack: 8,
        rewardCash: 120,
        lootChance: 0,
        settlement: 'market-district',
        day: 1
      }
    });

  assert.equal(seedResponse.status, 200);

  const response = await request(app)
    .post(`/games/${game.id}/actions/combat`)
    .send({ action: 'dance' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /action must be one of/i);
});

test('Phase 4 negative: combat rejects requests when no active encounter exists', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/combat`)
    .send({ action: 'fight' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /no active encounter/i);
});

test('Phase 4 negative: debt-collector rejects surrender action', async () => {
  const game = await createGame();

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      currentEncounter: {
        type: 'debt-collector',
        enemyHealth: 36,
        enemyAttack: 16,
        rewardCash: 0,
        lootChance: 0,
        settlement: 'market-district',
        day: 1
      }
    });

  assert.equal(seedResponse.status, 200);

  const response = await request(app)
    .post(`/games/${game.id}/actions/combat`)
    .send({ action: 'surrender' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /fight, run, pay/i);
});

test('Phase 4 negative: equip-weapon rejects missing weapon', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/equip-weapon`)
    .send({ weaponName: 'assault-rifle' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /not in unequipped gear/i);
});

test('Phase 4 negative: equip-armor rejects unknown armor name', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/equip-armor`)
    .send({ armorName: 'paper-hat' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown armor/i);
});

test('Phase 4 negative: sell-gear requires both itemType and name', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/sell-gear`)
    .send({ itemType: 'weapon' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /itemtype and name are required/i);
});

test('Phase 4 negative: pending encounter locks all non-combat actions', async () => {
  const game = await createGame();

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      currentEncounter: {
        type: 'raider',
        enemyHealth: 18,
        enemyAttack: 8,
        rewardCash: 120,
        lootChance: 0,
        settlement: 'market-district',
        day: 1
      },
      cash: 5000,
      inventory: [{ itemName: 'water', quantity: 5, avgPurchasePrice: 30, value: 30, sellValue: 30 }],
      unequippedGear: [{ itemType: 'weapon', name: 'pipe-rifle' }]
    });

  assert.equal(seedResponse.status, 200);

  const blockedActions = [
    () => request(app).post(`/games/${game.id}/actions/sleep`).send({}),
    () => request(app).post(`/games/${game.id}/actions/travel`).send({ destination: 'trading-post' }),
    () => request(app).post(`/games/${game.id}/actions/heal`).send({ percentage: 10 }),
    () => request(app).post(`/games/${game.id}/actions/buy-item`).send({ itemName: 'water', quantity: 1 }),
    () => request(app).post(`/games/${game.id}/actions/sell-item`).send({ itemName: 'water', quantity: 1 }),
    () => request(app).post(`/games/${game.id}/actions/dump-item`).send({ itemName: 'water', quantity: 1 }),
    () => request(app).post(`/games/${game.id}/actions/stash-item`).send({ itemName: 'water', quantity: 1 }),
    () => request(app).post(`/games/${game.id}/actions/retrieve-item`).send({ itemName: 'water', quantity: 1 }),
    () => request(app).post(`/games/${game.id}/actions/equip-weapon`).send({ weaponName: 'pipe-rifle' }),
    () => request(app).post(`/games/${game.id}/actions/sell-gear`).send({ itemType: 'weapon', name: 'pipe-rifle' }),
    () => request(app).post(`/games/${game.id}/debt`).send({ mode: 'quote', amount: 100 }),
    () => request(app).post(`/games/${game.id}/debt`).send({ mode: 'pay', amount: 100 })
  ];

  for (const execute of blockedActions) {
    const response = await execute();
    assert.equal(response.status, 400);
    assert.match(response.body.error, /must resolve the active/i);
  }
});
