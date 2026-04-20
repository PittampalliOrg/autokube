import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedPodMetrics } from '$lib/server/services/resource-cache';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const clusterId = parseInt(params.id);
		const namespace = url.searchParams.get('namespace') || 'all';

		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await getCachedPodMetrics(clusterId, namespace);

		if (result.cache.status === 'warming' && result.cache.lastError) {
			return json(
				{ success: false, error: result.cache.lastError, cache: result.cache },
				{ status: 500 }
			);
		}

		return json({ success: true, metrics: result.data, cache: result.cache });
	} catch (error) {
		console.error('[Pods Metrics API] Error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch pod metrics'
			},
			{ status: 500 }
		);
	}
};
