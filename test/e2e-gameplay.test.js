const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-e2e');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');
const { resetTestDataDir, createGame } = require('./helpers/setup');
const { buildSequenceRng } = require('./helpers/rng');
const { assertStatus, assertErrorContains } = require('./helpers/assertions');
const { buildGameApi } = require('./helpers/api');

beforeEach(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
  gameService.__resetRandomNumberGeneratorForTests();
});

afterEach(() => {
  gameService.__resetRandomNumberGeneratorForTests();
});

after(async () => {
  await resetTestDataDir(TEST_DATA_DIR);
});

test('E2E gameplay: trading, hideouts, travel, and debt repayment work together', async () => {
  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));

  const game = await createGame(request, app, assert);
  const api = buildGameApi(request, app, game.id);

  const buyWater = await api.buy('water', 3);
  assertStatus(assert, buyWater, 200);

  const stashWater = await api.stash('water', 2);
  assertStatus(assert, stashWater, 200);

  const hideout = await api.hideout('Market District');
  assertStatus(assert, hideout, 200);
  assert.equal(hideout.body.location, 'market-district');
  assert.equal(hideout.body.items[0].itemName, 'water');
  assert.equal(hideout.body.items[0].quantity, 2);

  const retrieveWater = await api.retrieve('water', 1);
  assertStatus(assert, retrieveWater, 200);

  const travel = await api.travel('vault refuge');
  assertStatus(assert, travel, 200);
  assert.equal(travel.body.location, 'vault-refuge');

  const forceAvailability = await api.patch({
    marketAvailability: {
      'vault-refuge': {
        day: travel.body.day,
        items: ['water', 'food', 'chems', 'scrap', 'ammo']
      }
    }
  });
  assertStatus(assert, forceAvailability, 200);

  const sellWater = await api.sell('water', 1);
  assertStatus(assert, sellWater, 200);
  assert.equal(sellWater.body.trade.action, 'sell');

  const debtQuote = await api.debt('quote', 100);
  assertStatus(assert, debtQuote, 200);

  const debtPay = await api.debt('pay', 100);
  assertStatus(assert, debtPay, 200);
  assert.equal(debtPay.body.repayment.principalPaid, 100);
  assert.equal(debtPay.body.repayment.totalCost, debtQuote.body.totalCost);
  assert.equal(debtPay.body.repayment.remainingDebt, debtQuote.body.currentDebt - 100);
});

test('E2E gameplay: encounter lock enforces combat resolution before non-combat actions', async () => {
  const game = await createGame(request, app, assert);
  const api = buildGameApi(request, app, game.id);

  const seedEncounter = await api.patch({
    debt: 1200,
    currentEncounter: {
      type: 'debt-collector',
      enemyHealth: 30,
      enemyAttack: 14,
      rewardCash: 0,
      lootChance: 0,
      settlement: 'market-district',
      day: 1
    }
  });
  assertStatus(assert, seedEncounter, 200);

  const blockedHeal = await api.heal(10);
  assertErrorContains(assert, blockedHeal, 400, /must resolve the active .*encounter/i);

  const payCollector = await api.combat('pay');
  assertStatus(assert, payCollector, 200);
  assert.equal(payCollector.body.combatResult.outcome, 'paid-off');
  assert.equal(payCollector.body.game.currentEncounter, null);

  const encounterState = await api.encounter();
  assertStatus(assert, encounterState, 200);
  assert.equal(encounterState.body.encounter, null);

  const unlockedBuy = await api.buy('water', 1);
  assertStatus(assert, unlockedBuy, 200);
});

test('E2E gameplay: day progression reaches endgame and locks subsequent actions', async () => {
  gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));

  const game = await createGame(request, app, assert);
  const api = buildGameApi(request, app, game.id);

  const debtSeed = await api.patch({ debt: 0, debtDueDay: 99 });
  assertStatus(assert, debtSeed, 200);

  let latest = null;
  for (let day = 0; day < 29; day += 1) {
    const sleep = await api.sleep();
    assertStatus(assert, sleep, 200);
    latest = sleep.body;
  }

  assert.ok(latest);
  assert.equal(latest.day, 30);
  assert.equal(latest.status, 'ended');

  const blockedTravel = await api.travel('trading-post');
  assertStatus(assert, blockedTravel, 409);
  assert.equal(typeof blockedTravel.body.error, 'string');
  assert.equal(blockedTravel.body.game.status, 'ended');
});
