/**
 * Yallow Mobility - WhatsApp Authentication & Verification Server
 * Supports:
 *  1. Baileys WhatsApp Engine (Direct, 100% Free, No Meta Dev Restrictions)
 *  2. Visual QR Code Web Interface (/qr) for linking WhatsApp
 *  3. Fallback Meta Cloud API Webhook (/webhook)
 *  4. Instant Firestore & In-Memory Session Synchronization
 */

// Load .env automatically in Node.js
try {
  process.loadEnvFile?.();
} catch (_) { }

const express = require('express');
const { startBaileys, getStatus, getQrDataUrl } = require('./baileysClient');

const app = express();
app.use(express.json());

// Enable CORS for client polling from Flutter & Web
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1309556175582943';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'yallow_verify_123';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const FIREBASE_API_KEY = 'AIzaSyCTK6XvCOw8vIiJTVkXGIzioE3DG9uD7XE';
const PROJECT_ID = 'yallow-53cb5';

// In-memory verification cache for instantaneous checking by the app
const verifiedCodes = new Map(); // code -> { phoneNumber, verifiedAt }

/**
 * Syncs verified session directly into Firestore
 */
async function syncToFirestore(fullCode, formattedPhone) {
  try {
    const searchUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'whatsapp_auth_sessions' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'code' },
            op: 'EQUAL',
            value: { stringValue: fullCode },
          },
        },
        limit: 1,
      },
    };

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });

    const queryResults = await response.json();
    const doc = queryResults?.[0]?.document;

    if (doc && doc.name) {
      const patchUrl = `https://firestore.googleapis.com/v1/${doc.name}?updateMask.fieldPaths=status&updateMask.fieldPaths=phoneNumber&key=${FIREBASE_API_KEY}`;
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            status: { stringValue: 'verified' },
            phoneNumber: { stringValue: formattedPhone },
          },
        }),
      });
      console.log(`[FIRESTORE UPDATED] Session ${fullCode} marked verified for ${formattedPhone}`);
    }
  } catch (firestoreErr) {
    console.error('[FIRESTORE SYNC NOTE]', firestoreErr);
  }
}

// -------------------------------------------------------------
// 1. Baileys Engine Initialization
// -------------------------------------------------------------
startBaileys({
  onCodeReceived: async ({ rawDigits, fullCode, senderPhone, reply }) => {
    // 1. Mark in memory cache for instantaneous app verification
    const verificationData = {
      phoneNumber: senderPhone,
      verifiedAt: new Date().toISOString(),
    };
    verifiedCodes.set(fullCode, verificationData);
    verifiedCodes.set(rawDigits, verificationData);

    console.log(`[VERIFICATION SUCCESS] Code: ${fullCode} verified for phone: ${senderPhone}`);

    // 2. Automatic friendly reply back to user
    await reply('✅ تم التحقق من رقمك بنجاح! مرحباً بك في تطبيق Yallow 🚖');

    // 3. Update Firestore session
    await syncToFirestore(fullCode, senderPhone);
  },
});

