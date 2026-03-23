import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'crypto';
import * as OTPAuth from 'otpauth';
import { findUser } from '$lib/server/queries/users';
import { createSession } from '$lib/server/queries/sessions';
import { loadAuthConfig } from '$lib/server/queries/auth-settings';
import { logAuditEvent } from '$lib/server/queries/audit';
import { decrypt } from '$lib/server/helpers/encryption';

/**
 * POST /api/auth/mfa/validate — Validate a TOTP code during login.
 * Reads the mfa_pending cookie (set by login endpoint), verifies code, creates session.
 */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const pendingToken = cookies.get('mfa_pending');
		if (!pendingToken) {
			return json({ error: 'No pending MFA challenge' }, { status: 400 });
		}

		// Decrypt and parse the pending MFA token
		const decryptedToken = decrypt(pendingToken);
		if (!decryptedToken) {
			cookies.delete('mfa_pending', { path: '/' });
			return json({ error: 'Invalid MFA session' }, { status: 400 });
		}

		let pending: { userId: number; provider: string; exp: number };
		try {
			pending = JSON.parse(decryptedToken);
		} catch {
			cookies.delete('mfa_pending', { path: '/' });
			return json({ error: 'Invalid MFA session' }, { status: 400 });
		}

		// Check expiry (5 minute window)
		if (Date.now() > pending.exp) {
			cookies.delete('mfa_pending', { path: '/' });
			return json({ error: 'MFA session expired. Please log in again.' }, { status: 401 });
		}

		const body = await request.json();
		const { code } = body as { code?: string };

		if (!code || code.length < 6) {
			return json({ error: 'A valid code is required' }, { status: 400 });
		}

		const user = await findUser(pending.userId);
		if (!user || !user.isActive) {
			cookies.delete('mfa_pending', { path: '/' });
			return json({ error: 'User not found' }, { status: 404 });
		}

		if (!user.mfaSecret) {
			cookies.delete('mfa_pending', { path: '/' });
			return json({ error: 'MFA is not configured' }, { status: 400 });
		}

		const decryptedSecret = decrypt(user.mfaSecret);
		if (!decryptedSecret) {
			return json({ error: 'Failed to read MFA secret' }, { status: 500 });
		}

		const mfaData = JSON.parse(decryptedSecret) as { secret: string; backupCodes: string[] };

		// Try TOTP validation first
		const totp = new OTPAuth.TOTP({
			issuer: 'AutoKube',
			label: user.username,
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
			secret: OTPAuth.Secret.fromBase32(mfaData.secret)
		});

		const delta = totp.validate({ token: code, window: 1 });
		let usedBackupCode = false;

		if (delta === null) {
			// Try backup codes
			const normalizedCode = code.toLowerCase().trim();
			const codeIndex = mfaData.backupCodes.indexOf(normalizedCode);
			if (codeIndex === -1) {
				await logAuditEvent({
					username: user.username,
					action: 'login',
					entityType: 'user',
					entityId: String(user.id),
					entityName: user.username,
					description: `Failed MFA verification for "${user.username}"`,
					ipAddress: getClientAddress(),
					userAgent: request.headers.get('user-agent') ?? null
				});
				return json({ error: 'Invalid verification code' }, { status: 401 });
			}

			// Consume the backup code
			mfaData.backupCodes.splice(codeIndex, 1);
			const { encrypt } = await import('$lib/server/helpers/encryption');
			const { patchUser } = await import('$lib/server/queries/users');
			await patchUser(user.id, { mfaSecret: encrypt(JSON.stringify(mfaData)) });
			usedBackupCode = true;
		}

		// Clear the pending cookie
		cookies.delete('mfa_pending', { path: '/' });

		// Create full session
		const config = await loadAuthConfig();
		const sessionId = randomUUID();
		const timeout = config.sessionTimeout ?? 86400;
		const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();

		await createSession(sessionId, user.id, pending.provider, expiresAt);

		await logAuditEvent({
			username: user.username,
			action: 'login',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `User "${user.username}" logged in with MFA${usedBackupCode ? ' (backup code)' : ''}`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		cookies.set('session_id', sessionId, {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(expiresAt)
		});

		return json({
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				email: user.email
			},
			usedBackupCode,
			remainingBackupCodes: usedBackupCode ? mfaData.backupCodes.length : undefined
		});
	} catch (error) {
		console.error('[API] MFA validate error:', error);
		return json({ error: 'MFA validation failed' }, { status: 500 });
	}
};
