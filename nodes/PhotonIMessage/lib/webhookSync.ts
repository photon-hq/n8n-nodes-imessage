import type { IHookFunctions } from 'n8n-workflow';

import { deleteWebhook, listWebhooks, registerWebhook } from './webhookApi';
import type { SpectrumCredentials, WebhookRegistration } from './types';
import { isDevTunnelWebhookUrl, isLocalWebhookUrl } from './webhookUrl';

export interface StoredWebhook {
	id: string;
	signingSecret: string;
	webhookUrl: string;
	lastSyncedAt?: string;
}

export function matchesNodeWebhookPath(webhookUrl: string, nodeWebhookId: string | undefined): boolean {
	if (!nodeWebhookId) return false;
	return webhookUrl.includes(`/${nodeWebhookId}/`);
}

export function shouldDeleteRemoteWebhook(
	w: { id: string; webhookUrl: string },
	webhookUrl: string,
	nodeWebhookId: string | undefined,
	keepId?: string,
): boolean {
	if (keepId && w.id === keepId && w.webhookUrl === webhookUrl) return false;
	if (w.webhookUrl === webhookUrl) return true;
	if (nodeWebhookId && matchesNodeWebhookPath(w.webhookUrl, nodeWebhookId)) return true;
	if (isLocalWebhookUrl(w.webhookUrl)) return true;
	if (isDevTunnelWebhookUrl(w.webhookUrl)) return true;
	return false;
}

export function isWebhookRegistered(
	remote: Array<{ id: string; webhookUrl: string }>,
	stored: StoredWebhook | undefined,
	webhookUrl: string,
): boolean {
	if (!stored?.id || !stored.signingSecret) return false;
	if (stored.webhookUrl !== webhookUrl) return false;

	const row = remote.find((w) => w.id === stored.id);
	if (!row || row.webhookUrl !== webhookUrl) return false;
	return true;
}

export function hasStaleRemoteWebhooks(
	remote: Array<{ id: string; webhookUrl: string }>,
	stored: StoredWebhook | undefined,
	webhookUrl: string,
	nodeWebhookId: string | undefined,
): boolean {
	return remote.some((w) => shouldDeleteRemoteWebhook(w, webhookUrl, nodeWebhookId, stored?.id));
}

export async function purgeStaleRemoteWebhooks(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
	webhookUrl: string,
	nodeWebhookId: string | undefined,
	remote: Array<{ id: string; webhookUrl: string }>,
	keepId?: string,
): Promise<void> {
	for (const w of remote) {
		if (!shouldDeleteRemoteWebhook(w, webhookUrl, nodeWebhookId, keepId)) continue;
		await deleteWebhook(ctx, creds, w.id);
	}
}

export async function syncSpectrumWebhook(
	ctx: IHookFunctions,
	creds: SpectrumCredentials,
	webhookUrl: string,
	nodeWebhookId: string | undefined,
	stored: StoredWebhook | undefined,
): Promise<StoredWebhook> {
	const remote = await listWebhooks(ctx, creds);
	await purgeStaleRemoteWebhooks(ctx, creds, webhookUrl, nodeWebhookId, remote, stored?.id);

	const fresh = await listWebhooks(ctx, creds);
	if (isWebhookRegistered(fresh, stored, webhookUrl)) {
		return {
			...stored!,
			lastSyncedAt: new Date().toISOString(),
		};
	}

	const registration: WebhookRegistration = await registerWebhook(ctx, creds, webhookUrl);
	return {
		id: registration.id,
		signingSecret: registration.signingSecret,
		webhookUrl: registration.webhookUrl || webhookUrl,
		lastSyncedAt: new Date().toISOString(),
	};
}
