const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { ensureGuest } = require('../middleware/authMiddleware');

// ============================================
//  REGISTER
// ============================================
router.get('/register', ensureGuest, authController.getRegister);
router.post('/register', ensureGuest, authController.postRegister);

// ============================================
//  LOGIN
// ============================================
router.get('/login', ensureGuest, authController.getLogin);
router.post('/login', ensureGuest, authController.postLogin);

// ============================================
//  LOGOUT
// ============================================
router.get('/logout', authController.logout);
router.post('/logout', authController.logout);

module.exports = router;
