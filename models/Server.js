const mongoose = require('mongoose');

const serverSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    pterodactylServerId: {
      type: Number,
      required: true,
      unique: true,
    },
    pterodactylIdentifier: {
      type: String,
      required: true,
    },
    ram: {
      type: Number, // MB
      required: true,
    },
    disk: {
      type: Number, // MB
      default: 1024,
    },
    cpu: {
      type: Number, // %
      default: 100,
    },
    coinsSpent: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted', 'installing'],
      default: 'installing',
    },
    node: {
      type: Number,
      default: null,
    },
    egg: {
      type: Number,
      default: null,
    },
    dockerImage: {
      type: String,
      default: null,
    },
    botType: {
      type: String,
      default: 'whatsapp-bot',
    },
    notes: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

serverSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Server', serverSchema);
