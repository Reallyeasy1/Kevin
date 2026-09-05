import cors from '@fastify/cors';
import Fastify from 'fastify';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            // SEC-001: never log secrets or payment signatures.
            redact: ['req.headers.authorization', 'req.headers["payment-signature"]'],
          },
  });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  return app;
}
