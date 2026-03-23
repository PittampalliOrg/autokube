import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scryptSync, timingSafeEqual } from 'crypto';
import { authorize } from '$lib/server/services/authorize';
import { findUser, patchUser } from '$lib/server/queries/users';
import { logAuditEvent } from '$lib/server/queries/audit';

function verifyPassword(plain: string, stored: string): boolean {
	if (stored.startsWith('sso:')) return false;
	const parts = stored.split(':');
	if (parts.length !== 2) return false;
	const [salt, storedHash] = parts;
	try {
		const hash = scryptSync(plain, salt, 32).toString('hex');
		return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
	} catch {
		return false;
	}
}

/** POST /api/auth/mfa/disable — Disable MFA (requires current password for local users). */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const ctx = await authorize(cookies);
		if (!ctx.isAuthenticated || !ctx.user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const body = await request.json();
		const { password, userId: targetUserId } = body as { password?: string; userId?: number };

		// Determine target: admins can disable MFA for other users
		const isAdminAction = targetUserId !== undefined && targetUserId !== ctx.user.id;

		if (isAdminAction) {
			if (!ctx.isAdmin) {
				return json({ error: 'Only admins can disable MFA for other users' }, { status: 403 });
			}
		} else {
			// Self-disable requires password verification for local users
			if (!password) {
				return json({ error: 'Password is required to disable MFA' }, { status: 400 });
			}
		}

		const userId = isAdminAction ? targetUserId! : ctx.user.id;
		const user = await findUser(userId);
		if (!user) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		if (!user.mfaEnabled) {
			return json({ error: 'MFA is not enabled' }, { status: 400 });
		}

		// Verify password for self-disable (local auth only)
		if (!isAdminAction && user.authProvider === 'local') {
			if (!verifyPassword(password!, user.passwordHash)) {
				return json({ error: 'Invalid password' }, { status: 401 });
			}
		}

		// Disable MFA and clear secret
		await patchUser(userId, { mfaEnabled: false, mfaSecret: null });

		await logAuditEvent({
			username: ctx.user.username,
			action: 'update',
			entityType: 'user',
			entityId: String(userId),
			entityName: user.username,
			description: isAdminAction
				? `Admin "${ctx.user.username}" disabled MFA for "${user.username}"`
				: `MFA disabled for "${user.username}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (error) {
		console.error('[API] MFA disable error:', error);
		return json({ error: 'Failed to disable MFA' }, { status: 500 });
	}
};
