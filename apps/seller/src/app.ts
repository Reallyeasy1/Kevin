import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'seller' });
  });
  return app;
}
