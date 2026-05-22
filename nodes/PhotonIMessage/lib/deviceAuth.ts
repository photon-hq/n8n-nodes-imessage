// Spectrum OAuth2 device-authorization flow + dashboard API client.
// Refs: https://docs.photon.codes/cli/authentication (device flow),
//       photon-hq/codex `lib/spectrum.ts` (regenerate-secret pattern).

import { photonFetch, photonHttpsJson } from '../../../credentials/photonHttp';

export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	interval: number;
	expires_in: number;
}

export interface DeviceTokenSuccess {
	access_token: string;
	token_type: string;
	expires_in?: number;
	refresh_token?: string;
	scope?: string;
}

export type DeviceTokenErrorCode =
	| 'authorization_pending'
	| 'slow_down'
	| 'access_denied'
	| 'expired_token'
	| 'invalid_request'
	| 'invalid_client'
	| 'invalid_grant'
	| 'unsupported_grant_type';

export type DeviceTokenResult =
	| { ok: true; token: DeviceTokenSuccess }
	| { ok: false; error: DeviceTokenErrorCode; status: number; description?: string };

export interface ProjectSummary {
	id: string;
	name?: string;
	spectrum?: boolean;
	[k: string]: unknown;
}

export class DeviceAuthError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: unknown,
	) {
		super(message);
		this.name = 'DeviceAuthError';
	}
}

const DEFAULT_DASHBOARD = 'https://app.photon.codes';
const DEFAULT_CLIENT_ID = 'photon-cli';
const DEFAULT_SCOPE = 'openid profile email';

function normalizeHost(host?: string): string {
	return (host || DEFAULT_DASHBOARD).replace(/\/+$/, '');
}

function errorHint(body: unknown): string {
	if (!body || typeof body !== 'object') return '';
	const b = body as Record<string, unknown>;
	const desc = typeof b.error_description === 'string' ? b.error_description : null;
	const code = typeof b.error === 'string' ? b.error : null;
	return desc ?? code ?? '';
}

export async function startDeviceFlow(opts: {
	dashboardHost?: string;
	clientId?: string;
	scope?: string;
}): Promise<DeviceCodeResponse> {
	const body = await photonHttpsJson<DeviceCodeResponse>(
		`${normalizeHost(opts.dashboardHost)}/api/auth/device/code`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: {
				client_id: opts.clientId || DEFAULT_CLIENT_ID,
				scope: opts.scope || DEFAULT_SCOPE,
			},
		},
	);
	return body;
}

