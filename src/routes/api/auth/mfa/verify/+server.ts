import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as OTPAuth from 'otpauth';
import { authorize } from '$lib/server/services/authorize';
import { findUser, patchUser } from '$lib/server/queries/users';
import { decrypt, encrypt } from '$lib/server/helpers/encryption';
import { logAuditEvent } from '$lib/server/queries/audit';

/** POST /api/auth/mfa/verify — Verify a TOTP code and activate MFA for the authenticated user. */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	try {
		const ctx = await authorize(cookies);
		if (!ctx.isAuthenticated || !ctx.user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const body = await request.json();
		const { code } = body as { code?: string };

		if (!code || code.length !== 6) {
			return json({ error: 'A valid 6-digit code is required' }, { status: 400 });
		}

		const user = await findUser(ctx.user.id);
		if (!user) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		if (user.mfaEnabled) {
			return json({ error: 'MFA is already enabled' }, { status: 400 });
		}

		if (!user.mfaSecret) {
			return json({ error: 'MFA setup has not been initiated' }, { status: 400 });
		}

		// Decrypt and parse stored secret
		const decrypted = decrypt(user.mfaSecret);
		if (!decrypted) {
			return json({ error: 'Failed to read MFA secret' }, { status: 500 });
		}

		const mfaData = JSON.parse(decrypted) as { secret: string; backupCodes: string[] };

		// Validate the TOTP code
		const totp = new OTPAuth.TOTP({
			issuer: 'AutoKube',
			label: user.username,
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
			secret: OTPAuth.Secret.fromBase32(mfaData.secret)
		});

		const delta = totp.validate({ token: code, window: 1 });
		if (delta === null) {
			return json({ error: 'Invalid verification code' }, { status: 400 });
		}

		// Enable MFA
		await patchUser(user.id, { mfaEnabled: true });

		await logAuditEvent({
			username: user.username,
			action: 'update',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `MFA enabled for "${user.username}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (error) {
		console.error('[API] MFA verify error:', error);
		return json({ error: 'Failed to verify MFA code' }, { status: 500 });
	}
};
