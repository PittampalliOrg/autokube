/**
 * In-process resource cache for high-churn Kubernetes views.
 *
 * Browser SSE watches are intentionally disabled for the pods table. This
 * service centralizes polling on the server so every browser tab reads the
 * same recent snapshot instead of opening its own cluster watch/poll loop.
 */

import { findCluster, listClusters } from '../queries/clusters';
import type { Cluster } from '../db';
import { listPodMetrics, listPods } from './kubernetes';
import type { PodInfo, PodMetrics } from './kubernetes';

const REFRESH_INTERVAL_MS = 10_000;
const STALE_AFTER_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const CLUSTER_STAGGER_MS = 500;

export type ResourceCacheStatus = 'warming' | 'ready' | 'error' | 'disabled';

export interface ResourceCacheMeta {
	status: ResourceCacheStatus;
	lastUpdated: string | null;
	lastError: string | null;
	ageMs: number | null;
	stale: boolean;
}

export interface ResourceCacheSnapshot<T> {
	data: T[];
	cache: ResourceCacheMeta;
}

interface CacheEntry<T> {
	data: T[];
	status: ResourceCacheStatus;
	lastUpdated: number | null;
	lastError: string | null;
	failures: number;
	nextAllowedRefreshAt: number;
	refreshInFlight: Promise<void> | null;
}

declare global {
	var __resourceCacheVersion: number;
	var __resourceCacheHandle: ReturnType<typeof setInterval> | null;
	var __resourceCacheStartupTimeout: ReturnType<typeof setTimeout> | null;
	var __resourceCacheClusterTimeouts: Set<ReturnType<typeof setTimeout>>;
	var __resourceCachePods: Map<number, CacheEntry<PodInfo>>;
	var __resourceCachePodMetrics: Map<number, CacheEntry<PodMetrics>>;
}

globalThis.__resourceCacheVersion = (globalThis.__resourceCacheVersion ?? 0) + 1;
const MY_VERSION = globalThis.__resourceCacheVersion;

if (globalThis.__resourceCacheHandle) {
	clearInterval(globalThis.__resourceCacheHandle);
	globalThis.__resourceCacheHandle = null;
}
if (globalThis.__resourceCacheStartupTimeout) {
	clearTimeout(globalThis.__resourceCacheStartupTimeout);
	globalThis.__resourceCacheStartupTimeout = null;
}
if (globalThis.__resourceCacheClusterTimeouts) {
	for (const timeout of globalThis.__resourceCacheClusterTimeouts) clearTimeout(timeout);
	globalThis.__resourceCacheClusterTimeouts.clear();
}

globalThis.__resourceCacheClusterTimeouts ??= new Set();
globalThis.__resourceCachePods ??= new Map();
globalThis.__resourceCachePodMetrics ??= new Map();

const podsCache = globalThis.__resourceCachePods;
const podMetricsCache = globalThis.__resourceCachePodMetrics;
const clusterTimeouts = globalThis.__resourceCacheClusterTimeouts;

function isCurrentVersion(): boolean {
	return MY_VERSION === globalThis.__resourceCacheVersion;
}

function createEntry<T>(): CacheEntry<T> {
	return {
		data: [],
		status: 'warming',
		lastUpdated: null,
		lastError: null,
		failures: 0,
		nextAllowedRefreshAt: 0,
		refreshInFlight: null
	};
}

function getEntry<T>(cache: Map<number, CacheEntry<T>>, clusterId: number): CacheEntry<T> {
	let entry = cache.get(clusterId);
	if (!entry) {
		entry = createEntry<T>();
		cache.set(clusterId, entry);
	}
	return entry;
}

