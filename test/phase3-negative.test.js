const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase3-negative');
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

// --- Events endpoint negative tests ---

test('Phase 3 guard: events endpoint rejects non-integer day filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ day: 'not-a-number' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /day filter must be a positive integer/i);
});

test('Phase 3 guard: events endpoint rejects zero or negative day filter', async () => {
  const game = await createGame();

  const zeroResponse = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ day: 0 });

  assert.equal(zeroResponse.status, 400);
  assert.match(zeroResponse.body.error, /day filter must be a positive integer/i);

  const negativeResponse = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ day: -5 });

  assert.equal(negativeResponse.status, 400);
  assert.match(negativeResponse.body.error, /day filter must be a positive integer/i);
});

test('Phase 3 guard: events endpoint rejects unknown settlement filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ settlement: 'made-up-place' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement filter/i);
});

test('Phase 3 guard: events endpoint rejects non-integer limit filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ limit: 'not-an-int' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /limit filter must be a positive integer/i);
});

test('Phase 3 guard: events endpoint rejects zero or negative limit filter', async () => {
  const game = await createGame();

  const zeroResponse = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ limit: 0 });

  assert.equal(zeroResponse.status, 400);
  assert.match(zeroResponse.body.error, /limit filter must be a positive integer/i);

  const negativeResponse = await request(app)
    .get(`/games/${game.id}/events`)
    .query({ limit: -10 });

  assert.equal(negativeResponse.status, 400);
  assert.match(negativeResponse.body.error, /limit filter must be a positive integer/i);
});

// --- Market history endpoint negative tests ---

test('Phase 3 guard: market-history rejects unknown settlement filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ settlement: 'unknown-place' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement filter/i);
});

test('Phase 3 guard: market-history rejects unknown commodity filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ itemName: 'luxury-silk' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown commodity filter/i);
});

test('Phase 3 guard: market-history rejects non-integer fromDay filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ fromDay: 'abc' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /fromDay filter must be a positive integer/i);
});

test('Phase 3 guard: market-history rejects zero or negative fromDay filter', async () => {
  const game = await createGame();

  const zeroResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ fromDay: 0 });

  assert.equal(zeroResponse.status, 400);
  assert.match(zeroResponse.body.error, /fromDay filter must be a positive integer/i);

  const negativeResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ fromDay: -1 });

  assert.equal(negativeResponse.status, 400);
  assert.match(negativeResponse.body.error, /fromDay filter must be a positive integer/i);
});

test('Phase 3 guard: market-history rejects non-integer toDay filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ toDay: 'xyz' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /toDay filter must be a positive integer/i);
});

test('Phase 3 guard: market-history rejects zero or negative toDay filter', async () => {
  const game = await createGame();

  const zeroResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ toDay: 0 });

  assert.equal(zeroResponse.status, 400);
  assert.match(zeroResponse.body.error, /toDay filter must be a positive integer/i);

  const negativeResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ toDay: -3 });

  assert.equal(negativeResponse.status, 400);
  assert.match(negativeResponse.body.error, /toDay filter must be a positive integer/i);
});

test('Phase 3 guard: market-history rejects fromDay > toDay', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ fromDay: 10, toDay: 5 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /fromDay must be less than or equal to toDay/i);
});

test('Phase 3 guard: market-history rejects day window exceeding maximum', async () => {
  const game = await createGame();

  // 121-day window should exceed 120-day max
  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ fromDay: 1, toDay: 121 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /exceeds maximum of 120 days/i);
});

test('Phase 3 guard: market-history rejects non-integer limit filter', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ limit: 'not-int' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /limit filter must be a positive integer/i);
});

test('Phase 3 guard: market-history rejects zero or negative limit filter', async () => {
  const game = await createGame();

  const zeroResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ limit: 0 });

  assert.equal(zeroResponse.status, 400);
  assert.match(zeroResponse.body.error, /limit filter must be a positive integer/i);

  const negativeResponse = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ limit: -5 });

  assert.equal(negativeResponse.status, 400);
  assert.match(negativeResponse.body.error, /limit filter must be a positive integer/i);
});

test('Phase 3 guard: market-history with multiple invalid filters reports first error', async () => {
  const game = await createGame();

  const response = await request(app)
    .get(`/games/${game.id}/market-history`)
    .query({ settlement: 'invalid', itemName: 'invalid-item' });

  assert.equal(response.status, 400);
  // Settlement is checked first in the code, so it should error first
  assert.match(response.body.error, /unknown settlement filter/i);
});
