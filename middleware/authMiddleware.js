 // ============================================
//  AUTH MIDDLEWARE
//  Inahakikisha mtumiaji ameingia (logged in)
// ============================================

const User = require('../models/User');

/**
 * ensureAuthenticated
 * - Kama mtumiaji hajalogin → redirect kwenye /auth/login
 * - Kama amebanned → session inafutwa + redirect
 */
const ensureAuthenticated = async (req, res, next) => {
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.flash('error_msg', 'Tafadhali ingia kwanza ili kuendelea.');
    return res.redirect('/auth/login');
  }

  try {
    const user = await User.findById(req.session.user.id);

    if (!user) {
      req.session.destroy(() => {});
      req.flash('error_msg', 'Akaunti haipatikani.');
      return res.redirect('/auth/login');
    }

    if (user.isBanned) {
      req.session.destroy(() => {});
      req.flash('error_msg', 'Akaunti yako imefungiwa. Wasiliana na admin.');
      return res.redirect('/auth/login');
    }

    // Sasisha taarifa za mtumiaji kwenye session (coins, role, n.k.)
    req.user = user;
    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      coins: user.coins,
    };

    return next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    req.flash('error_msg', 'Hitilafu ya mfumo. Jaribu tena.');
    return res.redirect('/auth/login');
  }
};

/**
 * ensureGuest
 * - Kuzuia mtumiaji aliyeingia kufungua /login au /register
 */
const ensureGuest = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/dashboard');
  }
  return next();
};

module.exports = { ensureAuthenticated, ensureGuest };
