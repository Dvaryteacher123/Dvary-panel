const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const {
  ensureAuthenticated,
} = require('../middleware/authMiddleware');
const { ensureAdmin } = require('../middleware/adminMiddleware');

// ============================================
//  LAYERS ZA USALAMA
//  1. ensureAuthenticated - lazima awe logged in
//  2. ensureAdmin - lazima awe admin
// ============================================
router.use(ensureAuthenticated);
router.use(ensureAdmin);

// ============================================
//  DASHIBODI YA ADMIN
// ============================================
router.get('/', adminController.getAdminDashboard);

// ============================================
//  WATUMIAJI
// ============================================
router.get('/users', adminController.getUsersList);
router.get('/users/:id', adminController.getUserDetails);
router.post('/users/:id/add-coins', adminController.addCoins);
router.post('/users/:id/toggle-ban', adminController.toggleBan);
router.post('/users/:id/toggle-admin', adminController.toggleAdminRole);
router.post('/users/:id/delete', adminController.deleteUser);

// ============================================
//  SEVA
// ============================================
router.get('/servers', adminController.getServersList);
router.post('/servers/:id/suspend', adminController.suspendServer);
router.post('/servers/:id/unsuspend', adminController.unsuspendServer);
router.post('/servers/:id/delete', adminController.adminDeleteServer);

// ============================================
//  TRANSACTIONS
// ============================================
router.get('/transactions', adminController.getTransactions);

// ============================================
//  BROADCAST COINS
// ============================================
router.post('/broadcast-coins', adminController.broadcastCoins);

module.exports = router;
