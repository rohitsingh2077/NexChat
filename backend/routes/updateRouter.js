const express = require('express');
const router = express.Router();
const islogin = require('../middleware/isLogin.js');
const updateUserController = require('../controllers/updateController.js');

router.patch("/:id",islogin,updateUserController);

module.exports = router;