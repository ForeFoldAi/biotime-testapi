const { PORT, UPLOAD_DIR, OUTPUT_DIR } = require("./config/env");
const { initializeStorage, stores } = require("./storage");
const runtimeStore = require("./storage/runtimeStore");
const { ensureDir } = require("./utils/fileUtils");
const app = require("./app");

const LOCAL_HOST = "127.0.0.1";

async function listenOnPort(appInstance, requestedPort) {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(requestedPort, LOCAL_HOST, () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : requestedPort;
      console.log(`Server running on http://${LOCAL_HOST}:${activePort}`);
      resolve({ server, port: activePort });
    });
    server.on("error", reject);
  });
}

async function startServer() {
  await ensureDir(UPLOAD_DIR);
  await ensureDir(OUTPUT_DIR);
  await initializeStorage();
  await runtimeStore.hydrateFromPersistentStores(stores);

  try {
    return await listenOnPort(app, PORT);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") {
      throw error;
    }

    // Desktop builds can fail silently for users when default port is occupied.
    // Retry on an OS-assigned free port so the app can still launch.
    console.warn(`Port ${PORT} is already in use; retrying on a free port.`);
    return listenOnPort(app, 0);
  }
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
