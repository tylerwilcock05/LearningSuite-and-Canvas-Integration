const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3000;

function fetchUrlWithRedirects(targetUrl, res, redirectCount = 0) {
  if (redirectCount > 10) {
    res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('Proxy Error: Too many redirects');
  }

  try {
    const parsed = new url.URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/calendar, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      rejectUnauthorized: false
    };

    console.log(`[Proxy] Fetching (${redirectCount}): ${targetUrl}`);

    const req = client.request(options, (targetRes) => {
      console.log(`[Proxy] Response status: ${targetRes.statusCode} for ${targetUrl}`);

      // Handle 3xx Redirects
      if (targetRes.statusCode >= 300 && targetRes.statusCode < 400 && targetRes.headers.location) {
        let redirectUrl = targetRes.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new url.URL(redirectUrl, targetUrl).href;
        }
        return fetchUrlWithRedirects(redirectUrl, res, redirectCount + 1);
      }

      res.writeHead(targetRes.statusCode || 200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      targetRes.pipe(res);
    });

    req.on('error', (err) => {
      console.error(`[Proxy Error] ${err.message} for ${targetUrl}`);
      res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Proxy Error: ' + err.message);
    });

    req.end();
  } catch (err) {
    console.error(`[Proxy Exception] ${err.message}`);
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Invalid URL: ' + err.message);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.pathname === '/fetch' && parsedUrl.query.url) {
    fetchUrlWithRedirects(parsedUrl.query.url, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Use /fetch?url=YOUR_ICAL_URL');
  }
});

server.listen(PORT, () => console.log(`✅ Bulletproof Proxy running at http://localhost:${PORT}`));
