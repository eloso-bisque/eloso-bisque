/**
 * Prisma Client singleton for eloso-bisque.
 *
 * Uses the global pattern to avoid creating multiple instances during
 * Next.js hot-reload in development. In production, each serverless
 * invocation gets a fresh module scope.
 *
 * Usage:
 *   import { prisma } from '@/lib/prisma'
 *   const contacts = await prisma.contact.findMany()
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Prisma 7's "client" query engine requires an explicit driver adapter (no
// `url = env(...)` is embedded in prisma/schema.prisma — the connection
// string is supplied at runtime instead, via prisma.config.ts for the CLI
// and here for the app). We use the plain `pg` adapter against Neon's
// pooled connection string (DATABASE_URL), which works over standard
// Postgres wire protocol from Node.js serverless functions.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
