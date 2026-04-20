/**
 * Composable for Kubernetes pod metrics watching via SSE
 * Separate from resource watching since metrics use polling-based SSE
 */

import { browser } from '$app/environment';
import type { WatchEvent } from '$lib/stores/kubernetes-watch';

export interface PodMetric {
	name: string;
	namespace: string;
	cpu: string;
	memory: string;
	containers: Array<{
		name: string;
		cpu: string;
		memory: string;
	}>;
}

export interface MetricsWatchOptions {
	/** Cluster ID to watch */
	clusterId: number;
	/** Optional namespace filter */
	namespace?: string;
	/** Callback when metric is updated */
	onUpdate?: (metric: PodMetric) => void;
	/** Callback when metric is deleted (pod removed) */
	onDelete?: (metric: PodMetric) => void;
	/** Callback on connection error */
	onError?: (error: unknown) => void;
}

/**
 * Hook for watching pod metrics in real-time
 *
 * @example
 * const metricsWatch = useMetricsWatch({
 *   clusterId: activeCluster.id,
 *   namespace: selectedNamespace,
 *   onUpdate: (metric) => {
 *     metricsMap.set(`${metric.namespace}/${metric.name}`, {
 *       cpu: metric.cpu,
 *       memory: metric.memory
 *     });
 *   },
 *   onDelete: (metric) => {
 *     metricsMap.delete(`${metric.namespace}/${metric.name}`);
 *   }
 * });
 *
 * // Setup watch
 * metricsWatch.subscribe();
 *
 * // Later, cleanup
 * metricsWatch.unsubscribe();
 */
export function useMetricsWatch(options: MetricsWatchOptions) {
	const browserSseEnabled = false;

	if (!browser) {
		return {
			subscribe: () => {},
			unsubscribe: () => {},
			isActive: false
		};
	}

	let eventSource: EventSource | null = null;
	let isActive = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let backoffAttempts = 0;
	const maxReconnectAttempts = 5;

	const permanentErrorCodes = new Set([
		'METRICS_DISABLED',
		'METRICS_UNAVAILABLE',
		'CONFIG_ERROR',
		'AGENT_NOT_SUPPORTED'
	]);

	function getBackoffMs(): number {
		return Math.min(1000 * Math.pow(2, backoffAttempts), 30_000);
	}

	function closeConnection() {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}

		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	function stopAfterPermanentError(error: unknown) {
		if (options.onError) options.onError(error);
		isActive = false;
		closeConnection();
	}

	function connect() {
		if (!isActive) return;

		const watchNamespace = options.namespace === 'all' ? undefined : options.namespace;
		const metricsUrl = `/api/watch/${options.clusterId}/metrics${watchNamespace ? `?namespace=${watchNamespace}` : ''}`;

		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}

		eventSource = new EventSource(metricsUrl);

		eventSource.onopen = () => {
			// Connection opened; keep the current backoff until data is received.
		};

		eventSource.onmessage = (e: MessageEvent) => {
			try {
				const event = JSON.parse(e.data) as WatchEvent & { code?: string };

				if (event.type === 'MODIFIED') {
					backoffAttempts = 0;
					const metric = event.object as PodMetric;
					if (options.onUpdate) options.onUpdate(metric);
				} else if (event.type === 'DELETED') {
					backoffAttempts = 0;
					const metric = event.object as PodMetric;
					if (options.onDelete) options.onDelete(metric);
				} else if (event.type === 'ERROR') {
					if (event.code === 'CLUSTER_UNREACHABLE') {
						// K8s API down — close and reconnect with backoff
						console.warn('[Metrics Watch] Cluster unreachable, backing off…');
						eventSource?.close();
						eventSource = null;
						scheduleReconnect();
					} else if (event.code && permanentErrorCodes.has(event.code)) {
						console.warn(`[Metrics Watch] ${event.code}: ${(event as any).error ?? ''}`);
						stopAfterPermanentError((event as any).error ?? event.code);
					} else {
						if (options.onError) options.onError((event as any).error);
					}
				}
			} catch (err) {
				console.error('[Metrics Watch] Failed to parse event:', err);
				if (options.onError) options.onError(err);
			}
		};

		eventSource.onerror = () => {
			if (!isActive) return;
			eventSource?.close();
			eventSource = null;
			scheduleReconnect();
		};
	}

	function scheduleReconnect() {
		if (!isActive) return;
		if (backoffAttempts >= maxReconnectAttempts) {
			console.warn(
				`[Metrics Watch] Disabled after ${maxReconnectAttempts} failed reconnect attempts`
			);
			isActive = false;
			closeConnection();
			return;
		}
		if (reconnectTimer) clearTimeout(reconnectTimer);
		const delay = getBackoffMs();
		backoffAttempts++;
		console.warn(`[Metrics Watch] Reconnecting in ${delay}ms (attempt ${backoffAttempts})…`);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	}

	const subscribe = () => {
		if (!browserSseEnabled) {
			console.info('[Metrics Watch] Browser live metrics disabled; using snapshot refresh only');
			return;
		}

		if (isActive) {
			console.warn('[Metrics Watch] Already subscribed');
			return;
		}

		isActive = true;
		backoffAttempts = 0;
		connect();

		console.log(
			`[Metrics Watch] Subscribed (cluster ${options.clusterId}, ns=${options.namespace ?? 'all'})`
		);
	};

	const unsubscribe = () => {
		if (!isActive) return;

		isActive = false;
		closeConnection();

		console.log('[Metrics Watch] Unsubscribed');
	};

	return {
		subscribe,
		unsubscribe,
		get isActive() {
			return isActive;
		}
	};
}
