const clean = (s) => String(s || '').replace(/[^\x21-\x7e]/g, '');

exports.handler = async (event) => {
  const key = clean(process.env.BREVO_API_KEY);
  const sender = clean(process.env.SENDER_EMAIL);
  const h = { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' };
  const r = { keyLength: key.length, sender };
  const show = async (resp) => {
    let t = ''; try { t = await resp.text(); } catch (e) {}
    return { status: resp.status, body: t.slice(0, 300) };
  };
  try {
    r.account = await show(await fetch('https://api.brevo.com/v3/account', { headers: h }));
    r.senders = await show(await fetch('https://api.brevo.com/v3/senders', { headers: h }));
    if (event.queryStringParameters && event.queryStringParameters.send === '1') {
      r.testSend = await show(await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          sender: { name: 'NanoGram', email: sender },
          to: [{ email: sender }],
          subject: 'NanoGram test',
          htmlContent: '<p>Test xati: Brevo ishlayapti.</p>'
        })
      }));
    }
  } catch (e) { r.error = String(e.name) + ': ' + String(e.message).slice(0, 80); }
  return { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(r, null, 2) };
};
