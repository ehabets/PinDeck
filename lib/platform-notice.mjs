import http from 'node:http';

export function createPlatformNoticeServer(platform) {
  const windows = platform === 'win32';
  const heading = windows ? 'Windows support is on the roadmap' : 'PinDeck runs on macOS and Linux';
  const explanation = windows
    ? 'PinDeck runs on macOS and Linux. Windows support is planned for a future version; there is no release date yet.'
    : 'This version of PinDeck runs on macOS and Linux. This operating system is not supported.';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PinDeck · system not supported</title><style>
  :root{font-family:system-ui,sans-serif;color:#243348;background:#f4f6f8;color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,620px);padding:40px;background:white;border:1px solid #dde3ea;border-radius:18px;box-shadow:0 12px 40px #20334d0a}.brand{font-weight:700;color:#c36516;margin:0 0 32px}h1{font-size:clamp(26px,5vw,36px);line-height:1.2;margin:0 0 20px}p{line-height:1.65}a{color:#945012}footer{margin-top:28px;font-size:14px;color:#596577}
  </style></head><body><main><p class="brand">PinDeck</p><h1>${heading}</h1><p>${explanation}</p><p>Your deck has not been opened or changed, and no AI backend has been started.</p><p>You can run PinDeck on a Mac or a Linux machine (and use it from this browser through an SSH tunnel), or follow updates on <a href="https://github.com/ehabets/PinDeck">GitHub</a>.</p><footer>Close this tab and press Ctrl+C in the terminal to stop this notice.</footer></main></body></html>`;
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
}

// Keep startup here until the notice is closed: no deck/state initialization runs on unsupported OSes.
export async function showPlatformNotice(port, platform = process.platform) {
  const server = createPlatformNoticeServer(platform);
  await new Promise((resolve, reject) => {
    const stop = () => server.close();
    server.once('error', reject);
    server.once('close', () => {
      process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve();
    });
    server.listen(port, '127.0.0.1', () => {
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      console.log(`PinDeck runs on macOS and Linux only. Open http://127.0.0.1:${server.address().port}/ for details. Press Ctrl+C to stop.`);
    });
  });
}
