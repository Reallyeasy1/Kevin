import { defineConfig } from 'prisma/config';

// ponytail: default matches docker-compose.yml so `prisma generate` / `db push` work without a .env.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://subbuddy:subbuddy@localhost:5432/subbuddy',
  },
});
