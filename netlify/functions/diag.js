const crypto = require('crypto');
const b64u = (s) => Buffer.from(s).toString('base64url');

exports.handler = async () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  const r = {
    env: { FIREBASE_SERVICE_ACCOUNT: !!raw, BREVO_API_KEY: !!process.env.BREVO_API_KEY, SENDER_EMAIL: !!process.env.SENDER_EMAIL },
    firebaseValue: { length: raw.length, firstChar: raw.charAt(0), lastChar: raw.charAt(raw.length - 1) }
  };
  let sa = null;
  try {
    sa = JSON.parse(raw);
    r.json = 'ok';
    r.hasPrivateKey = typeof sa.private_key === 'string' && sa.private_key.indexOf('-----BEGIN') === 0;
    r.type = sa.type; r.project = sa.project_id; r.clientEmail = sa.client_email;
  } catch (e) { r.json = 'XATO (JSON emas)'; }

  if (sa && r.hasPrivateKey) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = b64u(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
        aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
      }));
      const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
      const t = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + sig
      });
      const tj = await t.json();
      r.googleToken = tj.access_token ? 'ok' : ('XATO: ' + (tj.error || '') + ' ' + (tj.error_description || '')).slice(0, 120);
      if (tj.access_token) {
        const d = await fetch('https://tele-x-c5d7f-default-rtdb.firebaseio.com/tx_users.json?shallow=true&limitToFirst=1&access_token=' + tj.access_token);
        r.firebaseDatabase = d.ok ? 'ok' : ('XATO ' + d.status);
      }
    } catch (e) { r.googleToken = 'XATO: imzolashda (' + String(e.code || e.name).slice(0, 40) + ')'; }
  }

  if (process.env.BREVO_API_KEY) {
    try {
      const b = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' } });
      r.brevoKey = b.ok ? 'ok' : ('XATO ' + b.status);
      const s = await fetch('https://api.brevo.com/v3/senders', { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' } });
      if (s.ok) {
        const sj = await s.json();
        const want = String(process.env.SENDER_EMAIL || '').toLowerCase();
        const f = (sj.senders || []).find((x) => String(x.email).toLowerCase() === want);
        r.brevoSender = f ? (f.active ? 'ok (tasdiqlangan)' : 'topildi, lekin tasdiqlanmagan') : 'Brevo ro\'yxatida YO\'Q';
      }
    } catch (e) { r.brevoKey = 'XATO: ulanmadi'; }
  }
  return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(r, null, 2) };
};
