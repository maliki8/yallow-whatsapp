const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

let sock = null;
let currentQrRaw = null;
let currentQrDataUrl = null;
let connectionStatus = 'idle'; // 'idle' | 'connecting' | 'scan_qr' | 'connected' | 'disconnected'
let connectedPhone = null;
let reconnectTimer = null;

const AUTH_FOLDER = path.join(__dirname, 'baileys_auth');

async function startBaileys({ onCodeReceived } = {}) {
  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    }

    connectionStatus = 'connecting';
    console.log('[Baileys] Initializing WhatsApp connection...');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Yallow Mobility Server', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQrRaw = qr;
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
          });
          connectionStatus = 'scan_qr';
          console.log('[Baileys] New QR Code generated! Open /qr in your browser to scan it.');
        } catch (err) {
          console.error('[Baileys] Error generating QR Data URL:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        connectionStatus = 'disconnected';
        currentQrRaw = null;
        currentQrDataUrl = null;
        connectedPhone = null;

        console.log(`[Baileys] Connection closed. Reason code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[Baileys] Logged out. Clearing saved credentials...');
          try {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
          } catch (_) {}
        }

        if (shouldReconnect) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            startBaileys({ onCodeReceived });
          }, 3000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQrRaw = null;
        currentQrDataUrl = null;
        const userJid = sock.user?.id || '';
        connectedPhone = userJid.split(':')[0] || userJid.split('@')[0];
        console.log(`[Baileys] Connected successfully! Logged in as: +${connectedPhone}`);
      }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        // Skip group messages
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') continue;

        const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
        const formattedSender = `+${senderPhone}`;

        // Extract text message content
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        const trimmed = text.trim();
        if (!trimmed) continue;

        console.log(`[Baileys Incoming] From: ${formattedSender} | Text: "${trimmed}"`);

        // Match 6-digit verification code: YAL-123456 or 123456
        const match = trimmed.match(/(?:YAL-)?(\d{6})\b/i);
        if (match) {
          const rawDigits = match[1];
          const fullCode = `YAL-${rawDigits}`;
          console.log(`[Baileys Code Detected] Code: ${rawDigits} (${fullCode}) from ${formattedSender}`);

          if (onCodeReceived) {
            try {
              await onCodeReceived({
                rawDigits,
                fullCode,
                senderPhone: formattedSender,
                reply: async (replyText) => {
                  try {
                    await sock.sendMessage(remoteJid, { text: replyText });
                    console.log(`[Baileys Reply Sent] to ${formattedSender}`);
                  } catch (replyErr) {
                    console.error('[Baileys Reply Error]:', replyErr);
                  }
                },
              });
            } catch (handlerErr) {
              console.error('[Baileys Handler Error]:', handlerErr);
            }
          }
        }
      }
    });

    return sock;
  } catch (err) {
    console.error('[Baileys Init Error]:', err);
    connectionStatus = 'disconnected';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      startBaileys({ onCodeReceived });
    }, 5000);
  }
}

function getStatus() {
  return {
    status: connectionStatus,
    phone: connectedPhone ? `+${connectedPhone}` : null,
    hasQr: Boolean(currentQrDataUrl),
  };
}

function getQrDataUrl() {
  return currentQrDataUrl;
}

module.exports = {
  startBaileys,
  getStatus,
  getQrDataUrl,
};
