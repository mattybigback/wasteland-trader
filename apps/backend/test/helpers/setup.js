const fs = require('node:fs/promises');

async function resetTestDataDir(testDataDir) {
  await fs.rm(testDataDir, { recursive: true, force: true });
  await fs.mkdir(testDataDir, { recursive: true });
}

async function createGame(request, app, assert) {
  const response = await request(app).post('/games').send({});
  assert.equal(response.status, 201);
  return response.body;
}

module.exports = {
  resetTestDataDir,
  createGame
};
