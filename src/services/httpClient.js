const axios = require("axios");
const { BIO_TIME_BASE_URL } = require("../config/env");

const httpClient = axios.create({
  baseURL: BIO_TIME_BASE_URL,
  timeout: 30000,
});

module.exports = httpClient;
