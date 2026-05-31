const fs = require('node:fs/promises');
const path = require('node:path');

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath) {
  const fileContents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(fileContents);
}

async function writeJsonFile(filePath, data) {
  const directory = path.dirname(filePath);
  await ensureDirectory(directory);

  const tempFilePath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  await fs.writeFile(tempFilePath, payload, 'utf8');
  await fs.rename(tempFilePath, filePath);
}

module.exports = {
  ensureDirectory,
  readJsonFile,
  writeJsonFile
};
