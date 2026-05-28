const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'games-test-phase3');
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

test('Phase 3: sleep returns newly triggered events and persists them', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.01, 0.2, 0.9, 0.9, 0.9, 0.9, 0.9])
	);

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	assert.equal(Array.isArray(sleepResponse.body.events), true);
	assert.equal(sleepResponse.body.events.length, 1);
	assert.equal(sleepResponse.body.events[0].subType, 'lucky-find');
	assert.equal(sleepResponse.body.events[0].triggeredBy, 'sleep');
	assert.equal(sleepResponse.body.events[0].day, 2);

	const eventsResponse = await request(app).get(`/games/${game.id}/events`);

	assert.equal(eventsResponse.status, 200);
	assert.equal(eventsResponse.body.total, 1);
	assert.equal(eventsResponse.body.items.length, 1);
	assert.equal(eventsResponse.body.items[0].subType, 'lucky-find');
});

test('Phase 3: travel can trigger multiple non-conflicting events and settlement filters', async () => {
	const game = await createGame();

	const topRankPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(topRankPatch.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.01, 0.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.01, 0.0, 0.2, 0.3, 0.3,
			0.01, 0.0, 0.2, 0.3, 0.3
		])
	);

	const travelResponse = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'Vault Refuge' });

	assert.equal(travelResponse.status, 200);
	assert.equal(travelResponse.body.location, 'vault-refuge');
	assert.ok(travelResponse.body.events.length >= 2);
	assert.equal(travelResponse.body.events.every((event) => event.triggeredBy === 'travel'), true);
	assert.equal(travelResponse.body.events.every((event) => event.settlement === 'vault-refuge'), true);

	const marketSignals = travelResponse.body.events.filter((event) => event.type === 'market-signal');
	assert.ok(marketSignals.length >= 1);

	if (marketSignals.length >= 2) {
		assert.notEqual(marketSignals[0].metadata.itemName, marketSignals[1].metadata.itemName);
	}

	const filteredEvents = await request(app)
		.get(`/games/${game.id}/events`)
		.query({ settlement: 'Vault_Refuge' });

	assert.equal(filteredEvents.status, 200);
	assert.equal(filteredEvents.body.total, travelResponse.body.events.length);
	assert.equal(filteredEvents.body.items.every((event) => event.settlement === 'vault-refuge'), true);
});

test('Phase 3: deterministic RNG yields repeatable events for equivalent actions', async () => {
	const gameOne = await createGame();
	const gameTwo = await createGame();

	const sequence = [0.01, 0.1, 0.9, 0.01, 0.5, 0.9, 0.9, 0.9];

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const firstSleep = await request(app)
		.post(`/games/${gameOne.id}/actions/sleep`)
		.send({});

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const secondSleep = await request(app)
		.post(`/games/${gameTwo.id}/actions/sleep`)
		.send({});

	assert.equal(firstSleep.status, 200);
	assert.equal(secondSleep.status, 200);

	const compactFirst = firstSleep.body.events.map((event) => ({
		subType: event.subType,
		impact: event.impact,
		metadata: event.metadata
	}));

	const compactSecond = secondSleep.body.events.map((event) => ({
		subType: event.subType,
		impact: event.impact,
		metadata: event.metadata
	}));

	assert.deepEqual(compactFirst, compactSecond);
});

test('Phase 3: events endpoint rejects unknown settlement filter', async () => {
	const game = await createGame();

	const response = await request(app)
		.get(`/games/${game.id}/events`)
		.query({ settlement: 'unknown_outpost' });

	assert.equal(response.status, 400);
	assert.match(response.body.error, /unknown settlement filter/i);
});

