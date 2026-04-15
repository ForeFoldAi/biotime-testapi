const fs = require("fs/promises");

class StorageModel {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
  }

  async read() {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        return this.defaultValue;
      }
      throw error;
    }
  }

  async write(payload) {
    const serialized = JSON.stringify(payload, null, 2);
    await fs.writeFile(this.filePath, serialized, "utf-8");
    return payload;
  }
}

module.exports = StorageModel;
