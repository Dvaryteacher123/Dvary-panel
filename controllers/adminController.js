const User = require('../models/User');
const Server = require('../models/Server');
const Transaction = require('../models/Transaction');
const axios = require('axios');

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
//  GET /admin
//  Dashibodi kuu ya Admin
// ============================================
exports.getAdminDashboard = async (req, res) => {
  try {
    // --- Takwimu za watumiaji ---
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const bannedUsers = await User.countDocuments({ isBanned: true });

    // Watumiaji waliojisajili leo
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: startOfDay },
    });

    // --- Takwimu za seva ---
    const totalServers = await Server.countDocuments();
    const activeServers = await Server.countDocuments({ status: 'active' });
    const suspendedServers = await Server.countDocuments({
      status: 'suspended',
    });
    const installingServers = await Server.countDocuments({
      status: 'installing',
    });

    // --- Jumla ya RAM inayotumika kwenye mfumo ---
    const ramAgg = await Server.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: null, totalRam: { $sum: '$ram' } } },
    ]);
    const totalRamUsed = ramAgg[0]?.totalRam || 0;

    // --- Jumla ya coins zilizotolewa na kutumiwa ---
    const coinsGivenAgg = await Transaction.aggregate([
      { $match: { type: 'credit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const coinsSpentAgg = await Transaction.aggregate([
      { $match: { type: 'debit' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const coinsGiven = coinsGivenAgg[0]?.total || 0;
    const coinsSpent = coinsSpentAgg[0]?.total || 0;

    // --- Watumiaji 5 walio na seva nyingi (top deployers) ---
    const topDeployers = await Server.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      {
        $group: {
          _id: '$user',
          serverCount: { $sum: 1 },
          totalRam: { $sum: '$ram' },
        },
      },
      { $sort: { serverCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          serverCount: 1,
          totalRam: 1,
          username: '$userInfo.username',
          email: '$userInfo.email',
          coins: '$userInfo.coins',
        },
      },
    ]);

    // --- Seva 5 za hivi karibuni ---
    const recentServers = await Server.find()
      .populate('user', 'username email')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.render('admin/admin-dashboard', {
      title: 'Admin Dashboard',
      layout: 'partials/layout',
      stats: {
        totalUsers,
        totalAdmins,
        bannedUsers,
        newUsersToday,
        totalServers,
        activeServers,
        suspendedServers,
        installingServers,
        totalRamUsed,
        coinsGiven,
        coinsSpent,
      },
      topDeployers,
      recentServers,
    });
  } catch (err) {
    console.error('getAdminDashboard error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia dashibodi ya admin.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  GET /admin/users
//  Orodha ya watumiaji wote (pamoja na idadi ya panels/servers)
// ============================================
exports.getUsersList = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 20;
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    // Filter ya utafutaji
    const filter = {};
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Hesabu idadi ya panels/servers kwa kila mtumiaji
    const userIds = users.map((u) => u._id);
    const serverCounts = await Server.aggregate([
      { $match: { user: { $in: userIds }, status: { $ne: 'deleted' } } },
      {
        $group: {
          _id: '$user',
          panelCount: { $sum: 1 },
          totalRam: { $sum: '$ram' },
        },
      },
    ]);

    const countMap = {};
    serverCounts.forEach((s) => {
      countMap[s._id.toString()] = {
        panelCount: s.panelCount,
        totalRam: s.totalRam,
      };
    });

    // Ambatanisha idadi kwa kila mtumiaji
    const usersWithCounts = users.map((u) => ({
      ...u,
      panelCount: countMap[u._id.toString()]?.panelCount || 0,
      totalRam: countMap[u._id.toString()]?.totalRam || 0,
    }));

    res.render('admin/users-list', {
      title: 'Watumiaji Wote',
      layout: 'partials/layout',
      users: usersWithCounts,
      search,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error('getUsersList error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia orodha ya watumiaji.');
    res.redirect('/admin');
  }
};

// ============================================
//  GET /admin/users/:id
//  Maelezo ya mtumiaji mmoja + servers zake
// ============================================
exports.getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();

    if (!user) {
      req.flash('error_msg', 'Mtumiaji haipatikani.');
      return res.redirect('/admin/users');
    }

    const servers = await Server.find({ user: user._id })
      .sort({ createdAt: -1 })
      .lean();

    const transactions = await Transaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const totalRam = servers
      .filter((s) => s.status !== 'deleted')
      .reduce((sum, s) => sum + s.ram, 0);
    const activeServers = servers.filter(
      (s) => s.status === 'active'
    ).length;

    res.render('admin/user-details', {
      title: `Mtumiaji: ${user.username}`,
      layout: 'partials/layout',
      userData: user,
      servers,
      transactions,
      summary: {
        panelCount: servers.filter((s) => s.status !== 'deleted').length,
        activeServers,
        totalRam,
      },
    });
  } catch (err) {
    console.error('getUserDetails error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia taarifa za mtumiaji.');
    res.redirect('/admin/users');
  }
};

// ============================================
//  POST /admin/users/:id/add-coins
//  Kuongeza coins kwa mtumiaji
// ============================================
exports.addCoins = async (req, res) => {
  const { amount, reason } = req.body;

  try {
    const coinsToAdd = parseInt(amount, 10);

    if (isNaN(coinsToAdd) || coinsToAdd === 0) {
      req.flash('error_msg', 'Kiasi si sahihi.');
      return res.redirect(`/admin/users/${req.params.id}`);
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash('error_msg', 'Mtumiaji haipatikani.');
      return res.redirect('/admin/users');
    }

    const isCredit = coinsToAdd > 0;
    const absAmount = Math.abs(coinsToAdd);

    // Zuia balance isiende negative
    if (!isCredit && user.coins < absAmount) {
      req.flash(
        'error_msg',
        `Mtumiaji hana coins za kutosha. Ana ${user.coins}.`
      );
      return res.redirect(`/admin/users/${user._id}`);
    }

    const newBalance = isCredit
      ? user.coins + absAmount
      : user.coins - absAmount;

    user.coins = newBalance;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: isCredit ? 'credit' : 'debit',
      amount: absAmount,
      balanceAfter: newBalance,
      reason:
        reason ||
        (isCredit
          ? `Coins zilizoongezwa na admin`
          : `Coins zilipunguzwa na admin`),
      performedBy: req.adminUser._id,
    });

    req.flash(
      'success_msg',
      `${isCredit ? 'Umeongeza' : 'Umepunguza'} ${absAmount} coins kwa ${user.username}. Salio jipya: ${newBalance}.`
    );
    res.redirect(`/admin/users/${user._id}`);
  } catch (err) {
    console.error('addCoins error:', err);
    req.flash('error_msg', 'Imeshindwa kubadilisha coins.');
    res.redirect(`/admin/users/${req.params.id}`);
  }
};

// ============================================
//  POST /admin/users/:id/toggle-ban
//  Ban / Unban mtumiaji
// ============================================
exports.toggleBan = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash('error_msg', 'Mtumiaji haipatikani.');
      return res.redirect('/admin/users');
    }

    if (user.role === 'admin') {
      req.flash('error_msg', 'Hauwezi kum-ban admin mwingine.');
      return res.redirect(`/admin/users/${user._id}`);
    }

    user.isBanned = !user.isBanned;
    await user.save();

    req.flash(
      'success_msg',
      `Mtumiaji ${user.username} ${user.isBanned ? 'amebaniwa' : 'amefunguliwa'}.`
    );
    res.redirect(`/admin/users/${user._id}`);
  } catch (err) {
    console.error('toggleBan error:', err);
    req.flash('error_msg', 'Imeshindwa kubadilisha hali ya mtumiaji.');
    res.redirect('/admin/users');
  }
};

