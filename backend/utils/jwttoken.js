const jwt = require("jsonwebtoken");

// Single source of truth for session lifetime - drives both the token's own
// expiry and the cookie's maxAge so they can never drift apart.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const jwtToken = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: SESSION_DURATION_MS / 1000,
  });

  const isProd = process.env.NODE_ENV === "production";

  //it is refresh token as it is signed by jwt
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: isProd,
    maxAge: SESSION_DURATION_MS,
    sameSite: "Strict",
  });
  // it is a normal toejn
  res.cookie("theme", "dark", {
    maxAge: SESSION_DURATION_MS,
    sameSite: "Strict",
    secure: isProd,
  });
};
module.exports = jwtToken;

/*
One long-lived JWT in a cookie (used as auth)
One normal cookie for theme
*/
