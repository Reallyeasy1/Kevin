import { buildApp } from './app.js';

const port = Number(process.env.API_PORT ?? 4010);
const app = await buildApp();
await app.listen({ port, host: '0.0.0.0' });