// ============================================
//  POST /admin/users/:id/toggle-admin
//  Pandisha / Shusha cheo cha admin
// ============================================
exports.toggleAdminRole = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash('error_msg', 'Mtumiaji haipatikani.');
      return res.redirect('/admin/users');
    }

    if (user._id.toString() === req.adminUser._id.toString()) {
      req.flash('error_msg', 'Hauwezi kubadilisha cheo chako mwenyewe.');
      return res.redirect(`/admin/users/${user._id}`);
    }

    user.role = user.role === 'admin' ? 'user' : 'admin';
    await user.save();

    req.flash(
      'success_msg',
      `Cheo cha ${user.username} sasa ni: ${user.role}.`
    );
    res.redirect(`/admin/users/${user._id}`);
  } catch (err) {
    console.error('toggleAdminRole error:', err);
    req.flash('error_msg', 'Imeshindwa kubadilisha cheo.');
    res.redirect('/admin/users');
  }
};

// ============================================
//  POST /admin/users/:id/delete
//  Futa mtumiaji + servers zake zote
// ============================================
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash('error_msg', 'Mtumiaji haipatikani.');
      return res.redirect('/admin/users');
    }

    if (user._id.toString() === req.adminUser._id.toString()) {
      req.flash('error_msg', 'Hauwezi kujifuta mwenyewe.');
      return res.redirect(`/admin/users/${user._id}`);
    }

    // Futa servers zote kwenye Pterodactyl
    const servers = await Server.find({ user: user._id });
    for (const s of servers) {
      try {
        await ptero.delete(`/servers/${s.pterodactylServerId}`);
      } catch (apiErr) {
        console.warn(
          `Failed to delete Pterodactyl server ${s.pterodactylServerId}:`,
          apiErr.response?.data || apiErr.message
        );
      }
    }

    // Futa kwenye panel yetu
    await Server.deleteMany({ user: user._id });
    await Transaction.deleteMany({ user: user._id });

    // Jaribu kufuta pia kwenye Pterodactyl (user)
    if (user.pterodactylUserId) {
      try {
        await ptero.delete(`/users/${user.pterodactylUserId}`);
      } catch (apiErr) {
        console.warn('Pterodactyl user delete warning:', apiErr.message);
      }
    }

    await User.findByIdAndDelete(user._id);

    req.flash(
      'success_msg',
      `Mtumiaji ${user.username} na seva zake zote zimefutwa.`
    );
    res.redirect('/admin/users');
  } catch (err) {
    console.error('deleteUser error:', err);
    req.flash('error_msg', 'Imeshindwa kufuta mtumiaji.');
    res.redirect('/admin/users');
  }
};

