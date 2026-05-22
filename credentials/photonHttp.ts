/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import dns from 'node:dns/promises';
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 20_000;

interface PhotonRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
	returnFullResponse?: boolean;
	ignoreHttpStatusErrors?: boolean;
}

/** HTTPS JSON via IPv4 (avoids broken IPv6 paths to Cloudflare on some networks). */
export async function photonHttpsJson<T>(
	urlString: string,
	options: PhotonRequestOptions = {},
): Promise<T> {
	const url = new URL(urlString);
	const { address } = await dns.lookup(url.hostname, { family: 4 });
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
	const method = (options.method ?? 'GET').toUpperCase();
	const payload =
		options.body !== undefined && method !== 'GET' && method !== 'HEAD'
			? JSON.stringify(options.body)
			: undefined;

	const headers: Record<string, string> = {
		host: url.hostname,
		accept: 'application/json',
		...options.headers,
	};
	if (payload) {
		headers['content-type'] ??= 'application/json';
		headers['content-length'] = String(Buffer.byteLength(payload));
	}

	return await new Promise<T>((resolve, reject) => {
		const req = https.request(
			{
				host: address,
				servername: url.hostname,
				path: url.pathname + url.search,
				method,
				headers,
				timeout,
			},
			(res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					let parsed: unknown = {};
					if (data) {
						try {
							parsed = JSON.parse(data);
						} catch {
							reject(new Error(`Invalid JSON response from ${url.hostname}`));
							return;
						}
					}
					const status = res.statusCode ?? 0;
					if (
						!options.ignoreHttpStatusErrors &&
						(status < 200 || status >= 300)
					) {
						reject(new Error(`${status} - ${JSON.stringify(parsed)}`));
						return;
					}
					if (options.returnFullResponse) {
						resolve({ statusCode: status, body: parsed } as T);
						return;
					}
					resolve(parsed as T);
				});
			},
		);
		req.on('timeout', () => {
			req.destroy(new Error(`timeout of ${timeout}ms exceeded`));
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}
