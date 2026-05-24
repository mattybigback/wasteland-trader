const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase2');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');

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
