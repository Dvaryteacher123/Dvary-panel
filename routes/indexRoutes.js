const express = require('express');
const router = express.Router();
const Server = require('../models/Server');
const User = require('../models/User');

// ============================================
//  GET /
//  Landing page
// ============================================
router.get('/', async (req, res) => {
  try {
    const totalServers = await Server.countDocuments({
      status: { $ne: 'deleted' },
    });
    const totalUsers = await User.countDocuments();
    const activeServers = await Server.countDocuments({ status: 'active' });

    res.render('index', {
      title: 'Hosting Panel - Deploy Bots kwa Coins',
      layout: 'partials/layout',
      stats: {
        totalServers,
        totalUsers,
        activeServers,
      },
      pricing: {
        coinsPerMb: parseInt(process.env.COINS_PER_MB || '1', 10),
        minRam: parseInt(process.env.MIN_RAM_MB || '128', 10),
        maxRam: parseInt(process.env.MAX_RAM_MB || '4096', 10),
        welcomeCoins: parseInt(process.env.WELCOME_COINS || '0', 10),
      },
    });
  } catch (err) {
    console.error('Landing error:', err);
    res.render('index', {
      title: 'Hosting Panel',
      layout: 'partials/layout',
      stats: { totalServers: 0, totalUsers: 0, activeServers: 0 },
      pricing: {
        coinsPerMb: 1,
        minRam: 128,
        maxRam: 4096,
        welcomeCoins: 0,
      },
    });
  }
});

// ============================================
//  GET /pricing
// ============================================
router.get('/pricing', (req, res) => {
  res.render('pricing', {
    title: 'Bei',
    layout: 'partials/layout',
    pricing: {
      coinsPerMb: parseInt(process.env.COINS_PER_MB || '1', 10),
      minRam: parseInt(process.env.MIN_RAM_MB || '128', 10),
      maxRam: parseInt(process.env.MAX_RAM_MB || '4096', 10),
      welcomeCoins: parseInt(process.env.WELCOME_COINS || '0', 10),
    },
  });
});

// ============================================
//  GET /terms
// ============================================
router.get('/terms', (req, res) => {
  res.render('terms', {
    title: 'Masharti',
    layout: 'partials/layout',
  });
});

module.exports = router;
