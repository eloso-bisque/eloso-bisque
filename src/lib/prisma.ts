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

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
