const crypto = require('crypto');

const PROJECT = 'tele-x-c5d7f';
const DB = 'https://tele-x-c5d7f-default-rtdb.firebaseio.com';
const API_KEY = 'AIzaSyAC_BJ5U8zfG8GA7yX8FmKu7GsmZnpjmfM';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const out = (code, obj) => ({
  statusCode: code,
  headers: { ...CORS, 'content-type': 'application/json' },
  body: JSON.stringify(obj || {})
});

const b64u = (s) => Buffer.from(s).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let cached = null;

async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.t;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + sig
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('auth');
  cached = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.t;
}

async function dbGet(path, tok) {
  const r = await fetch(DB + '/' + path + '.json?access_token=' + tok);
  return r.ok ? r.json() : null;
}
async function dbPut(path, val, tok) {
  await fetch(DB + '/' + path + '.json?access_token=' + tok, { method: 'PUT', body: JSON.stringify(val) });
}
async function dbDel(path, tok) {
  await fetch(DB + '/' + path + '.json?access_token=' + tok, { method: 'DELETE' });
}

/* ───────────── OTP: kod yuborish ───────────── */
async function sendOtp(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || email.split('@')[0]).slice(0, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return out(400, { ok: false, error: 'email' });
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL || !process.env.FIREBASE_SERVICE_ACCOUNT)
    return out(500, { ok: false, error: 'config' });

  const tok = await accessToken();
  const key = sha(email).slice(0, 40);
  const path = 'tx_otp_srv/' + key;
  const rec = (await dbGet(path, tok)) || {};
  const now = Date.now();

  if (rec.blockedUntil && rec.blockedUntil > now) return out(429, { ok: false, error: 'blocked' });
  if (rec.sentAt && now - rec.sentAt < 45000) return out(429, { ok: false, error: 'wait' });

  let hs = rec.hourStart || 0, hc = rec.hourCount || 0;
  if (now - hs > 3600000) { hs = now; hc = 0; }
  if (hc >= 6) return out(429, { ok: false, error: 'limit' });

  const code = String(crypto.randomInt(100000, 1000000));
  const html = '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">' +
    '<h2 style="color:#007aff;margin:0 0 12px">NanoGram</h2>' +
    '<p>Salom, ' + name.replace(/[<>&"]/g, '') + '!</p>' +
    '<p>Tasdiqlash kodingiz:</p>' +
    '<div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f2f2f7;padding:16px;text-align:center;border-radius:12px">' + code + '</div>' +
    '<p style="color:#666;font-size:13px">Kod 30 daqiqa amal qiladi. Uni hech kimga bermang.</p></div>';

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': String(process.env.BREVO_API_KEY).replace(/[^\x21-\x7e]/g, ''), accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'NanoGram', email: String(process.env.SENDER_EMAIL).replace(/[^\x21-\x7e]/g, '') },
      to: [{ email, name }],
      subject: 'NanoGram tasdiqlash kodi: ' + code,
      htmlContent: html
    })
  });
  if (!r.ok) return out(502, { ok: false, error: 'send' });

  await dbPut(path, {
    h: sha(code + ':' + email), exp: now + 30 * 60000, used: false, tries: 0,
    sentAt: now, hourStart: hs, hourCount: hc + 1, blockedUntil: 0
  }, tok);
  return out(200, { ok: true });
}

/* ───────────── OTP: kodni tekshirish ───────────── */
async function verifyOtp(b) {
  const email = String(b.email || '').trim().toLowerCase();
  const code = String(b.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return out(200, { ok: false, reason: 'notfound' });

  const tok = await accessToken();
  const path = 'tx_otp_srv/' + sha(email).slice(0, 40);
  const rec = await dbGet(path, tok);
  const now = Date.now();
  if (!rec || !rec.h) return out(200, { ok: false, reason: 'notfound' });
  if (rec.blockedUntil && rec.blockedUntil > now)
    return out(200, { ok: false, reason: 'blocked', minutes: Math.ceil((rec.blockedUntil - now) / 60000) });
  if (rec.used) return out(200, { ok: false, reason: 'used' });
  if (now > rec.exp) return out(200, { ok: false, reason: 'expired' });

  const a = Buffer.from(sha(code + ':' + email)), c = Buffer.from(rec.h);
  if (a.length === c.length && crypto.timingSafeEqual(a, c)) {
    rec.used = true;
    await dbPut(path, rec, tok);
    return out(200, { ok: true });
  }
  rec.tries = (rec.tries || 0) + 1;
  const left = Math.max(0, 5 - rec.tries);
  if (left === 0) rec.blockedUntil = now + 30 * 60000;
  await dbPut(path, rec, tok);
  return out(200, { ok: false, reason: 'wrong', left });
}

/* ───────────── Push bildirishnoma ───────────── */
async function sendPush(b) {
  const { idToken, to, chatKey, msgId, kind, name } = b;
  if (!idToken || !to || !chatKey || !msgId) return out(400, { ok: false, error: 'bad' });

  const v = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const vj = await v.json();
  const uid = vj.users && vj.users[0] && vj.users[0].localId;
  if (!uid) return out(401, { ok: false });
  if (!chatKey.includes(uid) || !chatKey.includes(to)) return out(403, { ok: false });

  const tok = await accessToken();
  const m = await dbGet('tx_msgs/' + encodeURIComponent(chatKey) + '/' + encodeURIComponent(msgId), tok);
  if (!m || m.from !== uid) return out(403, { ok: false });

  const tokens = (await dbGet('tx_fcm/' + encodeURIComponent(to), tok)) || {};
  const body = ({ image: '🖼️ Rasm', video: '🎬 Video', voice: '🎙️ Ovozli xabar',
                  audio: '🎵 Musiqa', file: '📎 Fayl' })[kind] || 'Yangi xabar';

  await Promise.all(Object.entries(tokens).map(async ([k, t]) => {
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ message: {
        token: t.t,
        data: { type: 'msg', chatKey, from: uid,
                name: String(name || 'NanoGram').slice(0, 40),
                body, msgId, ts: String(Date.now()) },
        android: { priority: 'HIGH', ttl: '3600s' }
      } })
    });
    if (r.status === 404 || r.status === 400) await dbDel('tx_fcm/' + encodeURIComponent(to) + '/' + k, tok);
  }));
  return out(200, { ok: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return out(405, { ok: false });
  try {
    const b = JSON.parse(event.body || '{}');
    const p = String(event.path || '');
    if (p.endsWith('/send-otp')) return await sendOtp(b);
    if (p.endsWith('/verify-otp')) return await verifyOtp(b);
    if (p.endsWith('/send-push')) return await sendPush(b);
    return out(404, { ok: false });
  } catch (e) {
    return out(500, { ok: false, error: 'server' });
  }
};
