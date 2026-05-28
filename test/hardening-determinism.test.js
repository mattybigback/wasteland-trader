const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase5');
process.env.GAME_SESSIONS_DIR = TEST_DATA_DIR;

const request = require('supertest');
const { app } = require('../src/server');
const gameService = require('../src/services/gameService');
const {
	COMMODITY_BASE_PRICES,
	getCommodityUnitPrice,
	getCommodityAvailabilityChance
} = require('../src/models/economy');
const { EVENT_PROBABILITIES, MARKET_MULTIPLIER_RANGES } = require('../src/models/worldEvents');
const { COMBAT_DEFAULTS, RUN_FAIL_DAMAGE } = require('../src/models/combatBalance');

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

async function advanceBySleepDays(gameId, days) {
	let latest = null;

	for (let index = 0; index < days; index += 1) {
		const response = await request(app)
			.post(`/games/${gameId}/actions/sleep`)
			.send({});

		assert.equal(response.status, 200);
		latest = response.body;
	}

	return latest;
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

test('Phase 5: new games persist current schema version', async () => {
	const game = await createGame();
	assert.equal(game.schemaVersion, 2);
});

test('Phase 5: in-place migration upgrades legacy schema and canonicalizes market availability', async () => {
	const game = await createGame();

	const patchResponse = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			schemaVersion: 1,
			location: 'Vault Refuge',
			marketAvailability: {
				'Market District': {
					day: '2',
					items: ['Water', 'food', 'unknown-item']
				}
			}
		});

	assert.equal(patchResponse.status, 200);
	assert.equal(patchResponse.body.schemaVersion, 2);

	const triggerMigration = await request(app)
		.get(`/games/${game.id}/market`)
		.query({ settlement: 'Market District' });

	assert.equal(triggerMigration.status, 200);

	const readBack = await request(app).get(`/games/${game.id}`);

	assert.equal(readBack.status, 200);
	assert.equal(readBack.body.schemaVersion, 2);
	assert.equal(readBack.body.location, 'vault-refuge');
	assert.deepEqual(readBack.body.marketAvailability['market-district'], {
		day: 2,
		items: ['water', 'food']
	});
});

test('Phase 5: deterministic simulation fixture remains stable for repeated seeded runs', async () => {
	const gameOne = await createGame();
	const gameTwo = await createGame();

	const sequence = [
		0.01, 0.2, 0.99, 0.99, 0.99, 0.99, 0.99,
		0.9, 0.9, 0.9, 0.9, 0.9,
		0.03, 0.2, 0.99, 0.99, 0.99, 0.99, 0.99,
		0.9, 0.9, 0.9, 0.9, 0.9,
		0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
		0.9, 0.9, 0.9, 0.9, 0.9
	];

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const sleepOneA = await request(app).post(`/games/${gameOne.id}/actions/sleep`).send({});
	const sleepOneB = await request(app).post(`/games/${gameOne.id}/actions/sleep`).send({});

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const sleepTwoA = await request(app).post(`/games/${gameTwo.id}/actions/sleep`).send({});
	const sleepTwoB = await request(app).post(`/games/${gameTwo.id}/actions/sleep`).send({});

	assert.equal(sleepOneA.status, 200);
	assert.equal(sleepOneB.status, 200);
	assert.equal(sleepTwoA.status, 200);
	assert.equal(sleepTwoB.status, 200);

	const compactOne = {
		day: sleepOneB.body.day,
		cash: sleepOneB.body.cash,
		debt: sleepOneB.body.debt,
		health: sleepOneB.body.health,
		eventTypes: sleepOneA.body.events.concat(sleepOneB.body.events).map((event) => event.subType)
	};

	const compactTwo = {
		day: sleepTwoB.body.day,
		cash: sleepTwoB.body.cash,
		debt: sleepTwoB.body.debt,
		health: sleepTwoB.body.health,
		eventTypes: sleepTwoA.body.events.concat(sleepTwoB.body.events).map((event) => event.subType)
	};

	assert.deepEqual(compactOne, compactTwo);
});

