import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type Db = PrismaClient;

export function createDb(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
