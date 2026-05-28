const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-inventory-hideouts');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const { resetTestDataDir, createGame } = require('./helpers/setup');

beforeEach(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
});

after(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Inventory hideouts: over-capacity blocks travel after demotion lowers carry capacity', async () => {
  const game = await createGame(request, app, assert);

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

test('Inventory hideouts: stash and retrieve supports settlement alias queries', async () => {
  const game = await createGame(request, app, assert);

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

test('Inventory hideouts negative: hideouts settlement filter rejects unknown alias', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .query({ settlement: 'wrong_place' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement filter/i);
});

test('Inventory hideouts negative: retrieve-item rejects insufficient stash quantity', async () => {
  const game = await createGame(request, app, assert);

  const buyResponse = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(buyResponse.status, 200);

  const stashResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(stashResponse.status, 200);

  const retrieveResponse = await request(app)
    .post(`/games/${game.id}/actions/retrieve-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(retrieveResponse.status, 400);
  assert.match(retrieveResponse.body.error, /not enough quantity in hideout/i);
});

test('Inventory hideouts negative: travel rejects unknown settlement alias', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'totally made up city' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement/i);
});
