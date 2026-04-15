const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../../");

module.exports = {
  PORT: Number(process.env.PORT || 4000),
  ROOT_DIR,
  BIO_TIME_BASE_URL:
    process.env.BIO_TIME_BASE_URL ||
    "https://auinfocity.itimedev.minervaiot.com",
  BIO_TIME_COMPANY: process.env.BIO_TIME_COMPANY || "auinfocity",
  BIO_TIME_EMAIL: process.env.BIO_TIME_EMAIL || "demo@example.com",
  BIO_TIME_PASSWORD: process.env.BIO_TIME_PASSWORD || "password123",
  STORAGE_DIR: path.join(ROOT_DIR, "src/storage/data"),
  UPLOAD_DIR: path.join(ROOT_DIR, "uploads"),
  OUTPUT_DIR: path.join(ROOT_DIR, "outputs"),
};
