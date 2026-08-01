const express = require("express");
const router = express.Router();

const {
  userRegister,
  userLogin,
  userLogout,
} = require("../controllers/userController");
const { validateRegister, validateLogin } = require("../middleware/validate.js");

router.post("/register", validateRegister, userRegister);
router.post("/login", validateLogin, userLogin);
router.post("/logout", userLogout);

module.exports = router;
