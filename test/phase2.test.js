const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase2');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');

function buildSequenceRng(values, fallback = 0.99) {
  const sequence = Array.isArray(values) ? [...values] : [];
  let index = 0;

  return () => {
    if (index < sequence.length) {
      const value = sequence[index];
      index += 1;
      return value;
    }

    return fallback;
  };
}

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

after(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Phase 2: weighted average purchase price updates across buys at different settlements', async () => {
  const game = await createGame();

  const buyAtMarket = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(buyAtMarket.status, 200);

  const travelResponse = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'Vault Refuge' });

  assert.equal(travelResponse.status, 200);
  assert.equal(travelResponse.body.location, 'vault-refuge');

  // Force water available at vault-refuge for the current day so this test is deterministic.
  await request(app)
    .patch(`/games/${game.id}`)
    .send({
      marketAvailability: {
        'vault-refuge': { day: travelResponse.body.day, items: ['water', 'food', 'chems', 'scrap', 'ammo'] }
      }
    });

  const buyAtVault = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(buyAtVault.status, 200);

  const waterStack = buyAtVault.body.game.inventory.find((item) => item.itemName === 'water');
  assert.ok(waterStack);
  assert.equal(waterStack.quantity, 3);
  assert.equal(waterStack.avgPurchasePrice, 32);
});

test('Phase 2: over-capacity blocks travel after demotion lowers carry capacity', async () => {
  const game = await createGame();

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      rank: 1,
      carryCapacity: 15,
      cash: 4000,
      rankDemotionStreak: 2,
      inventory: [
        {
          itemName: 'water',
          quantity: 12,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const sleepResponse = await request(app)
    .post(`/games/${game.id}/actions/sleep`)
    .send({});

  assert.equal(sleepResponse.status, 200);
  assert.equal(sleepResponse.body.rank, 0);
  assert.equal(sleepResponse.body.carryCapacity, 10);

  const blockedTravel = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'trading-post' });

  assert.equal(blockedTravel.status, 400);
  assert.match(blockedTravel.body.error, /over carry capacity/i);
});

test('Phase 2: stash/retrieve and settlement alias queries work for hideouts', async () => {
  const game = await createGame();

  const buyResponse = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 3 });

  assert.equal(buyResponse.status, 200);

  const stashResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(stashResponse.status, 200);

  const hideoutAlias = await request(app)
    .get(`/games/${game.id}/hideout`)
    .query({ settlement: 'Market District' });

  assert.equal(hideoutAlias.status, 200);
  assert.equal(hideoutAlias.body.location, 'market-district');
  assert.equal(hideoutAlias.body.items[0].quantity, 2);

  const retrieveResponse = await request(app)
    .post(`/games/${game.id}/actions/retrieve-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(retrieveResponse.status, 200);

  const hideoutsAlias = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .query({ settlement: 'market_district' });

  assert.equal(hideoutsAlias.status, 200);
  assert.equal(hideoutsAlias.body.settlement, 'market-district');
  assert.equal(hideoutsAlias.body.items[0].quantity, 1);
});

// --- Item availability tests ---

test('Phase 2 availability: market shows all items on day 1 before any sleep/travel (fallback)', async () => {
  const game = await createGame();

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((c) => c.itemName);
  assert.deepEqual(itemNames.sort(), ['ammo', 'chems', 'food', 'scrap', 'water']);
});

test('Phase 2 availability: after sleep, market filters to rolled-available items', async () => {
  const game = await createGame();

  // All RNG values 0.99. At market-district: water(1.0) and food(1.0) are available
  // (0.99 < 1.0 = true); chems(0.7), scrap(0.8), ammo(0.8) are not (0.99 >= those).
  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));

  await request(app).post(`/games/${game.id}/actions/sleep`).send({});

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((c) => c.itemName).sort();
  assert.deepEqual(itemNames, ['food', 'water']);
});

test('Phase 2 availability: buy-item returns 400 when item is unavailable today', async () => {
  const game = await createGame();

  // Seed marketAvailability to mark water unavailable at market-district on day 1
  await request(app)
    .patch(`/games/${game.id}`)
    .send({ marketAvailability: { 'market-district': { day: 1, items: ['food', 'chems', 'scrap', 'ammo'] } } });

  const buyResponse = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(buyResponse.status, 400);
  assert.match(buyResponse.body.error, /not available at this location today/i);
});

test('Phase 2 availability: sell-item returns 400 when item is unavailable today', async () => {
  const game = await createGame();

  // Seed inventory with water, then mark water unavailable
  await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [{ itemName: 'water', quantity: 3, avgPurchasePrice: 30, value: 30, sellValue: 30 }],
      marketAvailability: { 'market-district': { day: 1, items: ['food', 'chems', 'scrap', 'ammo'] } }
    });

  const sellResponse = await request(app)
    .post(`/games/${game.id}/actions/sell-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(sellResponse.status, 400);
  assert.match(sellResponse.body.error, /not available at this location today/i);
});

test('Phase 2 availability: item available after travel rolls fresh availability', async () => {
  const game = await createGame();

  // All 0.0 — every availability roll passes regardless of probability
  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.0));

  const travelResponse = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'ghost-town' });

  assert.equal(travelResponse.status, 200);

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((c) => c.itemName).sort();
  assert.deepEqual(itemNames, ['ammo', 'chems', 'food', 'scrap', 'water']);
});
