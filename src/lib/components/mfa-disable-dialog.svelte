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
	import { ShieldOff, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open?: boolean;
		/** If set, admin is disabling MFA for another user */
		targetUserId?: number | null;
		targetUsername?: string;
		onClose: () => void;
		onDisabled?: () => void;
	}

	let {
		open = $bindable(false),
		targetUserId = null,
		targetUsername = '',
		onClose,
		onDisabled
	}: Props = $props();

	let password = $state('');
	let loading = $state(false);
	let error = $state('');

	const isAdminAction = $derived(targetUserId !== null);

	$effect(() => {
		if (open) {
			password = '';
			error = '';
		}
	});

	async function handleDisable() {
		error = '';

		if (!isAdminAction && !password.trim()) {
			error = 'Password is required';
			return;
		}

		loading = true;
		try {
			const body: Record<string, unknown> = {};
			if (isAdminAction) {
				body.userId = targetUserId;
			} else {
				body.password = password;
			}

			const res = await fetch('/api/auth/mfa/disable', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const data = await res.json();
				error = data.error || 'Failed to disable MFA';
				return;
			}

			toast.success(
				isAdminAction
					? `MFA disabled for ${targetUsername}`
					: 'Two-factor authentication disabled'
			);
			onDisabled?.();
			onClose();
		} catch (err) {
			console.error('[MFA Disable] Error:', err);
			error = 'Failed to disable MFA';
		} finally {
			loading = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-sm">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-base">
				<ShieldOff class="size-4 text-destructive" />
				Disable Two-Factor Authentication
			</DialogTitle>
			<DialogDescription class="text-xs">
				{#if isAdminAction}
					This will remove MFA for <strong>{targetUsername}</strong>. They will need to set it up again.
				{:else}
					This will remove the extra security layer from your account.
				{/if}
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-3 py-2">
			{#if !isAdminAction}
				<div class="space-y-1.5">
					<Label for="disable-password" class="text-xs">Confirm your password</Label>
					<Input
						id="disable-password"
						type="password"
						placeholder="Enter your password"
						bind:value={password}
						disabled={loading}
						autocomplete="current-password"
						class="h-8 text-xs"
					/>
				</div>
			{/if}

			{#if error}
				<p class="text-[11px] text-destructive">{error}</p>
			{/if}
		</div>

		<DialogFooter class="pt-2">
			<Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose} disabled={loading}>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				class="h-8 text-xs"
				onclick={handleDisable}
				disabled={loading || (!isAdminAction && !password.trim())}
			>
				{#if loading}
					<Loader2 class="mr-1.5 size-3 animate-spin" />
					Disabling…
				{:else}
					Disable MFA
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
