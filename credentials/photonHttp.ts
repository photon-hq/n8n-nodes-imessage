/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import dns from 'node:dns/promises';
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 20_000;

export interface PhotonRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
	returnFullResponse?: boolean;
	ignoreHttpStatusErrors?: boolean;
}

export interface PhotonFetchResponse {
	ok: boolean;
	status: number;
	statusText: string;
	json(): Promise<unknown>;
	text(): Promise<string>;
}

function headersToRecord(headers?: Record<string, string> | [string, string][] | Headers): Record<string, string> {
	if (!headers) return {};
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	if (Array.isArray(headers)) {
		return Object.fromEntries(headers);
	}
	return { ...headers };
}

function bodyToPayload(
	body: string | URLSearchParams | null | undefined,
	method: string,
): string | undefined {
	if (body === undefined || body === null) return undefined;
	if (method === 'GET' || method === 'HEAD') return undefined;
	if (typeof body === 'string') return body;
	if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
	return JSON.stringify(body);
}

/** HTTPS JSON via explicit IPv4 lookup (avoids broken IPv6 routes). */
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
			? typeof options.body === 'string'
				? options.body
				: JSON.stringify(options.body)
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
				port: url.port ? Number(url.port) : undefined,
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
						reject(
							Object.assign(new Error(`${status} - ${JSON.stringify(parsed)}`), {
								statusCode: status,
								body: parsed,
							}),
						);
						return;
					}
					if (options.returnFullResponse) {
						resolve({ statusCode: status, body: parsed, statusText: res.statusMessage ?? '' } as T);
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

/** fetch()-compatible helper that always resolves the host to IPv4. */
export async function photonFetch(
	urlString: string,
	init: {
		method?: string;
		headers?: Record<string, string> | [string, string][] | Headers;
		body?: string | URLSearchParams;
	} = {},
): Promise<PhotonFetchResponse> {
	const method = (init.method ?? 'GET').toUpperCase();
	const payload = bodyToPayload(init.body, method);
	const result = await photonHttpsJson<{ statusCode: number; body: unknown; statusText: string }>(
		urlString,
		{
			method,
			headers: headersToRecord(init.headers),
			body: payload,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
			timeout: DEFAULT_TIMEOUT_MS,
		},
	);
	const status = result.statusCode;
	let cachedText: string | undefined;
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: result.statusText || (status >= 200 && status < 300 ? 'OK' : 'Error'),
		text: async () => {
			if (cachedText === undefined) {
				cachedText =
					result.body === undefined || result.body === null
						? ''
						: typeof result.body === 'string'
							? result.body
							: JSON.stringify(result.body);
			}
			return cachedText;
		},
		json: async () => result.body,
	};
}

let ipv4FetchInstalled = false;

/** Route spectrum-ts (and any other fetch callers) through IPv4-only HTTPS. */
export function installPhotonIpv4Fetch(): void {
	if (ipv4FetchInstalled) return;
	// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
	globalThis.fetch = photonFetch as typeof fetch;
	ipv4FetchInstalled = true;
}
