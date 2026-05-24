const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase1-negative');
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

test('Phase 1 guard: heal rejects invalid percentage payload', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: 15 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /multiple of 10/i);
});

test('Phase 1 guard: debt mode is required and validated', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ amount: 100 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /mode must be either/i);
});

test('Phase 1 guard: debt payment rejects insufficient caps for repayment total', async () => {
  const game = await createGame();

  const response = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ mode: 'pay', amount: 5000 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /not enough caps/i);
});

test('Phase 1 guard: ended game blocks additional sleep action', async () => {
  const game = await createGame();

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