// ============================================
//  GET /admin/servers
//  Orodha ya seva zote zilizodeploy
// ============================================
exports.getServersList = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 20;
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();

    const filter = {};
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }
    if (status && status !== 'all') {
      filter.status = status;
    }

    const [servers, total] = await Promise.all([
      Server.find(filter)
        .populate('user', 'username email coins')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Server.countDocuments(filter),
    ]);

    // Takwimu za status
    const statusStats = await Server.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const statMap = {};
    statusStats.forEach((s) => {
      statMap[s._id] = s.count;
    });

    res.render('admin/servers-list', {
      title: 'Seva Zote',
      layout: 'partials/layout',
      servers,
      search,
      status,
      statMap,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error('getServersList error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia orodha ya seva.');
    res.redirect('/admin');
  }
};

// ============================================
//  POST /admin/servers/:id/suspend
//  Suspend seva (kwenye Pterodactyl pia)
// ============================================
exports.suspendServer = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/admin/servers');
    }

    await ptero.post(`/servers/${server.pterodactylServerId}/suspend`);

    server.status = 'suspended';
    await server.save();

    req.flash('success_msg', `Seva "${server.name}" imesimamishwa.`);
    res.redirect('/admin/servers');
  } catch (err) {
    console.error(
      'suspendServer error:',
      err.response?.data || err.message
    );
    req.flash('error_msg', 'Imeshindwa kusimamisha seva.');
    res.redirect('/admin/servers');
  }
};

// ============================================
//  POST /admin/servers/:id/unsuspend
// ============================================
exports.unsuspendServer = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/admin/servers');
    }

    await ptero.post(`/servers/${server.pterodactylServerId}/unsuspend`);

    server.status = 'active';
    await server.save();

    req.flash('success_msg', `Seva "${server.name}" imefunguliwa.`);
    res.redirect('/admin/servers');
  } catch (err) {
    console.error(
      'unsuspendServer error:',
      err.response?.data || err.message
    );
    req.flash('error_msg', 'Imeshindwa kufungua seva.');
    res.redirect('/admin/servers');
  }
};

// ============================================
//  POST /admin/servers/:id/delete
//  Futa seva kabisa
// ============================================
exports.adminDeleteServer = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id);

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/admin/servers');
    }

    try {
      await ptero.delete(`/servers/${server.pterodactylServerId}`);
    } catch (apiErr) {
      console.warn(
        'Pterodactyl delete warning:',
        apiErr.response?.data || apiErr.message
      );
    }

    server.status = 'deleted';
    await server.save();

    req.flash('success_msg', `Seva "${server.name}" imefutwa.`);
    res.redirect('/admin/servers');
  } catch (err) {
    console.error('adminDeleteServer error:', err);
    req.flash('error_msg', 'Imeshindwa kufuta seva.');
    res.redirect('/admin/servers');
  }
};

// ============================================
//  GET /admin/transactions
//  Historia ya coins zote za mfumo
// ============================================
exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = 30;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find()
        .populate('user', 'username email')
        .populate('performedBy', 'username')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(),
    ]);

    res.render('admin/transactions', {
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
    res.redirect('/admin');
  }
};

// ============================================
//  POST /admin/broadcast-coins
//  Ongeza coins kwa watumiaji wote kwa mkupuo
// ============================================
exports.broadcastCoins = async (req, res) => {
  const { amount, reason } = req.body;

  try {
    const coinsToAdd = parseInt(amount, 10);

    if (isNaN(coinsToAdd) || coinsToAdd <= 0) {
      req.flash('error_msg', 'Kiasi si sahihi.');
      return res.redirect('/admin');
    }

    const users = await User.find();

    for (const user of users) {
      user.coins += coinsToAdd;
      await user.save();

      await Transaction.create({
        user: user._id,
        type: 'credit',
        amount: coinsToAdd,
        balanceAfter: user.coins,
        reason: reason || 'Bonus ya admin kwa watumiaji wote',
        performedBy: req.adminUser._id,
      });
    }

    req.flash(
      'success_msg',
      `Umewapa watumiaji ${users.length} coins ${coinsToAdd} kila mmoja.`
    );
    res.redirect('/admin');
  } catch (err) {
    console.error('broadcastCoins error:', err);
    req.flash('error_msg', 'Imeshindwa kutuma coins kwa wote.');
    res.redirect('/admin');
  }
};
