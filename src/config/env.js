const path = require("path");
const os = require("os");

const ROOT_DIR = path.resolve(__dirname, "../../");
const IS_PACKAGED = ROOT_DIR.includes("app.asar");
const APP_DATA_ROOT =
  process.env.APP_DATA_DIR ||
  (IS_PACKAGED
    ? path.join(os.homedir(), ".employee-attendance-ot-system")
    : path.join(ROOT_DIR, ".runtime-data"));
const RUNTIME_ROOT = IS_PACKAGED ? APP_DATA_ROOT : ROOT_DIR;

module.exports = {
  PORT: Number(process.env.PORT || 4000),
  ROOT_DIR,
  IS_PACKAGED,
  RUNTIME_ROOT,
  BIO_TIME_BASE_URL:
    process.env.BIO_TIME_BASE_URL ||
    "https://auinfocity.itimedev.minervaiot.com",
  BIO_TIME_COMPANY: process.env.BIO_TIME_COMPANY || "auinfocity",
  BIO_TIME_EMAIL: process.env.BIO_TIME_EMAIL || "demo@example.com",
  BIO_TIME_PASSWORD: process.env.BIO_TIME_PASSWORD || "password123",
  STORAGE_DIR: IS_PACKAGED
    ? path.join(RUNTIME_ROOT, "storage")
    : path.join(ROOT_DIR, "src/storage/data"),
  UPLOAD_DIR: path.join(RUNTIME_ROOT, "uploads"),
  OUTPUT_DIR: path.join(RUNTIME_ROOT, "outputs"),
};
