const { PORT, UPLOAD_DIR, OUTPUT_DIR } = require("./config/env");
const { initializeStorage, stores } = require("./storage");
const runtimeStore = require("./storage/runtimeStore");
const { ensureDir } = require("./utils/fileUtils");
const app = require("./app");

async function startServer() {
  await ensureDir(UPLOAD_DIR);
  await ensureDir(OUTPUT_DIR);
  await initializeStorage();
  await runtimeStore.hydrateFromPersistentStores(stores);

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve({ server, port: PORT });
    });
    server.on("error", reject);
  });
}

async function bootstrap() {
  await startServer();
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

module.exports = { startServer, app };
