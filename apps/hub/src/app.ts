/**
 * Dummy XRPL AI Hub over node:http (no dependencies). Routes:
 *   GET /health            -> { status, service }
 *   GET /api/listings      -> JSON array of HubListing (what XrplAiHubRegistry fetches when HUB_URL is set)
 *   GET /listing/<id>      -> small HTML page so hubUrl links resolve locally
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HubListing } from './listings.js';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

export function listingPage(l: HubListing): string {
  const rows = (
    [
      ['Service id', l.hubServiceId],
      ['Endpoint', l.endpoint],
      ['Pay to', l.payTo],
      ['Network', l.network],
      ['Price', `${l.price} ${l.asset}`],
      ['Capabilities', l.capabilities.join(', ')],
    ] as const
  )
    .map(([k, v]) => `<tr><th align="left">${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(l.displayName)} · XRPL AI Hub (demo)</title>
<style>body{font:14px system-ui,sans-serif;margin:2rem auto;max-width:40rem;padding:0 1rem}th{padding-right:1rem}</style></head>
<body><p><a href="/">XRPL AI Hub (demo stand-in)</a></p><h1>${esc(l.displayName)}</h1>
<p>x402 service listing. Testnet demo data, not a real marketplace entry.</p><table>${rows}</table></body></html>`;
}

export function handler(listings: HubListing[]) {
  const byId = new Map(listings.map((l) => [l.hubServiceId, l]));
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = new URL(req.url ?? '/', 'http://hub').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { error: 'method not allowed' });
    if (path === '/health') return json(res, 200, { status: 'ok', service: 'hub' });
    if (path === '/api/listings') return json(res, 200, listings);
    if (path === '/')
      return send(
        res,
        200,
        'text/html; charset=utf-8',
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>XRPL AI Hub (demo)</title></head><body><h1>XRPL AI Hub (demo stand-in)</h1><ul>${listings
          .map(
            (l) =>
              `<li><a href="/listing/${encodeURIComponent(l.hubServiceId)}">${esc(l.displayName)}</a></li>`,
          )
          .join('')}</ul><p><a href="/api/listings">/api/listings</a></p></body></html>`,
      );
    const m = /^\/listing\/([^/]+)$/.exec(path);
    const l = m && byId.get(decodeURIComponent(m[1]!));
    if (l) return send(res, 200, 'text/html; charset=utf-8', listingPage(l));
    json(res, 404, { error: 'not found' });
  };
}

export const createHubServer = (listings: HubListing[]) => createServer(handler(listings));
