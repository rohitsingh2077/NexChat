const express = require('express')
const router  = express.Router();

//external modules
const isLogin = require('../middleware/isLogin.js')
const { validateObjectIdParam } = require('../middleware/validate.js');
const {getUserBySearch,getcurrentChatters,getUserProfile} = require('../controllers/userrouteController.js');

router.get('/search',isLogin,getUserBySearch);
router.get('/currentChatters',isLogin,getcurrentChatters);
router.get('/:userId/profile', isLogin, validateObjectIdParam('userId'), getUserProfile);

module.exports = router;