const express = require('express')
const router  = express.Router();

//external modules
const isLogin = require('../middleware/isLogin.js')
const {getUserBySearch,getcurrentChatters} = require('../controllers/userrouteController.js');

router.get('/search',isLogin,getUserBySearch);
router.get('/currentChatters',isLogin,getcurrentChatters);

module.exports = router;