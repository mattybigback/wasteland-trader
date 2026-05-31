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

test('Inventory hideouts: travel always advances the day per settlement move', async () => {
  const game = await createGame(request, app, assert);

  const dayTwoTravel = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'vault-refuge' });

  assert.equal(dayTwoTravel.status, 200);
  assert.equal(dayTwoTravel.body.day, 2);
  assert.equal(dayTwoTravel.body.location, 'vault-refuge');

  const dayThreeTravel = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'trading-post' });

  assert.equal(dayThreeTravel.status, 200);
  assert.equal(dayThreeTravel.body.day, 3);
  assert.equal(dayThreeTravel.body.location, 'trading-post');
});

test('Inventory hideouts: stash mutates only current-settlement hideout', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 3,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ],
      hideouts: {
        'trading-post': [
          {
            itemName: 'water',
            quantity: 5,
            avgPurchasePrice: 20,
            value: 20,
            sellValue: 20
          }
        ]
      }
    });

  assert.equal(seedResponse.status, 200);

  const stashResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(stashResponse.status, 200);

  const hideoutsResponse = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .send();

  assert.equal(hideoutsResponse.status, 200);
  assert.equal(hideoutsResponse.body.bySettlement['market-district'][0].quantity, 2);
  assert.equal(hideoutsResponse.body.bySettlement['trading-post'][0].quantity, 5);
});

test('Inventory hideouts: atomic transaction supports mixed stash and retrieve with alias queries', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 3,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const transactionResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({
      operations: [
        { action: 'stash', itemName: 'water', quantity: 2 },
        { action: 'retrieve', itemName: 'water', quantity: 1 }
      ]
    });

  assert.equal(transactionResponse.status, 200);
  assert.equal(transactionResponse.body.transfer.operations.length, 2);

  const hideoutAlias = await request(app)
    .get(`/games/${game.id}/hideout`)
    .query({ settlement: 'Market District' });

  assert.equal(hideoutAlias.status, 200);
  assert.equal(hideoutAlias.body.location, 'market-district');
  assert.equal(hideoutAlias.body.items[0].quantity, 1);

  const hideoutsAlias = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .query({ settlement: 'market_district' });

  assert.equal(hideoutsAlias.status, 200);
  assert.equal(hideoutsAlias.body.settlement, 'market-district');
  assert.equal(hideoutsAlias.body.items[0].quantity, 1);
});

test('Inventory hideouts: atomic transaction can transfer every commodity in both directions', async () => {
  const game = await createGame(request, app, assert);
  const commodityNames = ['water', 'food', 'chems', 'scrap', 'ammo'];

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: commodityNames.map((itemName) => ({
        itemName,
        quantity: 2,
        avgPurchasePrice: 50,
        value: 50,
        sellValue: 50
      })),
      hideouts: {
        'market-district': commodityNames.map((itemName) => ({
          itemName,
          quantity: 1,
          avgPurchasePrice: 60,
          value: 60,
          sellValue: 60
        }))
      }
    });

  assert.equal(seedResponse.status, 200);

  const operations = [
    ...commodityNames.map((itemName) => ({ action: 'stash', itemName, quantity: 1 })),
    ...commodityNames.map((itemName) => ({ action: 'retrieve', itemName, quantity: 1 }))
  ];

  const transactionResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations });

  assert.equal(transactionResponse.status, 200);
  assert.equal(transactionResponse.body.transfer.operations.length, operations.length);

  const stateResponse = await request(app)
    .get(`/games/${game.id}`)
    .send();

  assert.equal(stateResponse.status, 200);

  for (const itemName of commodityNames) {
    const inventoryItem = stateResponse.body.inventory.find((item) => item.itemName === itemName);
    const hideoutItem = stateResponse.body.hideouts['market-district'].find((item) => item.itemName === itemName);

    assert.ok(inventoryItem);
    assert.ok(hideoutItem);
    assert.equal(inventoryItem.quantity, 2);
    assert.equal(hideoutItem.quantity, 1);
  }
});

test('Inventory hideouts negative: hideouts settlement filter rejects unknown alias', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .get(`/games/${game.id}/hideouts`)
    .query({ settlement: 'wrong_place' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement filter/i);
});

