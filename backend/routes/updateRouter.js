const express = require('express');
const router = express.Router();
const islogin = require('../middleware/isLogin.js');
const { validateUpdateProfile } = require('../middleware/validate.js');
const updateUserController = require('../controllers/updateController.js');

router.patch("/", islogin, validateUpdateProfile, updateUserController);

module.exports = router;