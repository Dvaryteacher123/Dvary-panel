const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');
const deployController = require('../controllers/deployController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// ============================================
//  KUNUNUA / KUONGEZA RAM
// ============================================
router.get('/servers/buy', ensureAuthenticated, serverController.getBuyPage);
router.post('/servers/buy', ensureAuthenticated, serverController.postBuyRam);

// ============================================
//  UPGRADE (DISK)
// ============================================
router.get(
  '/servers/upgrade',
  ensureAuthenticated,
  serverController.getUpgradePage
);
router.post(
  '/servers/upgrade-disk',
  ensureAuthenticated,
  serverController.postUpgradeDisk
);

// ============================================
//  STATUS API (JSON) - kwa AJAX polling
// ============================================
router.get(
  '/server/:id/status',
  ensureAuthenticated,
  deployController.getServerStatus
);

// ============================================
//  HEALTH CHECK (kwa Render)
// ============================================
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
