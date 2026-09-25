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
//  HELPERS
// ============================================

// Tengeneza username ya pterodactyl kutoka kwa jina la mtumiaji
const generatePteroUsername = (base) => {
  const clean = base.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${clean.slice(0, 10)}${rand}`.slice(0, 20);
};

// Tengeneza password nasibu
const generatePassword = () => {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let pass = '';
  for (let i = 0; i < 16; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

// Hakikisha mtumiaji ana akaunti ya Pterodactyl
const ensurePteroUser = async (user) => {
  // Kama tayari ana ID na password
  if (user.pterodactylUserId && user.pterodactylPassword) {
    return {
      id: user.pterodactylUserId,
      password: user.pterodactylPassword,
    };
  }

  const password = generatePassword();
  let username = generatePteroUsername(user.username);
  let email = user.email;

  // Jaribu kuunda mara 3 kama username imetumika
  let pteroUser = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ptero.post('/users', {
        email,
        username,
        first_name: user.username.slice(0, 20),
        last_name: 'User',
        password,
        root_admin: false,
        language: 'en',
      });
      pteroUser = res.data.attributes;
      break;
    } catch (err) {
      const status = err.response?.status;
      const errors = err.response?.data?.errors || [];
      const firstErr = errors[0]?.code || '';

      // Kama username/email imetumika, badilisha na jaribu tena
      if (
        status === 422 &&
        (firstErr.includes('username') || firstErr.includes('email'))
      ) {
        username = generatePteroUsername(user.username);
        email = `${username}@${(process.env.PTERODACTYL_PANEL_URL || '')
          .replace(/^https?:\/\//, '')
          .replace(/\//g, '')}`;
        continue;
      }
      throw err;
    }
  }

  if (!pteroUser) {
    throw new Error('Imeshindwa kuunda akaunti ya Pterodactyl.');
  }

  user.pterodactylUserId = pteroUser.id;
  user.pterodactylPassword = password;
  await user.save();

  return { id: pteroUser.id, password };
};

// Pata allocation ya bure kwenye node
const getFreeAllocation = async (nodeId) => {
  const res = await ptero.get(
    `/nodes/${nodeId}/allocations?per_page=100`
  );
  const allocations = res.data.data || [];
  const free = allocations.find(
    (a) => a.attributes && !a.attributes.assigned
  );
  if (!free) {
    throw new Error(
      'Hakuna allocation ya bure kwenye node. Wasiliana na admin.'
    );
  }
  return free.attributes.id;
};

