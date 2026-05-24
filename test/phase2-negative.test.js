const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase2-negative');
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

test('Phase 2 guard: buy-item rejects unknown commodity', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/buy-item`)
    .send({ itemName: 'luxury-silk', quantity: 1 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown commodity/i);
});

test('Phase 2 guard: travel rejects unknown settlement alias', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'totally made up city' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement/i);
});

test('Phase 2 guard: hideouts settlement filter rejects unknown alias', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .query({ settlement: 'wrong_place' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement filter/i);
});

test('Phase 2 guard: retrieve-item rejects insufficient stash quantity', async () => {
  const game = await createGame();

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

test('Phase 2 guard: ended game blocks market actions', async () => {
  const game = await createGame();

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
