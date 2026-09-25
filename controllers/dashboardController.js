const User = require('../models/User');
const Server = require('../models/Server');
const Transaction = require('../models/Transaction');

// ============================================
//  GET /dashboard
//  Dashibodi kuu ya mtumiaji wa kawaida
// ============================================
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // --- Takwimu za seva ---
    const totalServers = await Server.countDocuments({ user: userId });
    const activeServers = await Server.countDocuments({
      user: userId,
      status: 'active',
    });
    const suspendedServers = await Server.countDocuments({
      user: userId,
      status: 'suspended',
    });

    // --- Jumla ya RAM iliyotumika ---
    const ramAgg = await Server.aggregate([
      { $match: { user: userId, status: { $ne: 'deleted' } } },
      { $group: { _id: null, totalRam: { $sum: '$ram' } } },
    ]);
    const totalRamUsed = ramAgg[0]?.totalRam || 0;

    // --- Jumla ya coins zilizotumika ---
    const coinsAgg = await Server.aggregate([
      { $match: { user: userId } },
      { $group: { _id: null, totalCoins: { $sum: '$coinsSpent' } } },
    ]);
    const totalCoinsSpent = coinsAgg[0]?.totalCoins || 0;

    // --- Seva 5 za hivi karibuni ---
    const recentServers = await Server.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // --- Transactions 5 za hivi karibuni ---
    const recentTransactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.render('dashboard', {
      title: 'Dashibodi',
      layout: 'partials/layout',
      stats: {
        totalServers,
        activeServers,
        suspendedServers,
        totalRamUsed,
        totalCoinsSpent,
        currentCoins: req.user.coins,
      },
      recentServers,
      recentTransactions,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia dashibodi.');
    res.redirect('/');
  }
};

// ============================================
//  GET /dashboard/servers
//  Orodha kamili ya seva za mtumiaji
// ============================================
exports.getMyServers = async (req, res) => {
  try {
    const servers = await Server.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.render('my-servers', {
      title: 'Seva Zangu',
      layout: 'partials/layout',
      servers,
    });
  } catch (err) {
    console.error('getMyServers error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia seva zako.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  GET /dashboard/servers/:id
//  Maelezo ya seva moja
// ============================================
exports.getServerDetails = async (req, res) => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).lean();

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    res.render('server-details', {
      title: `Seva: ${server.name}`,
      layout: 'partials/layout',
      server,
    });
  } catch (err) {
    console.error('getServerDetails error:', err);
    req.flash('error_msg', 'Hitilafu wakati wa kupakia seva.');
    res.redirect('/dashboard/servers');
  }
};

// ============================================
//  GET /dashboard/transactions
//  Historia ya coins
// ============================================
exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ user: req.user._id }),
    ]);

    res.render('transactions', {
      title: 'Historia ya Coins',
      layout: 'partials/layout',
      transactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error('getTransactions error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia historia.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  GET /dashboard/profile
// ============================================
exports.getProfile = async (req, res) => {
  res.render('profile', {
    title: 'Wasifu Wangu',
    layout: 'partials/layout',
    user: req.user,
  });
};

// ============================================
//  POST /dashboard/profile
//  Badilisha username / email
// ============================================
exports.updateProfile = async (req, res) => {
  const { username, email } = req.body;

  try {
    if (!username || !email) {
      req.flash('error_msg', 'Jaza sehemu zote.');
      return res.redirect('/dashboard/profile');
    }

    // Angalia kama username/email zinamilikiwa na mtu mwingine
    const conflict = await User.findOne({
      _id: { $ne: req.user._id },
      $or: [{ username }, { email: email.toLowerCase() }],
    });

    if (conflict) {
      req.flash('error_msg', 'Jina la mtumiaji au barua pepe linatumika.');
      return res.redirect('/dashboard/profile');
    }

    req.user.username = username.trim();
    req.user.email = email.toLowerCase().trim();
    await req.user.save();

    // Sasisha session
    req.session.user.username = req.user.username;
    req.session.user.email = req.user.email;

    req.flash('success_msg', 'Wasifu umesasishwa kwa mafanikio.');
    res.redirect('/dashboard/profile');
  } catch (err) {
    console.error('updateProfile error:', err);
    req.flash('error_msg', 'Imeshindwa kusasisha wasifu.');
    res.redirect('/dashboard/profile');
  }
};
