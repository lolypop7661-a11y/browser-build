const { randomBytes } = require('node:crypto');

// Cloudflare Turnstile only runs on an https page whose hostname is listed on
// the widget, and Browsery's shell is a file:// page. The human check therefore
// opens in its own isolated window and session. Inside that session, requests
// for the configured hostname are answered locally by this module (nothing is
// hosted there); every other request, including Turnstile itself, goes to the
// real network. The solved token is posted back to this local handler, so it
// never passes through the Browsery renderer.
const PARTITION = 'browsery-captcha';
const PAGE_PATH = '/browsery-captcha';
const TOKEN_PATH = '/browsery-captcha/token';
const PROMPT_TIMEOUT = 3 * 60 * 1000;

function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : '';
}

function normalizeSiteKey(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9_-]{10,128}$/.test(key) && !/placeholder|YOUR_/i.test(key) ? key : '';
}

function pageHtml({ siteKey, state, nonce }) {
  const data = JSON.stringify({ siteKey, state, tokenPath: TOKEN_PATH }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Human check · Browsery</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080808;color:#ededed;font:14px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}main{width:min(340px,calc(100vw - 32px));text-align:center}.mark{width:34px;height:34px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 34% 29%,#fafafa,#b6b6b6 42%,#777 70%,#303030 100%)}h1{margin:0 0 6px;font-size:20px;font-weight:600;letter-spacing:-.02em}p{margin:0 0 24px;color:#9a9a9a;font-size:13px}#widget{display:flex;justify-content:center;min-height:65px}#status{min-height:20px;margin-top:16px;color:#b5b5b5;font-size:12px}button{margin-top:10px;padding:8px 14px;border:1px solid #444;border-radius:8px;background:#1a1a1a;color:#e5e5e5;font:inherit;font-size:12px;cursor:pointer}button:hover{background:#262626}button[hidden]{display:none}</style></head>
<body><main><div class="mark" aria-hidden="true"></div><h1>Quick human check</h1><p>Confirm you’re a person to continue with your Browsery account.</p><div id="widget"></div><div id="status" role="status" aria-live="polite"></div><button id="retry" type="button" hidden>Try again</button></main>
<script nonce="${nonce}">
(()=>{const config=${data};const status=document.getElementById('status'),retry=document.getElementById('retry');let widgetId=null,sent=false;
const failed=text=>{status.textContent=text;retry.hidden=false};
const deliver=async token=>{if(sent)return;sent=true;status.textContent='Verified. Continuing…';try{const response=await fetch(config.tokenPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:config.state,token})});if(!response.ok)throw new Error('rejected')}catch{sent=false;failed('This check expired. Close this window and try again.')}};
retry.addEventListener('click',()=>{retry.hidden=true;status.textContent='';sent=false;if(widgetId!==null)window.turnstile?.reset(widgetId);else location.reload()});
window.onBrowseryTurnstileLoad=()=>{widgetId=window.turnstile.render('#widget',{sitekey:config.siteKey,theme:'dark',callback:deliver,'error-callback':()=>{failed('The check could not finish. Try again.');return true},'expired-callback':()=>{status.textContent='The check expired. Complete it again.';window.turnstile.reset(widgetId)}})};
setTimeout(()=>{if(widgetId===null)failed('The check could not load. Check your connection, then try again.')},12000);})();
</script>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onBrowseryTurnstileLoad&render=explicit" async defer></script>
</body></html>`;
}

function createCaptchaPrompt({ session, BrowserWindow, siteKey, host, getParent }) {
  const key = normalizeSiteKey(siteKey);
  const origin = normalizeHost(host);
  let active = null;
  let captchaSession = null;

  function settle(token) {
    const current = active;
    if (!current) return;
    active = null;
    clearTimeout(current.timer);
    current.resolve(token);
    if (!current.window.isDestroyed()) current.window.close();
  }

  function prepareSession() {
    if (captchaSession) return captchaSession;
    captchaSession = session.fromPartition(PARTITION);
    captchaSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    captchaSession.setPermissionCheckHandler(() => false);
    captchaSession.on('will-download', event => event.preventDefault());
    captchaSession.protocol.handle('https', async request => {
      let url;
      try { url = new URL(request.url); } catch { return new Response(null, { status: 400 }); }
      if (url.hostname !== origin) return captchaSession.fetch(request, { bypassCustomProtocolHandlers: true });
      if (url.pathname === PAGE_PATH && request.method === 'GET') {
        if (!active || url.searchParams.get('state') !== active.state) return new Response('This human check has expired.', { status: 410 });
        const nonce = randomBytes(16).toString('base64');
        return new Response(pageHtml({ siteKey: key, state: active.state, nonce }), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'`,
          },
        });
      }
      if (url.pathname === TOKEN_PATH && request.method === 'POST') {
        let body = null;
        try {
          const text = await request.text();
          if (text.length <= 8192) body = JSON.parse(text);
        } catch {}
        if (!active || body?.state !== active.state || typeof body?.token !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(body.token)) {
          return new Response(null, { status: 400 });
        }
        const token = body.token;
        // Answer the page before closing its window.
        setImmediate(() => settle(token));
        return new Response(null, { status: 204 });
      }
      return new Response('Not found', { status: 404 });
    });
    return captchaSession;
  }

  async function requestToken() {
    if (!key || !origin) return { status: 'not-configured' };
    if (active) {
      if (!active.window.isDestroyed()) active.window.focus();
      const token = await active.promise;
      return token ? { status: 'ready', token } : { status: 'cancelled' };
    }
    prepareSession();
    const parent = getParent?.();
    const hasParent = Boolean(parent && !parent.isDestroyed());
    const window = new BrowserWindow({
      parent: hasParent ? parent : undefined,
      modal: hasParent,
      width: 420,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#080808',
      title: 'Browsery · Human check',
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false },
    });
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const state = randomBytes(18).toString('hex');
    active = { state, window, resolve, promise, timer: setTimeout(() => settle(null), PROMPT_TIMEOUT) };
    window.removeMenu?.();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { if (active?.window === window) settle(null); });
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
    window.loadURL(`https://${origin}${PAGE_PATH}?state=${state}`).catch(() => settle(null));
    const token = await promise;
    return token ? { status: 'ready', token } : { status: 'cancelled' };
  }

  return { configured: Boolean(key && origin), requestToken };
}

module.exports = { createCaptchaPrompt };