// ============================================
//  GET /deploy
//  Ukurasa wa ku-deploy bot mpya
// ============================================
exports.getDeployPage = async (req, res) => {
  try {
    const userServers = await Server.find({
      user: req.user._id,
      status: { $ne: 'deleted' },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.render('deploy', {
      title: 'Deploy Bot Mpya',
      layout: 'partials/layout',
      userServers,
      pricing: {
        coinsPerMb: parseInt(process.env.COINS_PER_MB || '1', 10),
        minRam: parseInt(process.env.MIN_RAM_MB || '128', 10),
        maxRam: parseInt(process.env.MAX_RAM_MB || '4096', 10),
      },
    });
  } catch (err) {
    console.error('getDeployPage error:', err);
    req.flash('error_msg', 'Imeshindwa kupakia ukurasa wa deploy.');
    res.redirect('/dashboard');
  }
};

// ============================================
//  POST /deploy
//  Ku-deploy bot mpya moja kwa moja kwa Pterodactyl
// ============================================
exports.postDeploy = async (req, res) => {
  const { serverName, ram, botType, notes } = req.body;

  try {
    // --- Validations ---
    if (!serverName || !ram) {
      req.flash('error_msg', 'Jaza jina la seva na RAM.');
      return res.redirect('/deploy');
    }

    const ramMB = parseInt(ram, 10);
    const coinsPerMb = parseInt(process.env.COINS_PER_MB || '1', 10);
    const minRam = parseInt(process.env.MIN_RAM_MB || '128', 10);
    const maxRam = parseInt(process.env.MAX_RAM_MB || '4096', 10);

    if (isNaN(ramMB) || ramMB < minRam || ramMB > maxRam) {
      req.flash(
        'error_msg',
        `RAM iwe kati ya ${minRam}MB na ${maxRam}MB.`
      );
      return res.redirect('/deploy');
    }

    const coinsNeeded = ramMB * coinsPerMb;

    // Fresh user data
    const freshUser = await User.findById(req.user._id);

    if (freshUser.coins < coinsNeeded) {
      req.flash(
        'error_msg',
        `Huna coins za kutosha. Unahitaji ${coinsNeeded} coins, unayo ${freshUser.coins}.`
      );
      return res.redirect('/deploy');
    }

    // --- Hakikisha akaunti ya Pterodactyl ---
    const pteroAccount = await ensurePteroUser(freshUser);

    // --- Pata allocation ya bure ---
    const nodeId = parseInt(process.env.PTERODACTYL_DEFAULT_NODE || '1', 10);
    const allocationId = await getFreeAllocation(nodeId);

    // --- Tengeneza seva kwenye Pterodactyl ---
    const nestId = parseInt(process.env.PTERODACTYL_DEFAULT_NEST || '1', 10);
    const eggId = parseInt(process.env.PTERODACTYL_DEFAULT_EGG || '15', 10);
    const dockerImage =
      process.env.PTERODACTYL_DEFAULT_DOCKER ||
      'ghcr.io/parkervcp/yolks:nodejs_18';

    const serverPayload = {
      name: serverName.trim().slice(0, 60),
      user: pteroAccount.id,
      egg: eggId,
      docker_image: dockerImage,
      startup:
        'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN}',
      environment: {
        CMD_RUN: 'npm start',
        AUTO_UPDATE: '0',
        USER_UPLOAD: '0',
        NODE_PACKAGES: '',
        UNNODE_PACKAGES: '',
      },
      limits: {
        memory: ramMB,
        swap: 0,
        disk: 1024,
        io: 500,
        cpu: 100,
      },
      feature_limits: {
        databases: 0,
        backups: 0,
        allocations: 1,
      },
      allocation: {
        default: allocationId,
      },
      start_on_completion: true,
    };

    const createRes = await ptero.post('/servers', serverPayload);
    const pteroServer = createRes.data.attributes;

    // --- Toa coins kwa mtumiaji ---
    const newBalance = freshUser.coins - coinsNeeded;
    freshUser.coins = newBalance;
    await freshUser.save();

    // --- Rekodi transaction ---
    await Transaction.create({
      user: freshUser._id,
      type: 'debit',
      amount: coinsNeeded,
      balanceAfter: newBalance,
      reason: `Kununua seva: ${serverName} (${ramMB}MB RAM)`,
      meta: { pterodactylServerId: pteroServer.id },
    });

    // --- Hifadhi kwenye DB yetu ---
    await Server.create({
      user: freshUser._id,
      name: serverName.trim(),
      pterodactylServerId: pteroServer.id,
      pterodactylIdentifier: pteroServer.identifier,
      ram: ramMB,
      disk: 1024,
      cpu: 100,
      coinsSpent: coinsNeeded,
      status: 'installing',
      node: nodeId,
      egg: eggId,
      dockerImage,
      botType: botType || 'whatsapp-bot',
      notes: notes || '',
    });

    // Sasisha session coins
    req.session.user.coins = newBalance;

    req.flash(
      'success_msg',
      `Bot "${serverName}" imeundwa kwa mafanikio! Inaendelea kusanikishwa.`
    );
    return res.redirect('/dashboard/servers');
  } catch (err) {
    console.error(
      'postDeploy error:',
      err.response?.data || err.message
    );
    const apiErr =
      err.response?.data?.errors?.[0]?.detail ||
      err.response?.data?.errors?.[0]?.code ||
      err.message;
    req.flash('error_msg', `Imeshindwa ku-deploy: ${apiErr}`);
    return res.redirect('/deploy');
  }
};

// ============================================
//  POST /deploy/:id/delete
//  Kufuta seva
// ============================================
exports.deleteServer = async (req, res) => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    // Futa kwenye Pterodactyl
    try {
      await ptero.delete(`/servers/${server.pterodactylServerId}`);
    } catch (apiErr) {
      console.warn(
        'Pterodactyl delete warning:',
        apiErr.response?.data || apiErr.message
      );
    }

    // Badilisha status badala ya kuifuta kabisa (kwa rekodi)
    server.status = 'deleted';
    await server.save();

    req.flash('success_msg', `Seva "${server.name}" imefutwa.`);
    res.redirect('/dashboard/servers');
  } catch (err) {
    console.error('deleteServer error:', err);
    req.flash('error_msg', 'Imeshindwa kufuta seva.');
    res.redirect('/dashboard/servers');
  }
};