test('Phase 3: rumor reliability scales from level 1 to top rank', async () => {
	const levelOneGame = await createGame();
	const topRankGame = await createGame();

	const levelOnePatch = await request(app)
		.patch(`/games/${levelOneGame.id}`)
		.send({ rank: 1, highestRankAchieved: 1 });

	assert.equal(levelOnePatch.status, 200);

	const topRankPatch = await request(app)
		.patch(`/games/${topRankGame.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(topRankPatch.status, 200);

	const sequence = [
		0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
		0.01, 0.0, 0.85, 0.2, 0.2,
		0.9
	];

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const levelOneTravel = await request(app)
		.post(`/games/${levelOneGame.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(levelOneTravel.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng(sequence));
	const topRankTravel = await request(app)
		.post(`/games/${topRankGame.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(topRankTravel.status, 200);

	const levelOneRumor = levelOneTravel.body.events.find((event) => event.subType === 'price-rise-signal');
	const topRankRumor = topRankTravel.body.events.find((event) => event.subType === 'price-rise-signal');

	assert.ok(levelOneRumor);
	assert.ok(topRankRumor);

	assert.equal(levelOneRumor.metadata.reliability, 0.4);
	assert.equal(topRankRumor.metadata.reliability, 0.9);
	assert.equal(levelOneRumor.metadata.isAccurate, false);
	assert.equal(topRankRumor.metadata.isAccurate, true);
});

test('Phase 3: rumor reliability does not drop after demotion', async () => {
	const game = await createGame();

	const initialPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(initialPatch.status, 200);

	const demotionPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 1 });

	assert.equal(demotionPatch.status, 200);
	assert.equal(demotionPatch.body.rank, 1);
	assert.equal(demotionPatch.body.highestRankAchieved, 5);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.01, 0.0, 0.2, 0.85, 0.9,
			0.9
		])
	);

	const travelResponse = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'raider-camp' });

	assert.equal(travelResponse.status, 200);

	const rumor = travelResponse.body.events.find((event) => event.subType === 'price-rise-signal');

	assert.ok(rumor);
	assert.equal(rumor.metadata.reliability, 0.9);
	assert.equal(rumor.metadata.isAccurate, true);
});

test('Phase 3: scarcity rumors use scarce/abundant wording and scarcity spikes next-day price', async () => {
	const game = await createGame();

	const topRankPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(topRankPatch.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, // lucky find roll
			0.9, // scavenged cache roll
			0.9, // illness roll
			0.9, // shakedown roll
			0.9, // weapon damage roll
			0.9, // ammo stash roll
			0.9, // friendly encounter roll
			0.9, // rival encounter roll
			0.9, // pickpocket roll
			0.9, // supply shortage roll
			0.9, // settlement unrest roll
			0.01, // rise rumor roll
			0.0, // commodity pick -> water
			0.1, // reliability roll -> accurate at 0.9
			0.95, // scarcity base multiplier roll
			0.95, // scarcity fuzz roll
			0.9 // drop rumor roll (off)
		])
	);

	const dayTwoTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(dayTwoTravel.status, 200);

	const rumorEvent = dayTwoTravel.body.events.find((event) => event.subType === 'price-rise-signal');
	assert.ok(rumorEvent);
	assert.equal(rumorEvent.metadata.signal, 'scarce');
	assert.equal(rumorEvent.metadata.actualMarketState, 'scarce');
	assert.match(rumorEvent.description, /scarce/i);
	assert.doesNotMatch(rumorEvent.description, /%/);

	const dayTwoMarket = await request(app).get(`/games/${game.id}/market`);
	assert.equal(dayTwoMarket.status, 200);
	const dayTwoWater = dayTwoMarket.body.commodities.find((item) => item.itemName === 'water');
	assert.ok(dayTwoWater);
	assert.equal(dayTwoWater.unitPrice, 36);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayThreeSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayThreeSleep.status, 200);

	const dayThreeMarket = await request(app).get(`/games/${game.id}/market`);
	assert.equal(dayThreeMarket.status, 200);

	const dayThreeWater = dayThreeMarket.body.commodities.find((item) => item.itemName === 'water');
	assert.ok(dayThreeWater);
	assert.ok(dayThreeWater.unitPrice >= 36 * 4);
	assert.ok(dayThreeWater.unitPrice <= 36 * 20);
});

test('Phase 3: abundance rumors can crash next-day prices dramatically', async () => {
	const game = await createGame();

	const topRankPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(topRankPatch.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, // lucky find roll
			0.9, // scavenged cache roll
			0.9, // illness roll
			0.9, // shakedown roll
			0.9, // weapon damage roll
			0.9, // ammo stash roll
			0.9, // friendly encounter roll
			0.9, // rival encounter roll
			0.9, // pickpocket roll
			0.9, // supply shortage roll
			0.9, // settlement unrest roll
			0.9, // rise rumor roll (off)
			0.01, // drop rumor roll (on)
			0.0, // commodity pick -> water
			0.1, // reliability roll -> accurate at 0.9
			0.0, // abundance base multiplier roll (minimum)
			0.0 // abundance fuzz roll (minimum)
		])
	);

	const dayTwoTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(dayTwoTravel.status, 200);

	const rumorEvent = dayTwoTravel.body.events.find((event) => event.subType === 'price-drop-signal');
	assert.ok(rumorEvent);
	assert.equal(rumorEvent.metadata.signal, 'abundant');
	assert.equal(rumorEvent.metadata.actualMarketState, 'abundant');
	assert.match(rumorEvent.description, /abundant/i);
	assert.doesNotMatch(rumorEvent.description, /%/);

	const dayThreeSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayThreeSleep.status, 200);

	const dayThreeMarket = await request(app).get(`/games/${game.id}/market`);
	assert.equal(dayThreeMarket.status, 200);

	const dayThreeWater = dayThreeMarket.body.commodities.find((item) => item.itemName === 'water');
	assert.ok(dayThreeWater);
	assert.ok(dayThreeWater.unitPrice <= 36 * 0.4);
	assert.ok(dayThreeWater.unitPrice >= 1);
});

test('Phase 3: market history stores per-day prices per location per item', async () => {
	const game = await createGame();

	const initialHistory = await request(app).get(`/games/${game.id}/market-history`);
	assert.equal(initialHistory.status, 200);
	assert.equal(initialHistory.body.total, 10);

	const fullInitialHistory = await request(app)
		.get(`/games/${game.id}/market-history`)
		.query({ limit: 25 });

	assert.equal(fullInitialHistory.status, 200);
	assert.equal(fullInitialHistory.body.total, 25);

	const dayOneWaterMarket = fullInitialHistory.body.items.find((entry) => (
		entry.day === 1 && entry.settlement === 'market-district' && entry.itemName === 'water'
	));

	assert.ok(dayOneWaterMarket);
	assert.equal(dayOneWaterMarket.direction, 'new');

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayTwoSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayTwoSleep.status, 200);

	const waterHistory = await request(app)
		.get(`/games/${game.id}/market-history`)
		.query({ settlement: 'market_district', itemName: 'water' });

	assert.equal(waterHistory.status, 200);
	assert.equal(waterHistory.body.total, 2);
	assert.equal(waterHistory.body.items[0].day, 1);
	assert.equal(waterHistory.body.items[1].day, 2);
	assert.equal(waterHistory.body.items[1].direction, 'same');
});

test('Phase 3: market history captures higher/lower indicators after scarcity and crash', async () => {
	const game = await createGame();

	const topRankPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ rank: 5, highestRankAchieved: 5 });

	assert.equal(topRankPatch.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.01, 0.0, 0.1, 0.95, 0.95,
			0.9
		])
	);

	const dayTwoTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(dayTwoTravel.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayThreeSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayThreeSleep.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.9,
			0.01, 0.0, 0.1, 0.0, 0.0
		])
	);

	const dayFourTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'trading-post' });

	assert.equal(dayFourTravel.status, 200);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayFiveSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayFiveSleep.status, 200);

	const waterHistory = await request(app)
		.get(`/games/${game.id}/market-history`)
		.query({ settlement: 'trading-post', itemName: 'water' });

	assert.equal(waterHistory.status, 200);

	const day3 = waterHistory.body.items.find((entry) => entry.day === 3);
	const day5 = waterHistory.body.items.find((entry) => entry.day === 5);

	assert.ok(day3);
	assert.ok(day5);
	assert.equal(day3.direction, 'higher');
	assert.equal(day5.direction, 'lower');
	assert.ok(day3.unitPrice > day3.previousPrice);
	assert.ok(day5.unitPrice < day5.previousPrice);
});

test('Phase 3: market history supports bounded fromDay/toDay filtering', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));

	for (let index = 0; index < 4; index += 1) {
		const response = await request(app)
			.post(`/games/${game.id}/actions/sleep`)
			.send({});

		assert.equal(response.status, 200);
	}

	const rangedHistory = await request(app)
		.get(`/games/${game.id}/market-history`)
		.query({ settlement: 'market-district', itemName: 'water', fromDay: 2, toDay: 4, limit: 50 });

	assert.equal(rangedHistory.status, 200);
	assert.equal(rangedHistory.body.total, 3);
	assert.deepEqual(rangedHistory.body.items.map((entry) => entry.day), [2, 3, 4]);
});

test('Phase 3: market history rejects day windows above the maximum bound', async () => {
	const game = await createGame();

	const oversizedWindow = await request(app)
		.get(`/games/${game.id}/market-history`)
		.query({ fromDay: 1, toDay: 121 });

	assert.equal(oversizedWindow.status, 400);
	assert.match(oversizedWindow.body.error, /exceeds maximum of 120 days/i);
});

test('Phase 3: weapon-damage removes ammo inventory when available', async () => {
	const game = await createGame();

	const seeded = await request(app)
		.patch(`/games/${game.id}`)
		.send({
			inventory: [
				{
					itemName: 'ammo',
					quantity: 2,
					avgPurchasePrice: 80,
					value: 80,
					sellValue: 80
				}
			]
		});

	assert.equal(seeded.status, 200);

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.01, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
	);

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	const damageEvent = sleepResponse.body.events.find((event) => event.subType === 'weapon-damage');
	assert.ok(damageEvent);

	const ammoStack = sleepResponse.body.inventory.find((item) => item.itemName === 'ammo');
	assert.ok(ammoStack);
	assert.equal(ammoStack.quantity, 1);
});

test('Phase 3: ammo-stash adds ammo inventory', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.01, 0.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
	);

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	const stashEvent = sleepResponse.body.events.find((event) => event.subType === 'ammo-stash');
	assert.ok(stashEvent);

	const ammoStack = sleepResponse.body.inventory.find((item) => item.itemName === 'ammo');
	assert.ok(ammoStack);
	assert.equal(ammoStack.quantity, 1);
});

test('Phase 3: friendly-encounter adds gifted inventory', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.01, 0.0, 0.0, 0.9, 0.9, 0.9, 0.9, 0.9])
	);

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	const friendlyEvent = sleepResponse.body.events.find((event) => event.subType === 'friendly-encounter');
	assert.ok(friendlyEvent);
	assert.ok(Array.isArray(friendlyEvent.impact.inventory));
	assert.equal(friendlyEvent.impact.inventory.length, 1);
});

test('Phase 3: nighttime-robbery applies sleep-only cash penalty', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.01, 0.0, 0.9, 0.9, 0.9, 0.9])
	);

	const sleepResponse = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(sleepResponse.status, 200);
	const robberyEvent = sleepResponse.body.events.find((event) => event.subType === 'nighttime-robbery');
	assert.ok(robberyEvent);
	assert.ok(robberyEvent.impact.cash < 0);
	assert.equal(Number(sleepResponse.body.cash), 1831);
});

test('Phase 3: settlement-unrest affects next-day market pricing', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.9,
			0.01,
			0.0,
			0.0,
			0.9,
			0.9
		])
	);

	const dayTwoSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayTwoSleep.status, 200);
	assert.ok(dayTwoSleep.body.events.find((event) => event.subType === 'settlement-unrest'));

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayThreeSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayThreeSleep.status, 200);

	const dayThreeMarket = await request(app).get(`/games/${game.id}/market`);
	assert.equal(dayThreeMarket.status, 200);

	const water = dayThreeMarket.body.commodities.find((item) => item.itemName === 'water');
	assert.ok(water);
	assert.ok(water.unitPrice !== 30);
});

test('Phase 3: supply-shortage creates one-day scarcity multiplier', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([
			0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
			0.01,
			0.0,
			0.0,
			0.9,
			0.9,
			0.9
		])
	);

	const dayTwoSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayTwoSleep.status, 200);
	assert.ok(dayTwoSleep.body.events.find((event) => event.subType === 'supply-shortage'));

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const dayThreeSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayThreeSleep.status, 200);

	const dayThreeMarket = await request(app).get(`/games/${game.id}/market`);
	assert.equal(dayThreeMarket.status, 200);

	const water = dayThreeMarket.body.commodities.find((item) => item.itemName === 'water');
	assert.ok(water);
	assert.ok(water.unitPrice >= 60);
});

test('Phase 3: rival-encounter blocks trade and heal until traveling away', async () => {
	const game = await createGame();

	gameService.__setRandomNumberGeneratorForTests(
		buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9])
	);

	const dayTwoSleep = await request(app)
		.post(`/games/${game.id}/actions/sleep`)
		.send({});

	assert.equal(dayTwoSleep.status, 200);
	assert.ok(dayTwoSleep.body.events.find((event) => event.subType === 'rival-encounter'));

	const healthPatch = await request(app)
		.patch(`/games/${game.id}`)
		.send({ health: 80 });

	assert.equal(healthPatch.status, 200);

	const blockedBuy = await request(app)
		.post(`/games/${game.id}/actions/buy-item`)
		.send({ itemName: 'ammo', quantity: 1 });

	assert.equal(blockedBuy.status, 400);
	assert.match(blockedBuy.body.error, /shut you out/i);

	const blockedHeal = await request(app)
		.post(`/games/${game.id}/actions/heal`)
		.send({ percentage: 10 });

	assert.equal(blockedHeal.status, 400);
	assert.match(blockedHeal.body.error, /medical services/i);

	gameService.__setRandomNumberGeneratorForTests(buildSequenceRng([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]));
	const awayTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'raider-camp' });

	assert.equal(awayTravel.status, 200);

	const returnTravel = await request(app)
		.post(`/games/${game.id}/actions/travel`)
		.send({ destination: 'market-district' });

	assert.equal(returnTravel.status, 200);

	// Force ammo available after travel — availability may have been rolled as unavailable.
	await request(app)
		.patch(`/games/${game.id}`)
		.send({
			marketAvailability: {
				'market-district': { day: returnTravel.body.day, items: ['water', 'food', 'chems', 'scrap', 'ammo'] }
			}
		});

	const unblockedBuy = await request(app)
		.post(`/games/${game.id}/actions/buy-item`)
		.send({ itemName: 'ammo', quantity: 1 });

	assert.equal(unblockedBuy.status, 200);
});
