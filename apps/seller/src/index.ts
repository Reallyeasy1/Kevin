import { createApp } from './app.js';

const port = Number(process.env.SELLER_PORT ?? 4020);
createApp().listen(port, () => {
  console.log(`seller listening on http://localhost:${port}`);
});
