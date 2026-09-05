import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('api /health', () => {
  it('responds ok', async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'api' });
    await app.close();
  }, 20_000);
});