test('Phase 5: API error contract for bad requests remains backward compatible', async () => {
	const game = await createGame();

	const response = await request(app)
		.post(`/games/${game.id}/actions/heal`)
		.send({ percentage: -10 });

	assert.equal(response.status, 400);
	assert.equal(typeof response.body.error, 'string');
	assert.match(response.body.error, /positive multiple of 10/i);
});

test('Phase 5: long-run deterministic fixture stays stable across repeated 15-day runs', async () => {
	const gameOne = await createGame();
	const gameTwo = await createGame();

	const seedOne = await request(app)
		.patch(`/games/${gameOne.id}`)
		.send({ debt: 0, debtDueDay: 99 });
	const seedTwo = await request(app)
		.patch(`/games/${gameTwo.id}`)
		.send({ debt: 0, debtDueDay: 99 });

	assert.equal(seedOne.status, 200);
	assert.equal(seedTwo.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));
	const finalOne = await advanceBySleepDays(gameOne.id, 15);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([], 0.99));
	const finalTwo = await advanceBySleepDays(gameTwo.id, 15);

	const snapshotOne = {
		day: finalOne.day,
		cash: finalOne.cash,
		debt: finalOne.debt,
		health: finalOne.health,
		status: finalOne.status,
		eventLogLength: finalOne.eventLog.length,
		encounter: finalOne.currentEncounter
	};

	const snapshotTwo = {
		day: finalTwo.day,
		cash: finalTwo.cash,
		debt: finalTwo.debt,
		health: finalTwo.health,
		status: finalTwo.status,
		eventLogLength: finalTwo.eventLog.length,
		encounter: finalTwo.currentEncounter
	};

	assert.deepEqual(snapshotOne, snapshotTwo);
	assert.equal(snapshotOne.day, 16);
});

test('Phase 5: baseline market prices match configured settlement multipliers', async () => {
	const game = await createGame();

	for (const settlement of gameService.settlements) {
		const marketResponse = await request(app)
			.get(`/games/${game.id}/market`)
			.query({ settlement });

		assert.equal(marketResponse.status, 200);

		for (const commodity of marketResponse.body.commodities) {
			const expected = getCommodityUnitPrice(commodity.itemName, settlement);
			assert.equal(commodity.unitPrice, expected);
		}
	}
});

test('Phase 5: economy/event/combat balance config stays within safe bounds', async () => {
	for (const itemName of Object.keys(COMMODITY_BASE_PRICES)) {
		for (const settlement of gameService.settlements) {
			const chance = getCommodityAvailabilityChance(itemName, settlement);
			assert.ok(chance >= 0 && chance <= 1);
		}
	}

	for (const probability of Object.values(EVENT_PROBABILITIES)) {
		assert.ok(probability >= 0 && probability <= 1);
	}

	assert.ok(COMBAT_DEFAULTS.encounterChancePerDay >= 0 && COMBAT_DEFAULTS.encounterChancePerDay <= 1);
	assert.ok(COMBAT_DEFAULTS.raiderEncounterWeight >= 0 && COMBAT_DEFAULTS.raiderEncounterWeight <= 1);
	assert.ok(COMBAT_DEFAULTS.runSuccessChance >= 0 && COMBAT_DEFAULTS.runSuccessChance <= 1);

	assert.ok(RUN_FAIL_DAMAGE.min >= 1);
	assert.ok(RUN_FAIL_DAMAGE.max >= RUN_FAIL_DAMAGE.min);

	assert.ok(MARKET_MULTIPLIER_RANGES.scarcity.clampMin >= 1);
	assert.ok(MARKET_MULTIPLIER_RANGES.scarcity.clampMax >= MARKET_MULTIPLIER_RANGES.scarcity.clampMin);
	assert.ok(MARKET_MULTIPLIER_RANGES.abundance.clampMin > 0);
	assert.ok(MARKET_MULTIPLIER_RANGES.abundance.clampMax >= MARKET_MULTIPLIER_RANGES.abundance.clampMin);
});
