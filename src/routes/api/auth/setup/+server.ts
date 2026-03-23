/**
 * POST /api/auth/setup
 * Creates the first admin user and enables authentication.
 * Only works when auth is disabled or no admin users exist.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scryptSync, randomBytes, randomUUID } from 'crypto';
import { insertUser, listUsers } from '$lib/server/queries/users';
import { adminExists } from '$lib/server/queries/users';
import { grantRole, listRoles } from '$lib/server/queries/roles';
import { createSession } from '$lib/server/queries/sessions';
import { loadAuthConfig, patchAuthConfig } from '$lib/server/queries/auth-settings';
import { logAuditEvent } from '$lib/server/queries/audit';

function hashPassword(plain: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(plain, salt, 32).toString('hex');
	return `${salt}:${hash}`;
}

export const GET: RequestHandler = async () => {
	try {
		const config = await loadAuthConfig();
		const hasAdmin = await adminExists();
		const allUsers = await listUsers();
		return json({
			needsSetup: !hasAdmin || allUsers.length === 0,
			authEnabled: config.authEnabled
		});
	} catch (error) {
		console.error('[API] Setup check error:', error);
		return json({ error: 'Failed to check setup status' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		// Only allow setup when no admin exists
		const hasAdmin = await adminExists();
		const allUsers = await listUsers();

		if (hasAdmin && allUsers.length > 0) {
			return json({ error: 'Setup already completed. Admin user exists.' }, { status: 400 });
		}

		const body = await request.json();
		const { username, password, email } = body as {
			username?: string;
			password?: string;
			email?: string;
		};

		if (!username?.trim()) {
			return json({ error: 'Username is required' }, { status: 400 });
		}
		if (!password || password.length < 8) {
			return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
		}

		// Create the admin user
		const passwordHash = hashPassword(password);
		const user = await insertUser({
			username: username.trim(),
			email: email?.trim() || undefined,
			passwordHash,
			displayName: username.trim()
		});

		// Assign Admin role
		const allRoles = await listRoles();
		const adminRole = allRoles.find((r) => r.name === 'Admin');
		if (adminRole) {
			await grantRole(user.id, adminRole.id);
		}

		// Enable authentication
		await patchAuthConfig({ authEnabled: true });

		// Create session so the user is logged in immediately
		const config = await loadAuthConfig();
		const sessionId = randomUUID();
		const timeout = config.sessionTimeout ?? 86400;
		const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();
		await createSession(sessionId, user.id, 'local', expiresAt);

		cookies.set('session_id', sessionId, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(expiresAt)
		});

		await logAuditEvent({
			username: user.username,
			action: 'create',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `Initial admin setup: created admin user "${user.username}" and enabled authentication`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				email: user.email
			}
		});
	} catch (error) {
		console.error('[API] Setup error:', error);
		return json({ error: 'Setup failed' }, { status: 500 });
	}
};
