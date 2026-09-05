import { createHubServer } from './app.js';
import { DEFAULT_HUB_PORT, MAINNET_LISTING_ID, buildListings, hubBaseUrl } from './listings.js';

// ponytail: the hub is a zero-dependency stand-in, so it reads its three env values directly instead of
// pulling @subbuddy/config; the consumers (api, seller) validate every listing before use anyway.
const env = {
  SELLER_BASE_URL: process.env['SELLER_BASE_URL'] ?? 'http://localhost:4020',
  SELLER_PAYTO_ADDRESS: process.env['SELLER_PAYTO_ADDRESS'] ?? '',
  HUB_URL: process.env['HUB_URL'],
  HUB_PORT: process.env['HUB_PORT'],
};
if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(env.SELLER_PAYTO_ADDRESS)) {
  console.error(
    'hub: SELLER_PAYTO_ADDRESS must be a classic XRPL address (listings carry it as payTo)',
  );
  process.exit(1);
}

const listings = buildListings(env);
const port = Number(env.HUB_PORT || DEFAULT_HUB_PORT);
createHubServer(listings).listen(port, () => {
  console.log(
    `hub listening on http://localhost:${port} (public base ${hubBaseUrl(env)}); ${listings.length} listings, ` +
      `${listings.length - 1} Testnet at ${env.SELLER_BASE_URL}, 1 Mainnet (${MAINNET_LISTING_ID}) that consumers must skip`,
  );
});