// ============================================
//  POST /deploy/:id/power
//  Kuwasha / kuzima / restart seva
// ============================================
exports.powerServer = async (req, res) => {
  const { signal } = req.body; // start | stop | restart | kill

  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    if (!['start', 'stop', 'restart', 'kill'].includes(signal)) {
      req.flash('error_msg', 'Amri batili.');
      return res.redirect('/dashboard/servers');
    }

    await ptero.post(
      `/servers/${server.pterodactylServerId}/power`,
      { signal }
    );

    req.flash('success_msg', `Amri "${signal}" imetumwa.`);
    res.redirect(`/dashboard/servers/${server._id}`);
  } catch (err) {
    console.error(
      'powerServer error:',
      err.response?.data || err.message
    );
    req.flash('error_msg', 'Imeshindwa kutuma amri ya nishati.');
    res.redirect('/dashboard/servers');
  }
};

// ============================================
//  GET /deploy/:id/status
//  Angalia hali ya seva (JSON API)
// ============================================
exports.getServerStatus = async (req, res) => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      return res.status(404).json({ error: 'Seva haipatikani.' });
    }

    // Pata info kutoka Pterodactyl
    const pteroRes = await ptero.get(
      `/servers/${server.pterodactylServerId}`
    );

    const attrs = pteroRes.data.attributes;

    // Sasisha status kwenye DB yetu kama imebadilika
    if (attrs.status && attrs.status !== server.status) {
      const map = {
        installing: 'installing',
        running: 'active',
        offline: 'active',
        suspended: 'suspended',
      };
      const mapped = map[attrs.status] || server.status;
      if (mapped !== server.status) {
        server.status = mapped;
        await server.save();
      }
    }

    return res.json({
      success: true,
      status: attrs.status,
      identifier: attrs.identifier,
      name: attrs.name,
      limits: attrs.limits,
    });
  } catch (err) {
    console.error(
      'getServerStatus error:',
      err.response?.data || err.message
    );
    return res.status(500).json({ error: 'Imeshindwa kupata hali ya seva.' });
  }
};

// ============================================
//  GET /deploy/:id/credentials
//  Onyesha username/password ya panel kwa mtumiaji
// ============================================
exports.getCredentials = async (req, res) => {
  try {
    const server = await Server.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!server) {
      req.flash('error_msg', 'Seva haipatikani.');
      return res.redirect('/dashboard/servers');
    }

    const user = await User.findById(req.user._id);

    res.render('server-credentials', {
      title: `Panel Login - ${server.name}`,
      layout: 'partials/layout',
      server,
      panelUrl: process.env.PTERODACTYL_PANEL_URL,
      pteroUsername: user.username,
      pteroPassword: user.pterodactylPassword || '(uliweka password yako mwenyewe)',
    });
  } catch (err) {
    console.error('getCredentials error:', err);
    req.flash('error_msg', 'Imeshindwa kupata taarifa za kuingia.');
    res.redirect('/dashboard/servers');
  }
};
