const { BIO_TIME_COMPANY } = require("../config/env");
const { authenticate, setAuthCredentials, normalizeCompany } = require("../services/authService");

async function login(req, res, next) {
  try {
    const username = String(req.body?.username || req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const companyInput = String(req.body?.company || "").trim() || BIO_TIME_COMPANY;

    if (!username) {
      return res.status(400).json({ message: "User name is required." });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required." });
    }

    const normalizedCompany = companyInput ? normalizeCompany(companyInput) : "";
    setAuthCredentials({
      email: username,
      password,
      company: normalizedCompany || companyInput,
    });

    const auth = await authenticate(true);
    return res.json({
      message: "Login successful",
      authType: auth.type,
      ...(normalizedCompany || companyInput
        ? { company: normalizedCompany || companyInput }
        : {}),
      username,
    });
  } catch (error) {
    const detail = String(error?.message || "").trim();
    return res.status(401).json({
      message: detail || "Invalid user name or password.",
    });
  }
}

module.exports = {
  login,
};