// -------------------------------------------------------------
// 2. Visual QR Code Interface (/qr)
// -------------------------------------------------------------
app.get('/qr', (req, res) => {
  const statusInfo = getStatus();
  const qrImage = getQrDataUrl();

  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ربط واتساب - Yallow Mobility</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body {
      background: linear-gradient(135deg, #090d16 0%, #111827 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      text-align: center;
    }
    .logo-badge {
      display: inline-block;
      background: #facc1522;
      color: #facc15;
      border: 1px solid #facc1555;
      padding: 6px 16px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 8px; color: #fff; }
    p.desc { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.6; }
    .qr-container {
      background: #fff;
      padding: 16px;
      border-radius: 16px;
      display: inline-block;
      margin-bottom: 20px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    }
    .qr-container img { display: block; border-radius: 8px; }
    .steps {
      background: #0f172a;
      border-radius: 12px;
      padding: 16px 20px;
      text-align: right;
      margin-bottom: 20px;
      border: 1px solid #334155;
    }
    .steps ol { padding-right: 20px; margin: 0; color: #cbd5e1; font-size: 13.5px; line-height: 1.8; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
    }
    .status-badge.connected {
      background: #22c55e22;
      color: #4ade80;
      border: 1px solid #22c55e44;
    }
    .status-badge.waiting {
      background: #38bdf822;
      color: #38bdf8;
      border: 1px solid #38bdf844;
    }
    .status-badge.connecting {
      background: #facc1522;
      color: #facc15;
      border: 1px solid #facc1544;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .btn {
      display: inline-block;
      margin-top: 16px;
      padding: 10px 24px;
      background: #facc15;
      color: #0f172a;
      font-weight: 700;
      text-decoration: none;
      border-radius: 10px;
      cursor: pointer;
      border: none;
      font-size: 14px;
    }
  </style>
  <script>
    // Auto refresh status every 3 seconds to update immediately upon scan
    setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const currentIsConnected = ${statusInfo.status === 'connected'};
        if (data.status === 'connected' && !currentIsConnected) {
          window.location.reload();
        } else if (data.status === 'scan_qr' && currentIsConnected) {
          window.location.reload();
        }
      } catch(_) {}
    }, 3000);
  </script>
</head>
<body>
  <div class="card">
    <div class="logo-badge">🚖 Yallow Mobility</div>
    <h1>ربط واتساب السيرفر (مجاني 100%)</h1>
    <p class="desc">اربط رقم هاتفك بالسيرفر كجهاز مرتبط (Linked Device) لتمكين جميع المستخدمين من تسجيل الدخول فوراً.</p>

    ${
      statusInfo.status === 'connected'
        ? `
      <div style="padding: 24px 0;">
        <div style="font-size: 54px; margin-bottom: 12px;">🎉</div>
        <div class="status-badge connected">
          <span class="dot"></span>
          <span>متصل بواتساب بنجاح!</span>
        </div>
        <p style="font-size: 16px; font-weight: bold; color: #facc15; margin-top: 14px; direction: ltr;">
          ${statusInfo.phone || ''}
        </p>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 10px;">
          السيرفر يستقبل الآن أكواد التحقق من أي هاتف في العالم ويرد تلقائياً بدون أي رسوم.
        </p>
      </div>
      `
        : qrImage
        ? `
      <div class="qr-container">
        <img src="${qrImage}" width="260" height="260" alt="WhatsApp QR Code" />
      </div>

      <div class="status-badge waiting">
        <span class="dot"></span>
        <span>بانتظار المسح من تطبيق واتساب...</span>
      </div>

      <div class="steps" style="margin-top: 20px;">
        <ol>
          <li>افتح تطبيق <strong>واتساب</strong> على هاتفك (حسابك الحالي عادي).</li>
          <li>اضغط على <strong>⋮ (القائمة)</strong> أو <strong>الإعدادات</strong>.</li>
          <li>اختر <strong>الأجهزة المرتبطة (Linked Devices)</strong>.</li>
          <li>اضغط <strong>ربط جهاز (Link a device)</strong> ووجّه الكاميرا نحو الرمز أعلاه.</li>
        </ol>
      </div>
      `
        : `
      <div style="padding: 30px 0;">
        <div class="status-badge connecting">
          <span class="dot"></span>
          <span>جاري تهيئة الاتصال بواتساب...</span>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 12px;">يرجى الانتظار بضع ثوانٍ ليظهر رمز الاستجابة السريعة (QR Code)...</p>
        <button class="btn" onclick="window.location.reload()">تحديث الصفحة</button>
      </div>
      `
    }
  </div>
</body>
</html>`);
});

// -------------------------------------------------------------
// 3. API Status Endpoints (for App & Monitoring)
// -------------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

app.get('/api/business-phone', (req, res) => {
  const status = getStatus();
  res.json({
    phone: status.phone ? status.phone.replace(/[^0-9]/g, '') : null,
    connected: status.status === 'connected',
  });
});

// -------------------------------------------------------------
// 4. Session Verification Status Check (Polled by Flutter App)
// -------------------------------------------------------------
app.get('/session-status/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  if (verifiedCodes.has(code)) {
    return res.json({
      status: 'verified',
      ...verifiedCodes.get(code),
    });
  }
  return res.json({ status: 'pending' });
});

// -------------------------------------------------------------
// 5. Meta Webhook Fallback
// -------------------------------------------------------------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (message && message.type === 'text') {
        const fromNumber = message.from;
        const formattedFrom = '+' + fromNumber.replace(/^\+/, '');
        const messageText = message.text?.body || '';

        const match = messageText.match(/(?:YAL-)?(\d{6})\b/i);
        if (match) {
          const rawDigits = match[1];
          const fullCode = `YAL-${rawDigits}`;
          verifiedCodes.set(fullCode, {
            phoneNumber: formattedFrom,
            verifiedAt: new Date().toISOString(),
          });
          verifiedCodes.set(rawDigits, {
            phoneNumber: formattedFrom,
            verifiedAt: new Date().toISOString(),
          });
          await syncToFirestore(fullCode, formattedFrom);
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
  } catch (err) {
    return res.status(200).send('EVENT_RECEIVED');
  }
});

// -------------------------------------------------------------
// 6. Privacy Policy & Terms of Service
// -------------------------------------------------------------
app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>سياسة الخصوصية - تطبيق Yallow Mobility</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 32px 20px; line-height: 1.8; max-width: 800px; margin: auto; }
    h1 { color: #facc15; font-size: 26px; border-bottom: 2px solid #334155; padding-bottom: 12px; }
    h2 { color: #38bdf8; font-size: 20px; margin-top: 24px; }
    p, li { color: #cbd5e1; font-size: 15px; }
    .badge { display: inline-block; background: #22c55e22; color: #22c55e; border: 1px solid #22c55e44; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: bold; }
  </style>
</head>
<body>
  <span class="badge">وثيقة رسمية معتمدة</span>
  <h1>سياسة الخصوصية لتطبيق Yallow Mobility</h1>
  <p>آخر تحديث: 2026</p>
  <p>نحن في <strong>تطبيق Yallow Mobility</strong> نلتزم بأقصى معايير حماية البيانات الشخصية والخصوصية للمستخدمين والكباتن والركاب وفقاً للقوانين المتبعة.</p>
  <h2>1. البيانات التي نجمعها</h2>
  <ul>
    <li><strong>رقم الهاتف:</strong> يُستخدم فقط للتحقق من هوية المستخدم وإنشاء حسابه الآمن عبر تطبيق واتساب أو تسجيل الدخول.</li>
    <li><strong>بيانات الموقع الجغرافي:</strong> يُستخدم موقع الراكب والسائق لتقديم خدمات التوصيل وتتبع مسار الرحلة على الخريطة أثناء تشغيل الخدمة.</li>
    <li><strong>بيانات الرحلات:</strong> تشمل سجل الرحلات المكتملة لغرض الفواتير وتوفير الدعم الفني.</li>
  </ul>
</body>
</html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>شروط الخدمة - Yallow</title></head>
<body style="font-family: sans-serif; padding: 30px; line-height: 1.6; background: #0f172a; color: #f8fafc;">
  <h1>شروط الخدمة والاستخدام - Yallow Mobility</h1>
  <p>باستخدامك لتطبيق Yallow فإنك توافق على الالتزام بشروط الاستخدام المعمول بها لتسهيل خدمات التنقل بأمان.</p>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Yallow WhatsApp Server running on port ${PORT}`);
  console.log(`📲 Open http://localhost:${PORT}/qr to link WhatsApp`);
  console.log(`====================================================`);
});
