const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase4');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');

function buildSequenceRng(values, fallback = 0.99) {
	const sequence = Array.isArray(values) ? [...values] : [];
	let index = 0;

	return () => {
		if (index < sequence.length) {
			const value = sequence[index];
			index += 1;
			return value;
		}

		return fallback;
	};
}

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

test('Phase 4: sleep can generate an encounter that is returned by encounter endpoint', async () => {
	const game = await createGame();

	const sequence = Array.from({ length: 19 }, () => 0.99).concat([0.01, 0.99, 0.99]);
	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence, 0.99));

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	assert.equal(sleepResponse.body.currentEncounter !== null, true);

	const encounterResponse = await request(app).get(`/games/${game.id}/encounter`);

	assert.equal(encounterResponse.status, 200);
	assert.ok(encounterResponse.body.encounter);
	assert.equal(encounterResponse.body.encounter.type, sleepResponse.body.currentEncounter.type);
});

test('Phase 4: fight resolves win path, clears encounter, and returns combat result', async () => {
	const game = await createGame();

	const patchResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			health: 100,
			currentEncounter: {
				type: 'raider',
				enemyHealth: 18,
				enemyAttack: 8,
				rewardCash: 120,
				lootChance: 0,
				settlement: 'market-district',
				day: 1
			},
			equippedWeapon: 'assault-rifle',
			equippedArmor: 'riot-plate'
		});

	assert.equal(patchResponse.status, 200);

	const fightResponse = await request(app)
		.post(`/games/${game.id}/actions/combat`)
		.send({ action: 'fight' });

	assert.equal(fightResponse.status, 200);
	assert.equal(fightResponse.body.combatResult.outcome, 'win');
	assert.equal(fightResponse.body.game.currentEncounter, null);
	assert.equal(fightResponse.body.combatResult.rewardCash, 120);
	assert.ok(fightResponse.body.combatResult.damageTaken >= 0);
});

test('Phase 4: run supports success and failure branches', async () => {
	const game = await createGame();

	const seedResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			currentEncounter: {
				type: 'sandstorm',
				enemyHealth: 20,
				enemyAttack: 9,
				rewardCash: 90,
				lootChance: 0,
				settlement: 'market-district',
				day: 1
			}
		});

	assert.equal(seedResponse.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.1], 0.99));
	const runSuccess = await request(app)
		.post(`/games/${game.id}/actions/combat`)
		.send({ action: 'run' });

	assert.equal(runSuccess.status, 200);
	assert.equal(runSuccess.body.combatResult.outcome, 'escaped');
	assert.equal(runSuccess.body.game.currentEncounter, null);

	const reseedResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			health: 100,
			currentEncounter: {
				type: 'sandstorm',
				enemyHealth: 20,
				enemyAttack: 9,
				rewardCash: 90,
				lootChance: 0,
				settlement: 'market-district',
				day: 1
			}
		});

	assert.equal(reseedResponse.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.5], 0.99));
	const runFail = await request(app)
		.post(`/games/${game.id}/actions/combat`)
		.send({ action: 'run' });

	assert.equal(runFail.status, 200);
	assert.equal(runFail.body.combatResult.outcome, 'run-failed');
	assert.ok(runFail.body.combatResult.damageTaken > 0);
	assert.ok(runFail.body.game.currentEncounter);
});

test('Phase 4: debt-collector supports pay action and clears encounter', async () => {
	const game = await createGame();

	const patchResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			debt: 1200,
			currentEncounter: {
				type: 'debt-collector',
				enemyHealth: 36,
				enemyAttack: 16,
				rewardCash: 0,
				lootChance: 0,
				settlement: 'market-district',
				day: 1
			}
		});

	assert.equal(patchResponse.status, 200);

	const payResponse = await request(app)
		.post(`/games/${game.id}/actions/combat`)
		.send({ action: 'pay' });

	assert.equal(payResponse.status, 200);
	assert.equal(payResponse.body.combatResult.outcome, 'paid-off');
	assert.equal(payResponse.body.combatResult.debtChange, -200);
	assert.equal(payResponse.body.game.debt, 1000);
	assert.equal(payResponse.body.game.currentEncounter, null);
});

test('Phase 4: equip weapon and armor swaps from unequipped gear', async () => {
	const game = await createGame();

	const patchResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			unequippedGear: [
				{ itemType: 'weapon', name: 'pipe-rifle' },
				{ itemType: 'armor', name: 'combat-vest' },
				{ itemType: 'weapon', name: 'shiv' }
			],
			equippedWeapon: 'shiv'
		});

	assert.equal(patchResponse.status, 200);

	const equipWeaponResponse = await request(app)
		.post(`/games/${game.id}/actions/equip-weapon`)
		.send({ weaponName: 'pipe-rifle' });

	assert.equal(equipWeaponResponse.status, 200);
	assert.equal(equipWeaponResponse.body.game.equippedWeapon, 'pipe-rifle');
	assert.equal(
		equipWeaponResponse.body.game.unequippedGear.some((item) => item.name === 'shiv'),
		true
	);

	const equipArmorResponse = await request(app)
		.post(`/games/${game.id}/actions/equip-armor`)
		.send({ armorName: 'combat-vest' });

	assert.equal(equipArmorResponse.status, 200);
	assert.equal(equipArmorResponse.body.game.equippedArmor, 'combat-vest');
});

test('Phase 4: non-combat actions unlock immediately after encounter resolution', async () => {
	const game = await createGame();

	const seedResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			cash: 5000,
			health: 80,
			inventory: [
				{ itemName: 'water', quantity: 3, avgPurchasePrice: 30, value: 30, sellValue: 30 }
			],
			currentEncounter: {
				type: 'raider',
				enemyHealth: 12,
				enemyAttack: 6,
				rewardCash: 100,
				lootChance: 0,
				settlement: 'market-district',
				day: 1
			}
		});

	assert.equal(seedResponse.status, 200);

	const blockedHeal = await request(app)
		.post(`/games/${game.id}/actions/heal`)
		.send({ percentage: 10 });

	assert.equal(blockedHeal.status, 400);
	assert.match(blockedHeal.body.error, /must resolve the active/i);

	const resolveCombat = await request(app)
		.post(`/games/${game.id}/actions/combat`)
		.send({ action: 'fight' });

	assert.equal(resolveCombat.status, 200);
	assert.equal(resolveCombat.body.game.currentEncounter, null);

	const unlockedHeal = await request(app)
		.post(`/games/${game.id}/actions/heal`)
		.send({ percentage: 10 });

	assert.equal(unlockedHeal.status, 200);
	assert.ok(unlockedHeal.body.health > 80);

	const unlockedBuy = await request(app)
		.post(`/games/${game.id}/actions/buy-item`)
		.send({ itemName: 'water', quantity: 1 });

	assert.equal(unlockedBuy.status, 200);
	assert.equal(unlockedBuy.body.trade.action, 'buy');
});
