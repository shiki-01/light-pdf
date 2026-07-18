/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// 2 回目以降はネットワークなしで利用可能にする（要件 4.3）
const sw = self as unknown as ServiceWorkerGlobalScope;

import { build, files, prerendered, version } from '$service-worker';

const CACHE = `light-pdf-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})
	);
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// ビルド済みアセットはキャッシュ優先
			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}
			// それ以外はネットワーク優先、失敗時にキャッシュへフォールバック
			try {
				const response = await fetch(event.request);
				if (response.ok) cache.put(event.request, response.clone());
				return response;
			} catch {
				const cached = await cache.match(event.request);
				if (cached) return cached;
				const index = await cache.match('/');
				if (index) return index;
				throw new Error('offline');
			}
		})()
	);
});
