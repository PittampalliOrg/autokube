import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedPods } from '$lib/server/services/resource-cache';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/pods
 * Query params:
 *   - namespace: (optional) Filter by namespace, or 'all' for all namespaces
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.id);
	const namespace = url.searchParams.get('namespace') || 'all';

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	const result = await getCachedPods(clusterId, namespace);

	if (result.cache.status === 'warming' && result.cache.lastError) {
		return json(
			{ success: false, error: result.cache.lastError, cache: result.cache },
			{ status: 500 }
		);
	}

	return json({ success: true, pods: result.data, cache: result.cache });
};
