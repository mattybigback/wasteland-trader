const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase5-negative');
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

test('Phase 5 negative: 404 contract returns only error for unknown game id', async () => {
  const response = await request(app)
    .post('/games/unknown-id/actions/sleep')
    .send({});

  assert.equal(response.status, 404);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.game, undefined);
});

test('Phase 5 negative: 409 contract includes game payload for ended game actions', async () => {
  const game = await createGame();

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

test('Phase 5 negative: 400 contract returns error string and no game object', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: -10 });

  assert.equal(response.status, 400);
  assert.equal(typeof response.body.error, 'string');
  assert.equal(response.body.game, undefined);
});

test('Phase 5 negative: buy-item rejects overflow transaction size', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'water', quantity: Number.MAX_SAFE_INTEGER });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /transaction size is too large/i);
});

test('Phase 5 negative: sell-item rejects overflow transaction size', async () => {
  const game = await createGame();

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

test('Phase 5 negative: sell-gear rejects cash overflow', async () => {
  const game = await createGame();

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
