const express = require("express");
const router = express.Router();

const {
  userRegister,
  userLogin,
  userLogout,
} = require("../controllers/userController");
const { validateRegister, validateLogin } = require("../middleware/validate.js");
const { rateLimit, byIp } = require("../middleware/rateLimit.js");

// IP-keyed (no authenticated user exists yet at these routes) - registration
// spam and login brute-force are different threats with independent
// budgets, so they get separate limiters rather than sharing one bucket
// (sharing would mean someone's failed login attempts eat into an unrelated
// registration attempt's quota from the same IP, or vice versa).
const registerRateLimit = rateLimit({
  name: "register",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: byIp,
  message: "Too many attempts. Please try again in a few minutes.",
});
const loginRateLimit = rateLimit({
  name: "login",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: byIp,
  message: "Too many attempts. Please try again in a few minutes.",
});

router.post("/register", registerRateLimit, validateRegister, userRegister);
router.post("/login", loginRateLimit, validateLogin, userLogin);
router.post("/logout", userLogout);

module.exports = router;
