const { PORT, UPLOAD_DIR, OUTPUT_DIR } = require("./config/env");
const { initializeStorage, stores } = require("./storage");
const runtimeStore = require("./storage/runtimeStore");
const { ensureDir } = require("./utils/fileUtils");
const app = require("./app");

async function bootstrap() {
  await ensureDir(UPLOAD_DIR);
  await ensureDir(OUTPUT_DIR);
  await initializeStorage();
  await runtimeStore.hydrateFromPersistentStores(stores);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
