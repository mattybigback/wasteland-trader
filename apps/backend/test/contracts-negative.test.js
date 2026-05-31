const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-contracts-negative');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');
const { resetTestDataDir, createGame } = require('./helpers/setup');

beforeEach(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
  gameService.__setRandomNumberGeneratorForTests(() => 0.99);
});

afterEach(() => {
  gameService.__resetRandomNumberGeneratorForTests();
});

after(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Contracts negative: heal rejects invalid percentage payload', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: 15 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /multiple of 10/i);
});

test('Contracts negative: ended game blocks additional sleep action', async () => {
  const game = await createGame(request, app, assert);

  const setupResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({ maxDays: 1 });

  assert.equal(setupResponse.status, 200);
  assert.equal(setupResponse.body.status, 'ended');

  const sleepResponse = await request(app)
    .post(`/games/${game.id}/actions/sleep`)
    .send({});

  assert.equal(sleepResponse.status, 409);
  assert.match(sleepResponse.body.error, /already ended/i);
});

test('Contracts negative: 404 contract returns only error for unknown game id', async () => {
  const response = await request(app)
    .post('/games/unknown-id/actions/sleep')
    .send({});

  assert.equal(response.status, 404);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.game, undefined);
});

test('Contracts negative: 409 contract includes game payload for ended game actions', async () => {
  const game = await createGame(request, app, assert);

  const patchResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({ day: 30, maxDays: 30 });

  assert.equal(patchResponse.status, 200);
  assert.equal(patchResponse.body.status, 'ended');

  const response = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: 10 });

  assert.equal(response.status, 409);
  assert.equal(typeof response.body.error, 'string');
  assert.ok(response.body.game);
  assert.equal(response.body.game.status, 'ended');
});

test('Contracts negative: 400 contract returns error string and no game object', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: -10 });

  assert.equal(response.status, 400);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.game, undefined);
});

test('Contracts negative: buy-item rejects overflow transaction size', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: Number.MAX_SAFE_INTEGER });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /transaction size is too large/i);
});

test('Contracts negative: sell-item rejects overflow transaction size', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: Number.MAX_SAFE_INTEGER,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ],
      marketAvailability: {
        'market-district': {
          day: 1,
          items: ['water']
        }
      }
    });

  assert.equal(seedResponse.status, 200);

  const response = await request(app)
    .post(`/games/${game.id}/actions/sell-item`)
    .send({ itemName: 'water', quantity: Number.MAX_SAFE_INTEGER });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /transaction size is too large/i);
});

test('Contracts negative: sell-gear rejects cash overflow', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      cash: Number.MAX_SAFE_INTEGER,
      unequippedGear: [{ itemType: 'weapon', name: 'pipe-rifle' }]
    });

  assert.equal(seedResponse.status, 200);

  const response = await request(app)
    .post(`/games/${game.id}/actions/sell-gear`)
    .send({ itemType: 'weapon', name: 'pipe-rifle' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /would exceed cash limit/i);
});
