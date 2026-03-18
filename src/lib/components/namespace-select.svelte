<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import * as Command from '$lib/components/ui/command';
	import { ChevronsUpDown, Check } from 'lucide-svelte';

	interface Props {
		namespaces: string[];
		value?: string;
		onChange: (namespace: string) => void;
	}

	let { namespaces, value = 'all', onChange }: Props = $props();

	let open = $state(false);
	let listEl = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!open) return;
		const raf = requestAnimationFrame(() => {
			const el = listEl?.querySelector<HTMLElement>('[data-ns-selected]');
			el?.scrollIntoView({ block: 'center' });
		});
		return () => cancelAnimationFrame(raf);
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="inline-flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-3 text-xs text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none sm:w-44"
				role="combobox"
				aria-expanded={open}
			>
				<span class="truncate">
					{value === 'all' ? 'All namespaces' : value}
				</span>
				<ChevronsUpDown class="size-3 shrink-0 opacity-50" />
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-56 p-0" align="start">
		<Command.Root>
			<Command.Input placeholder="Search namespace..." />
			<Command.Empty>No namespace found</Command.Empty>
			<Command.List bind:ref={listEl} class="max-h-60 overflow-y-auto">
				<Command.Item
					value="all"
					data-ns-selected={value === 'all' ? '' : undefined}
					onSelect={() => {
						open = false;
						onChange('all');
					}}
				>
					All namespaces
					{#if value === 'all'}
						<Check class="ml-auto size-3" />
					{/if}
				</Command.Item>
				{#each namespaces as ns}
					<Command.Item
						value={ns}
						data-ns-selected={value === ns ? '' : undefined}
						onSelect={() => {
							open = false;
							onChange(ns);
						}}
					>
						{ns}
						{#if value === ns}
							<Check class="ml-auto size-3" />
						{/if}
					</Command.Item>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