export async function pollDeviceToken(opts: {
	dashboardHost?: string;
	clientId?: string;
	deviceCode: string;
}): Promise<DeviceTokenResult> {
	const res = await photonFetch(`${normalizeHost(opts.dashboardHost)}/api/auth/device/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: opts.deviceCode,
			client_id: opts.clientId || DEFAULT_CLIENT_ID,
		}),
	});
	const body = await res.json();
	if (res.ok && body && typeof body === 'object' && 'access_token' in body) {
		return { ok: true, token: body as DeviceTokenSuccess };
	}
	const err =
		body && typeof body === 'object' && 'error' in body
			? ((body as { error: DeviceTokenErrorCode }).error ?? 'invalid_request')
			: 'invalid_request';
	const description =
		body && typeof body === 'object' && 'error_description' in body
			? (body as { error_description?: string }).error_description
			: undefined;
	return { ok: false, error: err as DeviceTokenErrorCode, status: res.status, description };
}

async function bearerGet<T>(host: string, path: string, bearer: string, context: string): Promise<T> {
	try {
		return await photonHttpsJson<T>(`${normalizeHost(host)}${path}`, {
			headers: { authorization: `Bearer ${bearer}` },
		});
	} catch (err) {
		const status = (err as { statusCode?: number }).statusCode ?? 0;
		const body = (err as { body?: unknown }).body ?? null;
		// CLI layer — no n8n node context for NodeApiError here.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new DeviceAuthError(
			`${context} failed: ${status}${errorHint(body) ? ` — ${errorHint(body)}` : ''}`,
			status,
			body,
		);
	}
}

async function bearerPost<T>(
	host: string,
	path: string,
	bearer: string,
	body: unknown,
	context: string,
): Promise<T> {
	try {
		return await photonHttpsJson<T>(`${normalizeHost(host)}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${bearer}`,
			},
			body,
		});
	} catch (err) {
		const status = (err as { statusCode?: number }).statusCode ?? 0;
		const errBody = (err as { body?: unknown }).body ?? null;
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new DeviceAuthError(
			`${context} failed: ${status}${errorHint(errBody) ? ` — ${errorHint(errBody)}` : ''}`,
			status,
			errBody,
		);
	}
}

export async function getSession(
	bearer: string,
	dashboardHost?: string,
): Promise<{ user: { id: string; email?: string; name?: string } } | null> {
	try {
		const body = await bearerGet<{
			user?: { id?: string; email?: string; name?: string };
			session?: { userId?: string; id?: string };
		}>(dashboardHost ?? DEFAULT_DASHBOARD, '/api/auth/get-session', bearer, 'get-session');
		const rawUser = body?.user;
		if (!rawUser) return null;
		const id =
			rawUser.id ||
			body?.session?.userId ||
			body?.session?.id;
		if (!id) return null;
		return { user: { id, email: rawUser.email, name: rawUser.name } };
	} catch (err) {
		if (err instanceof DeviceAuthError && err.status === 401) return null;
		const message = err instanceof Error ? err.message : String(err);
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new DeviceAuthError(message, 0, null);
	}
}

export async function listProjects(
	bearer: string,
	dashboardHost?: string,
): Promise<ProjectSummary[]> {
	const body = await bearerGet<ProjectSummary[] | { projects?: ProjectSummary[]; data?: ProjectSummary[] }>(
		dashboardHost ?? DEFAULT_DASHBOARD,
		'/api/projects',
		bearer,
		'list-projects',
	);
	if (Array.isArray(body)) return body;
	if (body && typeof body === 'object') {
		if (Array.isArray(body.projects)) return body.projects;
		if (Array.isArray(body.data)) return body.data;
	}
	return [];
}

export async function createProject(
	bearer: string,
	input: { name: string; location?: string; spectrum?: boolean },
	dashboardHost?: string,
): Promise<{ id: string }> {
	const body = await bearerPost<{ id?: string }>(
		dashboardHost ?? DEFAULT_DASHBOARD,
		'/api/projects',
		bearer,
		{
			name: input.name,
			location: input.location ?? 'United States',
			spectrum: input.spectrum ?? true,
			template: false,
			observability: false,
		},
		'create-project',
	);
	if (!body?.id) {
		throw new DeviceAuthError('create-project returned no id', 500, body);
	}
	return { id: body.id };
}

export async function regenerateProjectSecret(
	bearer: string,
	projectId: string,
	dashboardHost?: string,
): Promise<{ projectSecret: string }> {
	const body = await bearerPost<{ projectSecret?: string }>(
		dashboardHost ?? DEFAULT_DASHBOARD,
		`/api/projects/${encodeURIComponent(projectId)}/regenerate-secret`,
		bearer,
		undefined,
		'regenerate-secret',
	);
	if (!body?.projectSecret) {
		throw new DeviceAuthError('regenerate-secret returned no projectSecret', 500, body);
	}
	return { projectSecret: body.projectSecret };
}

export async function togglePlatform(
	bearer: string,
	projectId: string,
	platformId: 'imessage' | 'whatsapp_business',
	enabled: boolean,
	dashboardHost?: string,
): Promise<void> {
	await bearerPost(
		dashboardHost ?? DEFAULT_DASHBOARD,
		`/api/projects/${encodeURIComponent(projectId)}/platforms/toggle`,
		bearer,
		{ platformId, enabled },
		`toggle-platform(${platformId}, ${enabled})`,
	);
}
