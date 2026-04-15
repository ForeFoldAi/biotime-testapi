const httpClient = require("./httpClient");
const {
  BIO_TIME_EMAIL,
  BIO_TIME_PASSWORD,
  BIO_TIME_COMPANY,
} = require("../config/env");

let cachedAuth = null;
let runtimeCredentials = {
  email: BIO_TIME_EMAIL,
  password: BIO_TIME_PASSWORD,
  company: BIO_TIME_COMPANY,
};

function extractToken(data) {
  return data?.token || data?.access || data?.jwt || null;
}

function buildAuthHeader(type, token) {
  if (type === "JWT") return `JWT ${token}`;
  return `Token ${token}`;
}

function normalizeCompany(companyInput) {
  const company = String(companyInput || "").trim().toLowerCase();
  if (!company) return "";

  const withoutProtocol = company.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split("/")[0];
  return host.split(".")[0] || host;
}

function resolveCredentials(overrideCredentials = {}) {
  return {
    email: String(overrideCredentials.email || runtimeCredentials.email || "").trim(),
    password: String(overrideCredentials.password || runtimeCredentials.password || ""),
    company: String(overrideCredentials.company || runtimeCredentials.company || "").trim(),
  };
}

function setAuthCredentials(credentials) {
  const resolved = resolveCredentials(credentials);
  runtimeCredentials = {
    email: resolved.email,
    password: resolved.password,
    company: resolved.company,
  };
  cachedAuth = null;
  return runtimeCredentials;
}

function buildAuthAttempts(credentials) {
  const login = String(credentials.email || "").trim();
  const password = credentials.password;
  const usernameFromEmail = login.includes("@") ? login.split("@")[0] : login;
  const rawCompany = String(credentials.company || "").trim();
  const normalizedCompany = normalizeCompany(rawCompany);
  const companyCandidates = [rawCompany, normalizedCompany].filter(Boolean);
  const primaryCompany = companyCandidates[0] || "auinfocity";

  const attempts = [];

  for (const company of [primaryCompany, ...companyCandidates]) {
    attempts.push(
      {
        endpoint: "/jwt-api-token-auth/",
        payload: { company, email: login, password },
      },
      {
        endpoint: "/api-token-auth/",
        payload: { company, email: login, password },
      },
      {
        endpoint: "/staff-jwt-api-token-auth/",
        payload: { company, username: usernameFromEmail, password },
      }
    );
  }

  attempts.push(
    {
      endpoint: "/staff-api-token-auth/",
      payload: { username: usernameFromEmail, password },
    },
    {
      endpoint: "/api-token-auth/",
      payload: { email: login, password },
    }
  );

  const seen = new Set();
  return attempts.filter((attempt) => {
    const key = `${attempt.endpoint}|${JSON.stringify(attempt.payload)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function authenticate(force = false, overrideCredentials = {}) {
  if (!force && cachedAuth) return cachedAuth;

  const credentials = resolveCredentials(overrideCredentials);
  const authAttempts = buildAuthAttempts(credentials);
  const attemptErrors = [];

  for (const attempt of authAttempts) {
    const { endpoint, payload } = attempt;
    try {
      const response = await httpClient.post(endpoint, payload);
      const token = extractToken(response.data);
      if (!token) continue;

      const type = endpoint.includes("jwt") ? "JWT" : "Token";
      cachedAuth = {
        type,
        token,
        authorization: buildAuthHeader(type, token),
      };
      return cachedAuth;
    } catch (error) {
      const safePayload = Object.keys(payload);
      const status = error?.response?.status || "NA";
      const responseData = error?.response?.data;
      const message =
        responseData?.detail ||
        responseData?.non_field_errors?.[0] ||
        (typeof responseData === "string" ? responseData : "") ||
        JSON.stringify(responseData || {}) ||
        error.message ||
        "Unknown auth error";
      attemptErrors.push(`${endpoint} [${safePayload.join(",")}]: ${status} ${message}`);
      continue;
    }
  }

  throw new Error(
    `BioTime authentication failed for all supported endpoints. Attempts: ${attemptErrors.join(
      " | "
    )}`
  );
}

module.exports = {
  authenticate,
  setAuthCredentials,
  normalizeCompany,
};
