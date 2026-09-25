const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const serverController = require('../controllers/serverController');
const deployController = require('../controllers/deployController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Middleware ya auth kwa routes zote hapa chini
router.use(ensureAuthenticated);

// ============================================
//  DASHBOARD
// ============================================
router.get('/', dashboardController.getDashboard);

// ============================================
//  SEVA ZANGU
// ============================================
router.get('/servers', dashboardController.getMyServers);
router.get('/servers/:id', dashboardController.getServerDetails);

// Amri za seva
router.post('/servers/:id/power', deployController.powerServer);
router.post('/servers/:id/delete', deployController.deleteServer);
router.post('/servers/:id/rename', serverController.renameServer);
router.post('/servers/:id/reinstall', serverController.reinstallServer);
router.get('/servers/:id/status', deployController.getServerStatus);
router.get('/servers/:id/credentials', deployController.getCredentials);

// ============================================
//  TRANSACTIONS
// ============================================
router.get('/transactions', dashboardController.getTransactions);

// ============================================
//  PROFILE
// ============================================
router.get('/profile', dashboardController.getProfile);
router.post('/profile', dashboardController.updateProfile);

module.exports = router;
