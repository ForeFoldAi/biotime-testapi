const path = require("path");
const os = require("os");

const ROOT_DIR = path.resolve(__dirname, "../../");
const IS_PACKAGED = ROOT_DIR.includes("app.asar");
const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const APP_DATA_ROOT =
  process.env.APP_DATA_DIR ||
  path.join(os.homedir(), ".forefold-report-generator");
const USE_USER_DATA_PATHS = IS_PACKAGED || IS_PRODUCTION;
const RUNTIME_ROOT = USE_USER_DATA_PATHS ? APP_DATA_ROOT : ROOT_DIR;

module.exports = {
  PORT: Number(process.env.PORT || 4000),
  ROOT_DIR,
  IS_PACKAGED,
  IS_PRODUCTION,
  RUNTIME_ROOT,
  BIO_TIME_BASE_URL:
    process.env.BIO_TIME_BASE_URL ||
    "https://auinfocity.itimedev.minervaiot.com",
  BIO_TIME_COMPANY: process.env.BIO_TIME_COMPANY || "auinfocity",
  BIO_TIME_EMAIL: process.env.BIO_TIME_EMAIL || "demo@example.com",
  BIO_TIME_PASSWORD: process.env.BIO_TIME_PASSWORD || "password123",
  STORAGE_DIR: USE_USER_DATA_PATHS
    ? path.join(RUNTIME_ROOT, "storage")
    : path.join(ROOT_DIR, "src/storage/data"),
  UPLOAD_DIR: path.join(RUNTIME_ROOT, "uploads"),
  OUTPUT_DIR: path.join(RUNTIME_ROOT, "outputs"),
};
