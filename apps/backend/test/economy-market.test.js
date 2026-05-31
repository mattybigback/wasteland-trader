const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-economy-market');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');
const { resetTestDataDir, createGame } = require('./helpers/setup');
const { buildSequenceRng } = require('./helpers/rng');

beforeEach(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
  gameService.__resetRandomNumberGeneratorForTests();
});

afterEach(() => {
  gameService.__resetRandomNumberGeneratorForTests();
});

after(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Economy market: weighted average purchase price updates across buys at different settlements', async () => {
  const game = await createGame(request, app, assert);

  const buyAtMarket = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(buyAtMarket.status, 200);

  const travelResponse = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'Vault Refuge' });

  assert.equal(travelResponse.status, 200);
  assert.equal(travelResponse.body.location, 'vault-refuge');

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

test('Economy market: market shows all items on day 1 before any sleep/travel fallback', async () => {
  const game = await createGame(request, app, assert);

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((commodity) => commodity.itemName);
  assert.deepEqual(itemNames.sort(), ['ammo', 'chems', 'food', 'scrap', 'water']);
});

test('Economy market: after sleep, market filters to rolled-available items', async () => {
  const game = await createGame(request, app, assert);

  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));

  await request(app).post(`/games/${game.id}/actions/sleep`).send({});

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((commodity) => commodity.itemName).sort();
  assert.deepEqual(itemNames, ['food', 'water']);
});

test('Economy market: buy-item returns 400 when item is unavailable today', async () => {
  const game = await createGame(request, app, assert);

  await request(app)
    .patch(`/games/${game.id}`)
    .send({ marketAvailability: { 'market-district': { day: 1, items: ['food', 'chems', 'scrap', 'ammo'] } } });

  const buyResponse = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(buyResponse.status, 400);
  assert.match(buyResponse.body.error, /not available at this location today/i);
});

test('Economy market: sell-item returns 400 when item is unavailable today', async () => {
  const game = await createGame(request, app, assert);

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

test('Economy market: item availability rerolls after travel', async () => {
  const game = await createGame(request, app, assert);

  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.0));

  const travelResponse = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'ghost-town' });

  assert.equal(travelResponse.status, 200);

  const marketResponse = await request(app).get(`/games/${game.id}/market`);

  assert.equal(marketResponse.status, 200);
  const itemNames = marketResponse.body.commodities.map((commodity) => commodity.itemName).sort();
  assert.deepEqual(itemNames, ['ammo', 'chems', 'food', 'scrap', 'water']);
});

test('Economy market negative: buy-item rejects unknown commodity', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'luxury-silk', quantity: 1 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown commodity/i);
});

test('Economy market negative: ended game blocks market actions', async () => {
  const game = await createGame(request, app, assert);

  const setupResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({ maxDays: 1 });

  assert.equal(setupResponse.status, 200);
  assert.equal(setupResponse.body.status, 'ended');

  const buyResponse = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(buyResponse.status, 409);
  assert.match(buyResponse.body.error, /already ended/i);
});
