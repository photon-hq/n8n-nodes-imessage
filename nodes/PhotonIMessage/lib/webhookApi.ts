import type {
	IHookFunctions,
	IHttpRequestMethods,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { photonHttpsJson } from '../../../credentials/photonHttp';
import type { SpectrumCredentials, WebhookRegistration } from './types';

const HTTP_TIMEOUT_MS = 20_000;

function basicAuth(creds: SpectrumCredentials): string {
	return (
		'Basic ' +
		Buffer.from(`${creds.projectId}:${creds.projectSecret}`).toString('base64')
	);
}

interface WebhookListEntry {
	id: string;
	webhookUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface SpectrumResponse<T> {
	succeed: boolean;
	data: T;
}

async function call<T>(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
	method: IHttpRequestMethods,
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const apiHost = (creds.apiHost || 'https://spectrum.photon.codes').replace(/\/+$/, '');
	const url = `${apiHost}${path}`;
	const headers = {
		Authorization: basicAuth(creds),
		Accept: 'application/json',
	};

	if (method === 'DELETE') {
		const response = await photonHttpsJson<{ statusCode: number; body: unknown }>(url, {
			method: 'DELETE',
			headers,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout: HTTP_TIMEOUT_MS,
		});
		if (response.statusCode === 404) {
			return undefined as T;
		}
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new NodeApiError(ctx.getNode(), {
				message: `Spectrum webhook API call failed: DELETE ${path} (${response.statusCode})`,
			});
		}
		return undefined as T;
	}

	const response = await photonHttpsJson<SpectrumResponse<T>>(url, {
		method,
		headers: {
			...headers,
			'Content-Type': 'application/json',
		},
		body,
		timeout: HTTP_TIMEOUT_MS,
	});
	if (!response?.succeed) {
		throw new NodeApiError(ctx.getNode(), {
			message: `Spectrum webhook API call failed: ${method} ${path}`,
		});
	}
	return response.data;
}

export async function registerWebhook(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
	webhookUrl: string,
): Promise<WebhookRegistration> {
	const data = await call<WebhookRegistration & { createdAt: string; updatedAt: string }>(
		ctx,
		creds,
		'POST',
		`/projects/${creds.projectId}/webhooks/`,
		{ webhookUrl },
	);
	return {
		id: data.id,
		signingSecret: data.signingSecret,
		webhookUrl: data.webhookUrl,
	};
}

export async function listWebhooks(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
): Promise<WebhookListEntry[]> {
	const data = await call<WebhookListEntry[]>(
		ctx,
		creds,
		'GET',
		`/projects/${creds.projectId}/webhooks/`,
	);
	return data ?? [];
}

export async function deleteWebhook(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
	webhookId: string,
): Promise<void> {
	try {
		await call(
			ctx,
			creds,
			'DELETE',
			`/projects/${creds.projectId}/webhooks/${encodeURIComponent(webhookId)}/`,
		);
	} catch (err) {
		const status = (err as { httpCode?: string | number; statusCode?: number }).httpCode
			?? (err as { statusCode?: number }).statusCode;
		if (status === 404 || status === '404') return;
		throw new NodeApiError(ctx.getNode(), err as JsonObject);
	}
}
