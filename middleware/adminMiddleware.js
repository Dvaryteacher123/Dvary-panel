// ============================================
//  ADMIN MIDDLEWARE
//  Inaruhusu admin PEKEE kuingia kwenye /admin
// ============================================

const User = require('../models/User');

/**
 * ensureAdmin
 * - Lazima mtumiaji awe logged in
 * - Lazima role yake iwe 'admin'
 * - Kama sio → 403 au redirect /dashboard
 */
const ensureAdmin = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user || !req.session.user.id) {
      req.flash('error_msg', 'Tafadhali ingia kama admin.');
      return res.redirect('/auth/login');
    }

    // Kama tayari tuna req.user kutoka authMiddleware, tumia hiyo
    let user = req.user;
    if (!user) {
      user = await User.findById(req.session.user.id);
    }

    if (!user) {
      req.session.destroy(() => {});
      req.flash('error_msg', 'Akaunti haipatikani.');
      return res.redirect('/auth/login');
    }

    if (user.role !== 'admin') {
      req.flash('error_msg', 'Huna ruhusa ya kuingia ukurasa huu.');
      return res.status(403).render('403', { title: 'Hairuhusiwi' });
    }

    req.adminUser = user;
    return next();
  } catch (err) {
    console.error('adminMiddleware error:', err);
    req.flash('error_msg', 'Hitilafu ya mfumo.');
    return res.redirect('/dashboard');
  }
};

module.exports = { ensureAdmin };
