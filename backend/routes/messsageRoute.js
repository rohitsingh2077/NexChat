const express= require('express');
const router = express.Router();
//external modules
const {sendMessage} = require('../controllers/messageController.js');
const isLogin = require('../middleware/isLogin.js')
const {getMessage} = require('../controllers/messageController.js');
const { validateSendMessage, validateGetMessages } = require('../middleware/validate.js');
const { rateLimit, byUser } = require('../middleware/rateLimit.js');

// User-keyed flood guard - generous for real typing/sending, tight for a
// scripted spam loop.
const sendMessageRateLimit = rateLimit({ name: "send-dm", windowMs: 10 * 1000, max: 20, keyFn: byUser });

router.post('/send/:id',isLogin,sendMessageRateLimit,validateSendMessage,sendMessage);
router.get('/:id',isLogin,validateGetMessages,getMessage);
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