const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ============================================
//  GET /auth/register
// ============================================
exports.getRegister = (req, res) => {
  res.render('auth/register', {
    title: 'Jisajili',
    layout: 'partials/layout',
  });
};

// ============================================
//  POST /auth/register
// ============================================
exports.postRegister = async (req, res) => {
  const { username, email, password, confirmPassword } = req.body;

  // --- Validations za msingi ---
  if (!username || !email || !password || !confirmPassword) {
    req.flash('error_msg', 'Tafadhali jaza sehemu zote.');
    return res.redirect('/auth/register');
  }

  if (password !== confirmPassword) {
    req.flash('error_msg', 'Neno la siri na uthibitisho hazifanani.');
    return res.redirect('/auth/register');
  }

  if (password.length < 6) {
    req.flash('error_msg', 'Neno la siri liwe na herufi 6 au zaidi.');
    return res.redirect('/auth/register');
  }

  try {
    // --- Angalia kama username/email zipo ---
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    });

    if (existingUser) {
      req.flash('error_msg', 'Jina la mtumiaji au barua pepe tayari zipo.');
      return res.redirect('/auth/register');
    }

    // --- Admin wa kwanza kiotomatiki ---
    const isAdminEmail =
      process.env.ADMIN_EMAIL &&
      email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

    const welcomeCoins = parseInt(process.env.WELCOME_COINS || '0', 10);

    const newUser = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: isAdminEmail ? 'admin' : 'user',
      coins: welcomeCoins,
    });

    // --- Rekodi ya coins ya kukaribisha ---
    if (welcomeCoins > 0) {
      await Transaction.create({
        user: newUser._id,
        type: 'credit',
        amount: welcomeCoins,
        balanceAfter: welcomeCoins,
        reason: 'Bonus ya kukaribisha mtumiaji mpya',
      });
    }

    req.flash('success_msg', 'Umejisajili kwa mafanikio. Tafadhali ingia.');
    return res.redirect('/auth/login');
  } catch (err) {
    console.error('Register error:', err);
    req.flash('error_msg', 'Hitilafu wakati wa kujisajili. Jaribu tena.');
    return res.redirect('/auth/register');
  }
};

// ============================================
//  GET /auth/login
// ============================================
exports.getLogin = (req, res) => {
  res.render('auth/login', {
    title: 'Ingia',
    layout: 'partials/layout',
  });
};

// ============================================
//  POST /auth/login
// ============================================
exports.postLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash('error_msg', 'Tafadhali jaza barua pepe na neno la siri.');
    return res.redirect('/auth/login');
  }

  try {
    // Tunahitaji password kwa sababu schema ina select: false
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+password'
    );

    if (!user) {
      req.flash('error_msg', 'Barua pepe au neno la siri si sahihi.');
      return res.redirect('/auth/login');
    }

    if (user.isBanned) {
      req.flash('error_msg', 'Akaunti yako imefungiwa.');
      return res.redirect('/auth/login');
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      req.flash('error_msg', 'Barua pepe au neno la siri si sahihi.');
      return res.redirect('/auth/login');
    }

    // Sasisha lastLogin
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    // Weka session
    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      coins: user.coins,
    };

    req.flash('success_msg', `Karibu tena, ${user.username}!`);

    // Rudi kwenye page aliyokuwa anataka (kama ipo)
    const redirectTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    return res.redirect(redirectTo);
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error_msg', 'Hitilafu wakati wa kuingia. Jaribu tena.');
    return res.redirect('/auth/login');
  }
};

// ============================================
//  GET /auth/logout
// ============================================
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.clearCookie('connect.sid');
    return res.redirect('/auth/login');
  });
};
