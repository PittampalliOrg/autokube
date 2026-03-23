<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogDescription
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { ShieldCheck, Copy, Check, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open?: boolean;
		onClose: () => void;
		onEnabled?: () => void;
	}

	let { open = $bindable(false), onClose, onEnabled }: Props = $props();

	type Step = 'init' | 'scan' | 'verify' | 'backup' | 'done';

	let step = $state<Step>('init');
	let loading = $state(false);
	let secret = $state('');
	let qrCode = $state('');
	let backupCodes = $state<string[]>([]);
	let verifyCode = $state('');
	let verifyError = $state('');
	let copiedSecret = $state(false);
	let copiedBackup = $state(false);

	$effect(() => {
		if (open) {
			step = 'init';
			secret = '';
			qrCode = '';
			backupCodes = [];
			verifyCode = '';
			verifyError = '';
			copiedSecret = false;
			copiedBackup = false;
		}
	});

	async function startSetup() {
		loading = true;
		try {
			const res = await fetch('/api/auth/mfa/setup', { method: 'POST' });
			if (!res.ok) {
				const data = await res.json();
				toast.error(data.error || 'Failed to start MFA setup');
				return;
			}
			const data = await res.json();
			secret = data.secret;
			qrCode = data.qrCode;
			backupCodes = data.backupCodes;
			step = 'scan';
		} catch (err) {
			console.error('[MFA Setup] Error:', err);
			toast.error('Failed to start MFA setup');
		} finally {
			loading = false;
		}
	}

	async function verifySetup() {
		verifyError = '';
		if (!verifyCode.trim() || verifyCode.trim().length !== 6) {
			verifyError = 'Enter a valid 6-digit code';
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/mfa/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: verifyCode.trim() })
			});

			if (!res.ok) {
				const data = await res.json();
				verifyError = data.error || 'Invalid code';
				return;
			}

			step = 'backup';
		} catch (err) {
			console.error('[MFA Setup] Verify error:', err);
			verifyError = 'Verification failed';
		} finally {
			loading = false;
		}
	}

	async function copyToClipboard(text: string, type: 'secret' | 'backup') {
		try {
			await navigator.clipboard.writeText(text);
			if (type === 'secret') {
				copiedSecret = true;
				setTimeout(() => (copiedSecret = false), 2000);
			} else {
				copiedBackup = true;
				setTimeout(() => (copiedBackup = false), 2000);
			}
		} catch {
			toast.error('Failed to copy to clipboard');
		}
	}

	function finishSetup() {
		step = 'done';
		toast.success('Two-factor authentication enabled');
		onEnabled?.();
		onClose();
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-base">
				<ShieldCheck class="size-4 text-primary" />
				Set Up Two-Factor Authentication
			</DialogTitle>
			<DialogDescription class="text-xs">
				{#if step === 'init'}
					Add an extra layer of security to your account.
				{:else if step === 'scan'}
					Scan the QR code with your authenticator app.
				{:else if step === 'verify'}
					Enter a code from your authenticator app to confirm setup.
				{:else if step === 'backup'}
					Save your backup codes in a secure location.
				{/if}
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-4 py-2">
			{#if step === 'init'}
				<div class="rounded-lg border bg-muted/50 p-4">
					<p class="text-xs leading-relaxed text-muted-foreground">
						Two-factor authentication adds an extra layer of security by requiring a verification
						code from an authenticator app (like Google Authenticator, Authy, or 1Password) in
						addition to your password.
					</p>
				</div>

			{:else if step === 'scan'}
				<!-- QR Code -->
				<div class="flex flex-col items-center gap-3">
					<div class="rounded-lg border bg-white p-2">
						<img src={qrCode} alt="MFA QR Code" class="size-48" />
					</div>
					<p class="text-center text-[11px] text-muted-foreground">
						Scan this QR code with Google Authenticator or a compatible app
					</p>
				</div>

				<!-- Manual entry fallback -->
				<div class="space-y-1.5">
					<Label class="text-xs text-muted-foreground">Can't scan? Enter this key manually:</Label>
					<div class="flex items-center gap-2">
						<code
							class="flex-1 rounded border bg-muted px-2 py-1.5 font-mono text-[11px] tracking-wide select-all"
						>
							{secret}
						</code>
						<Button
							variant="ghost"
							size="icon"
							class="size-7"
							onclick={() => copyToClipboard(secret, 'secret')}
						>
							{#if copiedSecret}
								<Check class="size-3 text-green-500" />
							{:else}
								<Copy class="size-3" />
							{/if}
						</Button>
					</div>
				</div>

			{:else if step === 'verify'}
				<div class="space-y-1.5">
					<Label for="verify-code" class="text-xs">Verification Code</Label>
					<Input
						id="verify-code"
						type="text"
						inputmode="numeric"
						placeholder="000000"
						bind:value={verifyCode}
						disabled={loading}
						autocomplete="one-time-code"
						maxlength={6}
						class="h-9 text-center font-mono text-lg tracking-widest"
					/>
					{#if verifyError}
						<p class="text-[11px] text-destructive">{verifyError}</p>
					{/if}
				</div>

			{:else if step === 'backup'}
				<div class="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
					<p class="text-xs font-medium text-yellow-600 dark:text-yellow-400">
						Save these backup codes! Each code can only be used once. Store them in a safe place — 
						you'll need them if you lose access to your authenticator app.
					</p>
				</div>

				<div class="grid grid-cols-2 gap-1.5">
					{#each backupCodes as code}
						<div class="rounded border bg-muted px-2 py-1 text-center font-mono text-xs">
							{code}
						</div>
					{/each}
				</div>

				<Button
					variant="outline"
					size="sm"
					class="w-full gap-1.5 text-xs"
					onclick={() => copyToClipboard(backupCodes.join('\n'), 'backup')}
				>
					{#if copiedBackup}
						<Check class="size-3 text-green-500" />
						Copied!
					{:else}
						<Copy class="size-3" />
						Copy Backup Codes
					{/if}
				</Button>
			{/if}
		</div>

		<DialogFooter class="gap-2 pt-2">
			{#if step === 'init'}
				<Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose}>
					Cancel
				</Button>
				<Button size="sm" class="h-8 text-xs" onclick={startSetup} disabled={loading}>
					{#if loading}
						<Loader2 class="mr-1.5 size-3 animate-spin" />
						Setting up…
					{:else}
						Get Started
					{/if}
				</Button>

			{:else if step === 'scan'}
				<Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose}>
					Cancel
				</Button>
				<Button size="sm" class="h-8 text-xs" onclick={() => (step = 'verify')}>
					I've Scanned It
				</Button>

			{:else if step === 'verify'}
				<Button variant="outline" size="sm" class="h-8 text-xs" onclick={() => (step = 'scan')}>
					Back
				</Button>
				<Button
					size="sm"
					class="h-8 text-xs"
					onclick={verifySetup}
					disabled={loading || verifyCode.trim().length !== 6}
				>
					{#if loading}
						<Loader2 class="mr-1.5 size-3 animate-spin" />
						Verifying…
					{:else}
						Verify & Enable
					{/if}
				</Button>

			{:else if step === 'backup'}
				<Button size="sm" class="h-8 text-xs" onclick={finishSetup}>
					I've Saved My Backup Codes
				</Button>
			{/if}
		</DialogFooter>
	</DialogContent>
</Dialog>