function buildMeta<T>(entry: CacheEntry<T>): ResourceCacheMeta {
	const ageMs = entry.lastUpdated ? Date.now() - entry.lastUpdated : null;
	return {
		status: entry.status,
		lastUpdated: entry.lastUpdated ? new Date(entry.lastUpdated).toISOString() : null,
		lastError: entry.lastError,
		ageMs,
		stale: ageMs === null || ageMs > STALE_AFTER_MS
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function markFailure<T>(entry: CacheEntry<T>, error: unknown): void {
	entry.failures += 1;
	entry.status = entry.lastUpdated ? 'error' : 'warming';
	entry.lastError = errorMessage(error);
	const backoff = Math.min(MAX_BACKOFF_MS, 2 ** Math.min(entry.failures, 6) * 1_000);
	entry.nextAllowedRefreshAt = Date.now() + backoff;
}

function markSuccess<T>(entry: CacheEntry<T>, data: T[]): void {
	entry.data = data;
	entry.status = 'ready';
	entry.lastUpdated = Date.now();
	entry.lastError = null;
	entry.failures = 0;
	entry.nextAllowedRefreshAt = 0;
}

function filterNamespace<T extends { namespace: string }>(items: T[], namespace?: string): T[] {
	if (!namespace || namespace === 'all') return items;
	return items.filter((item) => item.namespace === namespace);
}

async function refreshEntry<T>(
	cache: Map<number, CacheEntry<T>>,
	clusterId: number,
	fetcher: () => Promise<{ success: boolean; data: T[]; error?: string }>,
	force = false
): Promise<void> {
	const entry = getEntry(cache, clusterId);
	if (entry.refreshInFlight) return entry.refreshInFlight;
	if (!force && entry.nextAllowedRefreshAt > Date.now()) return;

	entry.status = entry.lastUpdated ? entry.status : 'warming';
	entry.refreshInFlight = (async () => {
		try {
			const result = await fetcher();
			if (!result.success) throw new Error(result.error ?? 'Resource refresh failed');
			markSuccess(entry, result.data);
		} catch (error) {
			markFailure(entry, error);
			console.warn(`[ResourceCache] Refresh failed for cluster ${clusterId}: ${entry.lastError}`);
		} finally {
			entry.refreshInFlight = null;
		}
	})();

	return entry.refreshInFlight;
}

export async function refreshPodsCache(clusterId: number, force = false): Promise<void> {
	return refreshEntry(
		podsCache,
		clusterId,
		async () => {
			const result = await listPods(clusterId, 'all');
			return {
				success: result.success,
				data: result.pods ?? [],
				error: result.error
			};
		},
		force
	);
}

export async function refreshPodMetricsCache(clusterId: number, force = false): Promise<void> {
	const cluster = await findCluster(clusterId);
	const entry = getEntry(podMetricsCache, clusterId);

	if (!cluster || cluster.metricsEnabled === false) {
		entry.data = [];
		entry.status = 'disabled';
		entry.lastUpdated = Date.now();
		entry.lastError = null;
		entry.failures = 0;
		entry.nextAllowedRefreshAt = 0;
		return;
	}

	return refreshEntry(
		podMetricsCache,
		clusterId,
		async () => {
			const result = await listPodMetrics(clusterId, 'all');
			return {
				success: result.success,
				data: result.metrics ?? [],
				error: result.error
			};
		},
		force
	);
}

export async function getCachedPods(
	clusterId: number,
	namespace = 'all'
): Promise<ResourceCacheSnapshot<PodInfo>> {
	const entry = getEntry(podsCache, clusterId);
	if (!entry.lastUpdated && !entry.refreshInFlight) {
		await refreshPodsCache(clusterId, true);
	} else if (entry.refreshInFlight && !entry.lastUpdated) {
		await entry.refreshInFlight;
	}

	return {
		data: filterNamespace(entry.data, namespace),
		cache: buildMeta(entry)
	};
}

export async function getCachedPodMetrics(
	clusterId: number,
	namespace = 'all'
): Promise<ResourceCacheSnapshot<PodMetrics>> {
	const entry = getEntry(podMetricsCache, clusterId);
	if (!entry.lastUpdated && !entry.refreshInFlight) {
		await refreshPodMetricsCache(clusterId, true);
	} else if (entry.refreshInFlight && !entry.lastUpdated) {
		await entry.refreshInFlight;
	}

	return {
		data: filterNamespace(entry.data, namespace),
		cache: buildMeta(entry)
	};
}

export function invalidateClusterResourceCache(clusterId: number): void {
	podsCache.delete(clusterId);
	podMetricsCache.delete(clusterId);
}

function pruneDeletedClusters(clusters: Cluster[]): void {
	const liveIds = new Set(clusters.map((cluster) => cluster.id));
	for (const clusterId of podsCache.keys()) {
		if (!liveIds.has(clusterId)) podsCache.delete(clusterId);
	}
	for (const clusterId of podMetricsCache.keys()) {
		if (!liveIds.has(clusterId)) podMetricsCache.delete(clusterId);
	}
}

async function refreshCluster(cluster: Cluster): Promise<void> {
	if (!isCurrentVersion()) return;

	await Promise.allSettled([
		refreshPodsCache(cluster.id),
		refreshPodMetricsCache(cluster.id)
	]);
}

async function refreshAllClusters(): Promise<void> {
	if (!isCurrentVersion()) return;

	let clusters: Cluster[];
	try {
		clusters = await listClusters();
	} catch (error) {
		console.warn(`[ResourceCache] Failed to list clusters: ${errorMessage(error)}`);
		return;
	}

	pruneDeletedClusters(clusters);

	clusters.forEach((cluster, index) => {
		const timeout = setTimeout(() => {
			clusterTimeouts.delete(timeout);
			refreshCluster(cluster).catch((error) => {
				console.warn(
					`[ResourceCache] Cluster ${cluster.id} refresh failed: ${errorMessage(error)}`
				);
			});
		}, index * CLUSTER_STAGGER_MS);
		clusterTimeouts.add(timeout);
	});
}

export function startResourceCache(): void {
	if (globalThis.__resourceCacheHandle || globalThis.__resourceCacheStartupTimeout) return;

	console.log('[ResourceCache] Starting resource cache (interval: 10s)');
	globalThis.__resourceCacheStartupTimeout = setTimeout(() => {
		globalThis.__resourceCacheStartupTimeout = null;
		if (!isCurrentVersion()) return;
		refreshAllClusters();
		globalThis.__resourceCacheHandle = setInterval(() => {
			if (!isCurrentVersion()) {
				if (globalThis.__resourceCacheHandle) {
					clearInterval(globalThis.__resourceCacheHandle);
					globalThis.__resourceCacheHandle = null;
				}
				return;
			}
			refreshAllClusters();
		}, REFRESH_INTERVAL_MS);
	}, 1_000);
}

export function stopResourceCache(): void {
	if (globalThis.__resourceCacheStartupTimeout) {
		clearTimeout(globalThis.__resourceCacheStartupTimeout);
		globalThis.__resourceCacheStartupTimeout = null;
	}
	if (globalThis.__resourceCacheHandle) {
		clearInterval(globalThis.__resourceCacheHandle);
		globalThis.__resourceCacheHandle = null;
	}
	for (const timeout of clusterTimeouts) clearTimeout(timeout);
	clusterTimeouts.clear();
	console.log('[ResourceCache] Resource cache stopped');
}
