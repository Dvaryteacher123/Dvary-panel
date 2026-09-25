const express = require('express');
const router = express.Router();
const deployController = require('../controllers/deployController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Auth kwa routes zote
router.use(ensureAuthenticated);

// ============================================
//  DEPLOY
// ============================================
router.get('/', deployController.getDeployPage);
router.post('/', deployController.postDeploy);

// ============================================
//  STATUS YA SEVA (AJAX)
// ============================================
router.get('/:id/status', deployController.getServerStatus);

module.exports = router;
