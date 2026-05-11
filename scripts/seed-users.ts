// Run with: npx tsx scripts/seed-users.ts
// Requires: KV_REST_API_URL and KV_REST_API_TOKEN in environment (or .env.local)
import { createClient } from '@vercel/kv';
import bcrypt from 'bcryptjs';

// Load KV creds from env
const kv = createClient({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const USERS = [
  {
    email: 'ben@eloso.ai',
    name: 'Ben Roome',
    password: process.env.BEN_INITIAL_PASSWORD!,
  },
  {
    email: 'jake@eloso.ai',
    name: 'Jake Metcalf',
    password: process.env.JAKE_INITIAL_PASSWORD!,
  },
  {
    email: 'drew@eloso.ai',
    name: 'Drew Winget',
    password: process.env.DREW_INITIAL_PASSWORD!,
  },
];

async function seed() {
  for (const u of USERS) {
    if (!u.password) {
      console.error(
        `Missing password env var for ${u.email}. Set BEN_INITIAL_PASSWORD, JAKE_INITIAL_PASSWORD, DREW_INITIAL_PASSWORD.`
      );
      process.exit(1);
    }
    const hash = await bcrypt.hash(u.password, 12);
    const id = `usr_${u.email.split('@')[0]}`;
    await kv.set(`user:${u.email}`, {
      id,
      email: u.email,
      name: u.name,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    });
    console.log(`Created user: ${u.email}`);
  }
  console.log('Seeding complete.');
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
