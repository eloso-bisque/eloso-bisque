import { kv } from '@vercel/kv';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return kv.get<User>(`user:${email.toLowerCase()}`);
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function setUserPassword(email: string, newPassword: string): Promise<void> {
  const user = await getUserByEmail(email);
  if (!user) throw new Error('User not found');
  const hash = await bcrypt.hash(newPassword, 12);
  await kv.set(`user:${email.toLowerCase()}`, { ...user, passwordHash: hash });
}

export async function createUser(
  email: string,
  name: string,
  password: string
): Promise<User> {
  const id = `usr_${Date.now()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const user: User = {
    id,
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await kv.set(`user:${email.toLowerCase()}`, user);
  return user;
}
