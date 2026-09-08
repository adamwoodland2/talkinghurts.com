// Service worker for talkinghurts.com (fleet pattern: orrery / nearest.land / c2paview).
//
//  - Code and navigations: NETWORK-FIRST with cache fallback, so a redeploy shows at once
//    and the whole app still works offline.
//  - Images: CACHE-FIRST.
//  - Cross-origin (the Hugging Face voice downloads) is deliberately not intercepted:
//    vits-web keeps downloaded voices in its own browser storage.
//  - Bump CACHE on every deploy that changes a precached file.
const CACHE = 'th-v1';
const CORE = [
	'/',
	'/index.html',
	'/style.css',
	'/app.js',
	'/favicon.svg',
	'/manifest.json',
	'/lib/vits-web.js',
	'/lib/ort.min.js',
	'/lib/piper-DeOu3H9E.js'
];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

	// The big immutable binaries (ONNX runtime wasm, espeak data - ~29 MB) are CACHE-FIRST:
	// re-downloading them on every synthesis would eat mobile data. They only change with a
	// library upgrade, which renames them or bumps CACHE.
	if (req.destination === 'image' || /^\/lib\/.+\.(wasm|data)$/.test(new URL(req.url).pathname)) {
		e.respondWith(
			caches.open(CACHE).then(async (c) => {
				const hit = await c.match(req);
				if (hit) return hit;
				const res = await fetch(req);
				if (res.ok) e.waitUntil(c.put(req, res.clone()));
				return res;
			})
		);
		return;
	}

	e.respondWith(
		fetch(req)
			.then((res) => {
				if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
				return res;
			})
			.catch(async () => {
				const hit = await caches.match(req);
				if (hit) return hit;
				if (req.mode === 'navigate') { const shell = await caches.match('/index.html'); if (shell) return shell; }
				return Response.error();
			})
	);
});
