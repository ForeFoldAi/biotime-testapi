const fs = require("fs/promises");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureJsonFile(filePath, defaultValue) {
  try {
    await fs.access(filePath);
  } catch (error) {
    const content = JSON.stringify(defaultValue, null, 2);
    await fs.writeFile(filePath, content, "utf-8");
  }
}

module.exports = {
  ensureDir,
  ensureJsonFile,
};
