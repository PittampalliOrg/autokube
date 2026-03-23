import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { authorize } from '$lib/server/services/authorize';
import { findUser, patchUser } from '$lib/server/queries/users';
import { encrypt } from '$lib/server/helpers/encryption';
import { logAuditEvent } from '$lib/server/queries/audit';

/** Generate 8 random backup codes (8 hex chars each). */
function generateBackupCodes(): string[] {
	return Array.from({ length: 8 }, () => randomBytes(4).toString('hex'));
}

/** POST /api/auth/mfa/setup — Generate TOTP secret + QR code for the authenticated user. */
export const POST: RequestHandler = async ({ cookies, request, getClientAddress }) => {
	try {
		const ctx = await authorize(cookies);
		if (!ctx.isAuthenticated || !ctx.user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		const user = await findUser(ctx.user.id);
		if (!user) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		if (user.mfaEnabled) {
			return json({ error: 'MFA is already enabled' }, { status: 400 });
		}

		// Generate TOTP secret
		const totp = new OTPAuth.TOTP({
			issuer: 'AutoKube',
			label: user.username,
			algorithm: 'SHA1',
			digits: 6,
			period: 30,
			secret: new OTPAuth.Secret({ size: 20 })
		});

		const backupCodes = generateBackupCodes();

		// Store the pending secret (not yet verified — mfaEnabled stays false)
		const mfaData = JSON.stringify({
			secret: totp.secret.base32,
			backupCodes
		});

		await patchUser(user.id, { mfaSecret: encrypt(mfaData) });

		// Generate QR code as data URL
		const otpauthUri = totp.toString();
		const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
			width: 256,
			margin: 2,
			color: { dark: '#000000', light: '#ffffff' }
		});

		await logAuditEvent({
			username: user.username,
			action: 'update',
			entityType: 'user',
			entityId: String(user.id),
			entityName: user.username,
			description: `MFA setup initiated for "${user.username}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({
			secret: totp.secret.base32,
			qrCode: qrCodeDataUrl,
			backupCodes
		});
	} catch (error) {
		console.error('[API] MFA setup error:', error);
		return json({ error: 'Failed to set up MFA' }, { status: 500 });
	}
};
