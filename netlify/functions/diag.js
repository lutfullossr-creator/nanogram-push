exports.handler = async () => {
  const k = String(process.env.BREVO_API_KEY || '');
  const r = {
    brevoKey: {
      length: k.length,
      first6: k.slice(0, 6),
      last2: k.slice(-2),
      hasSpaceOrNewline: /\s/.test(k),
      hasNonAscii: /[^\x20-\x7e]/.test(k),
      hasQuote: /["']/.test(k)
    },
    sender: String(process.env.SENDER_EMAIL || '')
  };
  try {
    const b = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': k.trim(), accept: 'application/json' }
    });
    r.brevoStatus = b.status;
  } catch (e) {
    r.brevoError = String(e.name) + ': ' + String(e.message).slice(0, 80) + (e.cause ? ' | ' + String(e.cause.code || e.cause.message).slice(0, 60) : '');
  }
  return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(r, null, 2) };
};