test('Inventory hideouts: daily lock blocks second stash transaction in same day', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 3,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const firstTransaction = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 1 }] });

  assert.equal(firstTransaction.status, 200);

  const secondTransaction = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 1 }] });

  assert.equal(secondTransaction.status, 409);
  assert.match(secondTransaction.body.error, /transactions are closed/i);
});

test('Inventory hideouts: daily lock resets after day advances', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 3,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const firstTransaction = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 2 }] });

  assert.equal(firstTransaction.status, 200);

  const sleepResponse = await request(app)
    .post(`/games/${game.id}/actions/sleep`)
    .send({});

  assert.equal(sleepResponse.status, 200);

  const secondTransaction = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'retrieve', itemName: 'water', quantity: 1 }] });

  assert.equal(secondTransaction.status, 200);
});

test('Inventory hideouts negative: failed transaction does not partially mutate state', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 2,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const transactionResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({
      operations: [
        { action: 'stash', itemName: 'water', quantity: 1 },
        { action: 'retrieve', itemName: 'ammo', quantity: 1 }
      ]
    });

  assert.equal(transactionResponse.status, 400);
  assert.match(transactionResponse.body.error, /not enough quantity in hideout/i);

  const stateResponse = await request(app)
    .get(`/games/${game.id}`)
    .send();

  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.body.inventory[0].quantity, 2);
  assert.equal(stateResponse.body.hideouts['market-district']?.length || 0, 0);
});

test('Inventory hideouts negative: legacy stash and retrieve endpoints honor daily lock', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 3,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const transactionResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 2 }] });

  assert.equal(transactionResponse.status, 200);

  const stashResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(stashResponse.status, 409);
  assert.match(stashResponse.body.error, /transactions are closed/i);

  const retrieveResponse = await request(app)
    .post(`/games/${game.id}/actions/retrieve-item`)
    .send({ itemName: 'water', quantity: 1 });

  assert.equal(retrieveResponse.status, 409);
  assert.match(retrieveResponse.body.error, /transactions are closed/i);
});

test('Inventory hideouts negative: encounter lock takes precedence over daily lock', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 2,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ],
      lastHideoutTransactionDay: 1,
      currentEncounter: {
        type: 'raider',
        day: 1,
        settlement: 'market-district',
        enemyHealth: 18,
        enemyAttack: 5,
        rewardCash: 100,
        surrenderPenaltyRate: 0.2,
        lootChance: 0.1
      }
    });

  assert.equal(seedResponse.status, 200);

  const transactionResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 1 }] });

  assert.equal(transactionResponse.status, 400);
  assert.match(transactionResponse.body.error, /resolve the active raider encounter/i);
});

test('Inventory hideouts negative: travel rejects unknown settlement alias', async () => {
  const game = await createGame(request, app, assert);

  const response = await request(app)
    .post(`/games/${game.id}/actions/travel`)
    .send({ destination: 'totally made up city' });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /unknown settlement/i);
});

test('Inventory hideouts negative: retrieve-item rejects insufficient stash quantity', async () => {
  const game = await createGame(request, app, assert);

  const seedResponse = await request(app)
    .patch(`/games/${game.id}`)
    .send({
      inventory: [
        {
          itemName: 'water',
          quantity: 2,
          avgPurchasePrice: 30,
          value: 30,
          sellValue: 30
        }
      ]
    });

  assert.equal(seedResponse.status, 200);

  const stashResponse = await request(app)
    .post(`/games/${game.id}/actions/stash-transaction`)
    .send({ operations: [{ action: 'stash', itemName: 'water', quantity: 1 }] });

  assert.equal(stashResponse.status, 200);

  const sleepResponse = await request(app)
    .post(`/games/${game.id}/actions/sleep`)
    .send({});

  assert.equal(sleepResponse.status, 200);

  const retrieveResponse = await request(app)
    .post(`/games/${game.id}/actions/retrieve-item`)
    .send({ itemName: 'water', quantity: 2 });

  assert.equal(retrieveResponse.status, 400);
  assert.match(retrieveResponse.body.error, /not enough quantity in hideout/i);
});
