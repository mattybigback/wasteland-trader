const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-debt-progression');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');
const { resetTestDataDir, createGame } = require('./helpers/setup');

beforeEach(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
  gameService.__setRandomNumberGeneratorForTests(() => 0.99);
});

after(async () => {
  gameService.__resetRandomNumberGeneratorForTests();
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

test('Debt/progression: sleep advances day and applies daily maintenance', async () => {
  const game = await createGame(request, app, assert);

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

test('Debt/progression: heal restores health and costs caps without advancing day', async () => {
  const game = await createGame(request, app, assert);

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

test('Debt/progression: debt quote/pay workflow returns consistent repayment math', async () => {
  const game = await createGame(request, app, assert);

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

test('Debt/progression: debt mode is required and validated', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ amount: 100 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /mode must be either/i);
});

test('Debt/progression: debt payment rejects insufficient caps for repayment total', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/debt`)
    .send({ mode: 'pay', amount: 5000 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /not enough caps/i);
});
