/**
 * SSE endpoint for pod metrics
 * Polls metrics-server every 3 seconds and streams changes to the browser
 *
 * GET /api/watch/:clusterId/metrics?namespace=...
 */

import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import type { PodMetrics } from '$lib/server/services/kubernetes';
import { transformPodMetrics } from '$lib/server/services/kubernetes/transformers';
import { findCluster } from '$lib/server/queries/clusters';
import { makeClusterRequest } from '$lib/server/services/kubernetes/utils';
import { authorize } from '$lib/server/services/authorize';

const sseHeaders = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache, no-transform',
	'X-Accel-Buffering': 'no'
};

function sseError(code: string, message: string) {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ type: 'ERROR', code, error: message })}\n\n`
				)
			);
			controller.close();
		}
	});

	return new Response(stream, { headers: sseHeaders });
}

function classifyMetricsError(message: string): { code: string; message: string; reconnect: boolean } {
	const lower = message.toLowerCase();

	if (lower.includes('resource not found') || lower.includes('http 404')) {
		return {
			code: 'METRICS_UNAVAILABLE',
			message: 'Metrics API is not available for this cluster',
			reconnect: false
		};
	}

	if (
		lower.includes('credentials') ||
		lower.includes('kubeconfig') ||
		lower.includes('bearer token') ||
		lower.includes('unsupported authentication') ||
		lower.includes('unsupported auth') ||
		lower.includes('could not be decrypted') ||
		lower.includes('encryption key') ||
		lower.includes('authentication failed') ||
		lower.includes('access denied')
	) {
		return {
			code: 'CONFIG_ERROR',
			message,
			reconnect: false
		};
	}

	return {
		code: 'CLUSTER_UNREACHABLE',
		message: 'Cannot connect to Kubernetes API server',
		reconnect: true
	};
}

function waitUntilAborted(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();

	return new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve(), { once: true });
	});
}

export async function GET({ params, url, cookies }: RequestEvent) {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId || '0');
	const namespace = url.searchParams.get('namespace') || undefined;

	if (isNaN(clusterId)) {
		throw error(400, 'Invalid cluster ID');
	}

	const cluster = await findCluster(clusterId);
	if (!cluster) {
		throw error(404, 'Cluster not found');
	}

	// EventSource clients need an SSE response even for permanent no-metrics states.
	if (cluster.metricsEnabled === false) {
		return sseError('METRICS_DISABLED', 'Metrics are disabled for this cluster');
	}

	const abortController = new AbortController();

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Stream closed, ignore
				}
			};
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					// Stream closed, ignore
				}
			}, 25_000);

			// Initial ping so the client knows the connection is alive
			send({ type: 'connected', resource: 'metrics' });

			// Store previous metrics to detect changes
			let previousMetrics = new Map<string, { cpu: string; memory: string }>();

			console.log(
				`[SSE Metrics] Starting metrics stream (cluster ${clusterId}, ns=${namespace ?? 'all'})`
			);

			try {
				// Poll metrics every 3 seconds
				const pollInterval = 3000;
				let hasBaseline = false;

				while (!abortController.signal.aborted) {
					try {
						// Fetch raw metrics from K8s API
						const effectiveNamespace = namespace === 'all' ? undefined : namespace;
						const path = effectiveNamespace
							? `/apis/metrics.k8s.io/v1beta1/namespaces/${effectiveNamespace}/pods`
							: '/apis/metrics.k8s.io/v1beta1/pods';

						const result = await makeClusterRequest<{
							items: Array<{
								metadata: { name: string; namespace?: string };
								containers?: Array<{
									name?: string;
									usage?: { cpu?: string; memory?: string };
								}>;
							}>;
						}>(clusterId, path, 30000);

						if (result.success && result.data?.items) {
							// Transform raw metrics to PodMetrics format
							const currentMetrics = new Map<string, PodMetrics>();

							result.data.items.forEach((rawMetric) => {
								try {
									const transformedMetric = transformPodMetrics(rawMetric);
									const key = `${transformedMetric.namespace}/${transformedMetric.name}`;
									currentMetrics.set(key, transformedMetric);

									// Check if this is new or changed
									const previous = previousMetrics.get(key);
									const current = { cpu: transformedMetric.cpu, memory: transformedMetric.memory };

									if (
										hasBaseline &&
										(!previous ||
											previous.cpu !== current.cpu ||
											previous.memory !== current.memory)
									) {
										// Send as MODIFIED event with full PodMetrics structure
										send({
											type: 'MODIFIED',
											object: transformedMetric
										});
									}
								} catch (err) {
									console.error('[SSE Metrics] Failed to transform metric:', err);
								}
							});

							// Check for deleted pods (metrics disappeared)
							if (hasBaseline) {
								for (const [key, previousMetric] of previousMetrics) {
									if (!currentMetrics.has(key)) {
										send({
											type: 'DELETED',
											object: previousMetric
										});
									}
								}
							}

							// Update previous metrics map
							previousMetrics = new Map();
							for (const [key, metric] of currentMetrics) {
								previousMetrics.set(key, { cpu: metric.cpu, memory: metric.memory });
							}
							hasBaseline = true;
						} else if (!result.success) {
							const classified = classifyMetricsError(result.error ?? 'Metrics request failed');
							send({
								type: 'ERROR',
								code: classified.code,
								error: classified.message
							});
							if (!classified.reconnect) {
								await waitUntilAborted(abortController.signal);
								break;
							}
						}
					} catch (err: any) {
						const errorCode: string = err?.code ?? '';
						const errorMsg: string = err instanceof Error ? err.message : 'Unknown error';
						if (
							errorCode === 'ECONNREFUSED' ||
							errorCode === 'ETIMEDOUT' ||
							errorCode === 'ENOTFOUND'
						) {
							// K8s API unreachable — tell the client to back off
							send({
								type: 'ERROR',
								code: 'CLUSTER_UNREACHABLE',
								error: 'Cannot connect to Kubernetes API server'
							});
						} else if (!errorMsg.includes('404')) {
							console.error('[SSE Metrics] Poll error:', errorMsg);
						}
					}

					// Wait before next poll
					await new Promise<void>((resolve, reject) => {
						const timeout = setTimeout(resolve, pollInterval);
						abortController.signal.addEventListener('abort', () => {
							clearTimeout(timeout);
							reject(new Error('Aborted'));
						});
					});
				}
			} catch (err: any) {
				const errorMsg = err instanceof Error ? err.message : 'Unknown error';
				// Ignore expected abort/disconnect errors
				const isAbort =
					err?.name === 'AbortError' ||
					err?.code === 'ECONNRESET' ||
					errorMsg.includes('aborted') ||
					errorMsg.includes('Aborted');

				if (!isAbort) {
					console.error('[SSE Metrics] Stream error:', err);
					send({ type: 'ERROR', error: errorMsg });
				}
			}

			console.log('[SSE Metrics] Stream ended');
			clearInterval(heartbeat);

			try {
				controller.close();
			} catch {
				// Already closed
			}
		},
		cancel() {
			// Browser closed the connection
			abortController.abort();
		}
	});

	return new Response(stream, {
		headers: sseHeaders
	});
}
