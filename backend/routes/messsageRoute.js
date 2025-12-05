const express= require('express');
const router = express.Router();
//external modules
const {sendMessage} = require('../controllers/messageController.js');
const islogin = require('../middleware/isLogin.js');
const {getMessage} = require('../controllers/messageController.js');

router.post('/send/:id',islogin,sendMessage);
router.get('/:id',islogin,getMessage);

module.exports = router;