const axios = require('axios');
const User = require('../models/User');
const Server = require('../models/Server');
const Transaction = require('../models/Transaction');

// ============================================
//  PTERODACTYL API CLIENT
// ============================================
const ptero = axios.create({
  baseURL: `${process.env.PTERODACTYL_PANEL_URL}/api/application`,
  headers: {
    Authorization: `Bearer ${process.env.PTERODACTYL_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
});

// ============================================
//  GET /servers/buy
//  Ukurasa wa kununua RAM ya ziada
// ============================================
exports.getBuyPage = async (req, res) => {
  try {
    const userServers = await Server.find({
      user: req.user._id,
      status: { $ne: 'deleted' },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render('buy-server', {
      title: 'Nunua RAM ya Ziada',
      layout: 'partials/layout',
      userServers,
      pricing: {
        coinsPerMb: parseInt(process.env.COINS_PER_MB || '1', 10),
        minRam: parseInt(process.env.MIN_RAM_MB || '128', 10),
        maxRam: parseInt(process.env.MAX_RAM_MB || '4096', 10),
      },
      currentCoins: req.user.coins,
    });
  } catch (err) {
    console.error('getBuyPage error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia ukurasa.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  POST /servers/buy
//  Ongeza RAM kwenye seva iliyopo
// ============================================
exports.postBuyRam = async (req, res) => {
  const { serverId, additionalRam } = req.body;

  try {
    // --- Validations ---
    if (!serverId || !additionalRam) {
      req.flash('error_msg', 'Chagua seva na kiasi cha RAM.');
      return res.redirect('/servers/buy');
    }

    const addRam = parseInt(additionalRam, 10);
    const coinsPerMb = parseInt(process.env.COINS_PER_MB || '1', 10);
    const maxRam = parseInt(process.env.MAX_RAM_MB || '4096', 10);

    if (isNaN(addRam) || addRam <= 0) {
      req.flash('error_msg', 'Kiasi cha RAM si sahihi.');
      return res.redirect('/servers/buy');
    }

    // --- Pata seva na hakikisha ni ya mtumiaji ---
    const server = await Server.findOne({
      _id: serverId,
      user: req.user._id,
      status: { $ne: 'deleted' },
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/servers/buy');
    }

    // --- Angalia RAM ya juu ---
    const newRam = server.ram + addRam;
    if (newRam > maxRam) {
      req.flash(
        'error_msg',
        `RAM ya juu kabisa ni ${maxRam}MB. Seva yako ina ${server.ram}MB.`
      );
      return res.redirect('/servers/buy');
    }

    const coinsNeeded = addRam * coinsPerMb;

    // --- Fresh user ---
    const freshUser = await User.findById(req.user._id);

    if (freshUser.coins < coinsNeeded) {
      req.flash(
        'error_msg',
        `Huna coins za kutosha. Unahitaji ${coinsNeeded}, unayo ${freshUser.coins}.`
      );
      return res.redirect('/servers/buy');
    }

    // --- Sasisha RAM kwenye Pterodactyl ---
    // Tunahitaji kuchukua taarifa za seva kwanza (ili tupate values zote)
    const pteroGet = await ptero.get(
      `/servers/${server.pterodactylServerId}`
    );
    const currentAttrs = pteroGet.data.attributes;

    const updatePayload = {
      name: currentAttrs.name,
      user: currentAttrs.user,
      egg: currentAttrs.egg,
      docker_image: currentAttrs.docker_image,
      startup: currentAttrs.container.startup_command,
      environment: currentAttrs.container.environment,
      limits: {
        memory: newRam,
        swap: currentAttrs.limits.swap,
        disk: currentAttrs.limits.disk,
        io: currentAttrs.limits.io,
        cpu: currentAttrs.limits.cpu,
      },
      feature_limits: {
        databases: currentAttrs.feature_limits.databases,
        backups: currentAttrs.feature_limits.backups,
        allocations: currentAttrs.feature_limits.allocations,
      },
    };

    await ptero.patch(
      `/servers/${server.pterodactylServerId}`,
      updatePayload
    );

    // --- Toa coins ---
    const newBalance = freshUser.coins - coinsNeeded;
    freshUser.coins = newBalance;
    await freshUser.save();

    // --- Update server ---
    server.ram = newRam;
    server.coinsSpent = server.coinsSpent + coinsNeeded;
    await server.save();

    // --- Rekodi transaction ---
    await Transaction.create({
      user: freshUser._id,
      type: 'debit',
      amount: coinsNeeded,
      balanceAfter: newBalance,
      reason: `Ongeza ${addRam}MB RAM kwenye seva "${server.name}"`,
      meta: {
        pterodactylServerId: server.pterodactylServerId,
        newRam,
      },
    });

    // Sasisha session
    req.session.user.coins = newBalance;

    req.flash(
      'success_msg',
      `RAM ya seva "${server.name}" imeongezwa hadi ${newRam}MB. Restart seva ili mabadiliko yatumike.`
    );
    return res.redirect(`/dashboard/servers/${server._id}`);
  } catch (err) {
    console.error(
      'postBuyRam error:',
      err.response?.data || err.message
    );
    const apiErr =
      err.response?.data?.errors?.[0]?.detail ||
      err.response?.data?.errors?.[0]?.code ||
      err.message;
    req.flash('error_msg', `Imeshindwa kuongeza RAM: ${apiErr}`);
    return res.redirect('/servers/buy');
  }
};

// ============================================
//  GET /servers/upgrade
//  Ukurasa wa kuongeza disk / cpu (badala ya RAM)
// ============================================
exports.getUpgradePage = async (req, res) => {
  try {
    const userServers = await Server.find({
      user: req.user._id,
      status: { $ne: 'deleted' },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render('upgrade-server', {
      title: 'Boresha Seva',
      layout: 'partials/layout',
      userServers,
      currentCoins: req.user.coins,
    });
  } catch (err) {
    console.error('getUpgradePage error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia ukurasa.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  POST /servers/upgrade-disk
//  Ongeza disk kwenye seva (kwa coins)
// ============================================
exports.postUpgradeDisk = async (req, res) => {
  const { serverId, additionalDisk } = req.body;

  try {
    if (!serverId || !additionalDisk) {
      req.flash('error_msg', 'Chagua seva na kiasi cha disk.');
      return res.redirect('/servers/upgrade');
    }

    const addDisk = parseInt(additionalDisk, 10);
    // Disk inagharimu nusu ya RAM
    const coinsPerMb = parseInt(process.env.COINS_PER_MB || '1', 10);
    const coinsPerDiskMb = Math.max(1, Math.floor(coinsPerMb / 2));

    if (isNaN(addDisk) || addDisk <= 0) {
      req.flash('error_msg', 'Kiasi cha disk si sahihi.');
      return res.redirect('/servers/upgrade');
    }

    const server = await Server.findOne({
      _id: serverId,
      user: req.user._id,
      status: { $ne: 'deleted' },
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/servers/upgrade');
    }

    const newDisk = server.disk + addDisk;
    const coinsNeeded = addDisk * coinsPerDiskMb;

    const freshUser = await User.findById(req.user._id);

    if (freshUser.coins < coinsNeeded) {
      req.flash(
        'error_msg',
        `Huna coins za kutosha. Unahitaji ${coinsNeeded}, unayo ${freshUser.coins}.`
      );
      return res.redirect('/servers/upgrade');
    }

    // Sasisha Pterodactyl
    const pteroGet = await ptero.get(
      `/servers/${server.pterodactylServerId}`
    );
    const currentAttrs = pteroGet.data.attributes;

    await ptero.patch(`/servers/${server.pterodactylServerId}`, {
      name: currentAttrs.name,
      user: currentAttrs.user,
      egg: currentAttrs.egg,
      docker_image: currentAttrs.docker_image,
      startup: currentAttrs.container.startup_command,
      environment: currentAttrs.container.environment,
      limits: {
        memory: currentAttrs.limits.memory,
        swap: currentAttrs.limits.swap,
        disk: newDisk,
        io: currentAttrs.limits.io,
        cpu: currentAttrs.limits.cpu,
      },
      feature_limits: {
        databases: currentAttrs.feature_limits.databases,
        backups: currentAttrs.feature_limits.backups,
        allocations: currentAttrs.feature_limits.allocations,
      },
    });

    // Toa coins
    const newBalance = freshUser.coins - coinsNeeded;
    freshUser.coins = newBalance;
    await freshUser.save();

    server.disk = newDisk;
    server.coinsSpent = server.coinsSpent + coinsNeeded;
    await server.save();

    await Transaction.create({
      user: freshUser._id,
      type: 'debit',
      amount: coinsNeeded,
      balanceAfter: newBalance,
      reason: `Ongeza ${addDisk}MB DISK kwenye seva "${server.name}"`,
      meta: { pterodactylServerId: server.pterodactylServerId, newDisk },
    });

    req.session.user.coins = newBalance;

    req.flash(
      'success_msg',
      `Disk ya seva "${server.name}" imeongezwa hadi ${newDisk}MB.`
    );
    return res.redirect(`/dashboard/servers/${server._id}`);
  } catch (err) {
    console.error(
      'postUpgradeDisk error:',
      err.response?.data || err.message
    );
    const apiErr =
      err.response?.data?.errors?.[0]?.detail ||
      err.response?.data?.errors?.[0]?.code ||
      err.message;
    req.flash('error_msg', `Imeshindwa kuongeza disk: ${apiErr}`);
    return res.redirect('/servers/upgrade');
  }
};

// ============================================
//  POST /servers/:id/rename
//  Badilisha jina la seva
// ============================================
exports.renameServer = async (req, res) => {
  const { newName } = req.body;

  try {
    if (!newName || newName.trim().length < 2) {
      req.flash('error_msg', 'Jina jipya si sahihi.');
      return res.redirect(`/dashboard/servers/${req.params.id}`);
    }

    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    const pteroGet = await ptero.get(
      `/servers/${server.pterodactylServerId}`
    );
    const currentAttrs = pteroGet.data.attributes;

    await ptero.patch(`/servers/${server.pterodactylServerId}`, {
      name: newName.trim().slice(0, 60),
      user: currentAttrs.user,
      egg: currentAttrs.egg,
      docker_image: currentAttrs.docker_image,
      startup: currentAttrs.container.startup_command,
      environment: currentAttrs.container.environment,
      limits: currentAttrs.limits,
      feature_limits: currentAttrs.feature_limits,
    });

    server.name = newName.trim().slice(0, 60);
    await server.save();

    req.flash('success_msg', 'Jina la seva limebadilishwa.');
    res.redirect(`/dashboard/servers/${server._id}`);
  } catch (err) {
    console.error(
      'renameServer error:',
      err.response?.data || err.message
    );
    req.flash('error_msg', 'Imeshindwa kubadilisha jina.');
    res.redirect(`/dashboard/servers/${req.params.id}`);
  }
};

// ============================================
//  POST /servers/:id/reinstall
//  Reinstall seva (kwa coins ndogo)
// ============================================
exports.reinstallServer = async (req, res) => {
  const REINSTALL_COST = 10;

  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    const freshUser = await User.findById(req.user._id);

    if (freshUser.coins < REINSTALL_COST) {
      req.flash(
        'error_msg',
        `Reinstall inagharimu ${REINSTALL_COST} coins. Huna za kutosha.`
      );
      return res.redirect(`/dashboard/servers/${server._id}`);
    }

    await ptero.post(
      `/servers/${server.pterodactylServerId}/reinstall`
    );

    // Toa coins
    const newBalance = freshUser.coins - REINSTALL_COST;
    freshUser.coins = newBalance;
    await freshUser.save();

    await Transaction.create({
      user: freshUser._id,
      type: 'debit',
      amount: REINSTALL_COST,
      balanceAfter: newBalance,
      reason: `Reinstall seva "${server.name}"`,
      meta: { pterodactylServerId: server.pterodactylServerId },
    });

    req.session.user.coins = newBalance;

    req.flash('success_msg', 'Seva inareinstall. Subiri dakika chache.');
    res.redirect(`/dashboard/servers/${server._id}`);
  } catch (err) {
    console.error(
      'reinstallServer error:',
      err.response?.data || err.message
    );
    req.flash('error_msg', 'Imeshindwa kureinstall seva.');
    res.redirect(`/dashboard/servers/${req.params.id}`);
  }
};
