// src/lib/auth.ts - Authentication utilities
import { hash, compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import prisma from './prisma';

if (!process.env.JWT_SECRET) {
  throw new Error("CRITICAL ERROR: JWT_SECRET environment variable is not set. Refusing to start.");
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const SALT_ROUNDS = 12;

// ─── Password Helpers ───────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return compare(password, hashed);
}

// ─── JWT Helpers ────────────────────────────────────────────────────
export async function createToken(payload: { userId: string; email: string; role: string }): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; email: string; role: string };
  } catch {
    return null;
  }
}

// ─── Server-Side Auth ───────────────────────────────────────────────
export async function getAuthUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        image: true,
        phone: true,
        address: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user?.isActive ? user : null;
  } catch {
    return null;
  }
}

// ─── Role Checks ────────────────────────────────────────────────────
export function isAdmin(role: string) {
  return role === 'ADMIN';
}

export function canManageInventory(role: string) {
  return ['ADMIN', 'INVENTORY_MANAGER'].includes(role);
}

export function canManageFinance(role: string) {
  return ['ADMIN', 'ACCOUNTANT'].includes(role);
}

export function canManageProjects(role: string) {
  return ['ADMIN', 'EMPLOYEE', 'PARTNER'].includes(role);
}

export function canViewAll(role: string) {
  return ['ADMIN', 'PARTNER'].includes(role);
}

// ─── Permission Middleware ──────────────────────────────────────────
export function requireRole(...roles: string[]) {
  return async () => {
    const user = await getAuthUser();
    if (!user) return { authorized: false, user: null, error: 'Not authenticated' };
    if (!roles.includes(user.role)) return { authorized: false, user, error: 'Insufficient permissions' };
    return { authorized: true, user, error: null };
  };
}