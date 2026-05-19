import type { IHookFunctions, IHttpRequestMethods } from 'n8n-workflow';
import type { SpectrumCredentials, WebhookRegistration } from './types';

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
	const response = (await ctx.helpers.httpRequest({
		method,
		url: `${apiHost}${path}`,
		headers: {
			Authorization: basicAuth(creds),
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body,
		json: true,
	})) as SpectrumResponse<T>;
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
			`/projects/${creds.projectId}/webhooks/${encodeURIComponent(webhookId)}`,
		);
	} catch (err) {
		// 404 is fine — webhook already gone.
		const status = (err as { httpCode?: string | number; statusCode?: number }).httpCode
			?? (err as { statusCode?: number }).statusCode;
		if (status === 404 || status === '404') return;
		throw err;
	}
}
