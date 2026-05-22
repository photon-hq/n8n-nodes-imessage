import type { IHttpRequestHelper } from 'n8n-workflow';

import { photonHttpsJson } from './photonHttp';

import type { IMessageInfoData, SpectrumEnvelope } from './spectrumTypes';

const HTTP_TIMEOUT_MS = 20_000;

async function spectrumRequest<T>(
	_helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	method: 'GET' | 'POST' | 'PATCH',
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const host = apiHost.replace(/\/+$/, '');
	const auth =
		'Basic ' + Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
	const raw = await photonHttpsJson<SpectrumEnvelope<T> | T>(
		`${host}/projects/${encodeURIComponent(projectId)}${path}`,
		{
			method,
			headers: {
				Authorization: auth,
				Accept: 'application/json',
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			body,
			timeout: HTTP_TIMEOUT_MS,
		},
	);
	if (raw && typeof raw === 'object' && 'data' in raw) {
		return (raw as SpectrumEnvelope<T>).data;
	}
	return raw as T;
}

/** Enable iMessage on the Spectrum project. */
async function enableImessagePlatform(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
): Promise<void> {
	await spectrumRequest(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'PATCH',
		'/platforms/',
		{ platform: 'imessage', enabled: true },
	);
}

/** Ensures iMessage is enabled on the Spectrum project. Line assignment is done on the dashboard. */
export async function provisionSpectrumProject(
	helper: IHttpRequestHelper,
	opts: {
		apiHost: string;
		projectId: string;
		projectSecret: string;
	},
): Promise<{ mode: 'shared' | 'dedicated' | '' }> {
	const { apiHost, projectId, projectSecret } = opts;

	await enableImessagePlatform(helper, apiHost, projectId, projectSecret);

	const info = await spectrumRequest<IMessageInfoData>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'GET',
		'/imessage/',
	);

	if (info.type === 'dedicated') return { mode: 'dedicated' };
	if (info.type === 'shared') return { mode: 'shared' };
	return { mode: '' };
}
