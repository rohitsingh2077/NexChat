const express= require('express');
const router = express.Router();
//external modules
const {sendMessage} = require('../controllers/messageController.js');
const isLogin = require('../middleware/isLogin.js')
const {getMessage} = require('../controllers/messageController.js');

router.post('/send/:id',isLogin,sendMessage);
router.get('/:id',isLogin,getMessage);
// router.get('/unreadCount/:id',islogin,getUnreadCount);

module.exports = router;


/*
real-time chat
typing indicators
friend system
profile system
modals
UI/UX polish
backend APIs
authentication
database design
state management
REST architecture
*/