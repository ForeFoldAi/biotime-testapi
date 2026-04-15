const { authenticate, setAuthCredentials, normalizeCompany } = require("../services/authService");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function login(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const companyInput = String(req.body?.company || "").trim();

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required." });
    }
    if (!companyInput) {
      return res.status(400).json({ message: "Company is required." });
    }

    const normalizedCompany = normalizeCompany(companyInput);
    setAuthCredentials({
      email,
      password,
      company: normalizedCompany || companyInput,
    });

    const auth = await authenticate(true);
    return res.json({
      message: "Login successful",
      authType: auth.type,
      company: normalizedCompany || companyInput,
      email,
    });
  } catch (error) {
    return res.status(401).json({ message: "Invalid email or password." });
  }
}

module.exports = {
  login,
};
