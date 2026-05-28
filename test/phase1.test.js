const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase1');
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
  assert.ok(response.body.id);
  return response.body;
}

beforeEach(async () => {
  await resetTestDataDir();
  gameService.__setRandomNumberGeneratorForTests(() => 0.99);
});

after(async () => {
  gameService.__resetRandomNumberGeneratorForTests();
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Phase 1: sleep advances day and applies daily maintenance', async () => {
  const game = await createGame();

  const sleepResponse = await request(app)
    .post(`/games/${game.id}/actions/sleep`)
    .send({});

  assert.equal(sleepResponse.status, 200);
  assert.equal(sleepResponse.body.day, 2);
  assert.equal(sleepResponse.body.cash, 1990);
  assert.equal(sleepResponse.body.debt, 1150);
  assert.equal(sleepResponse.body.health, 100);
  assert.equal(sleepResponse.body.status, 'active');
});

test('Phase 1: heal restores health and costs caps without advancing day', async () => {
  const game = await createGame();

  const patched = await request(app)
    .patch(`/games/${game.id}`)
    .send({ health: 70, cash: 2000 });

  assert.equal(patched.status, 200);

  const healResponse = await request(app)
    .post(`/games/${game.id}/actions/heal`)
    .send({ percentage: 20 });

  assert.equal(healResponse.status, 200);
  assert.equal(healResponse.body.day, 1);
  assert.equal(healResponse.body.health, 90);
  assert.equal(healResponse.body.cash, 1600);
});

test('Phase 1: debt quote/pay workflow returns consistent repayment math', async () => {
  const game = await createGame();

  const quoteResponse = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ mode: 'quote', amount: 500 });

  assert.equal(quoteResponse.status, 200);
  assert.equal(quoteResponse.body.principalPaid, 500);
  assert.equal(
    quoteResponse.body.totalCost,
    quoteResponse.body.principalPaid + quoteResponse.body.earlyRepaymentFee
  );
  assert.equal(quoteResponse.body.currentDebt, 1000);

  const payResponse = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ mode: 'pay', amount: 500 });

  assert.equal(payResponse.status, 200);
  assert.equal(payResponse.body.repayment.principalPaid, 500);
  assert.equal(payResponse.body.repayment.earlyRepaymentFee, quoteResponse.body.earlyRepaymentFee);
  assert.equal(payResponse.body.repayment.totalCost, quoteResponse.body.totalCost);
  assert.equal(payResponse.body.repayment.remainingDebt, 500);
  assert.equal(payResponse.body.game.cash, 2000 - quoteResponse.body.totalCost);
});
