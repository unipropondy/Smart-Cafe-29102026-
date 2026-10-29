const express = require('express');
const router = express.Router();
const { handleChat, handleQuery, handleDashboard } = require('../controllers/chat.controller');

router.post('/chat', handleChat);
router.post('/query', handleQuery);
router.get('/dashboard', handleDashboard);

module.exports = router;
