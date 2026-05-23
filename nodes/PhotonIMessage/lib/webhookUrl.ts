import type { INode } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function isDevTunnelWebhookUrl(webhookUrl: string): boolean {
	try {
		const { hostname } = new URL(webhookUrl);
		const host = hostname.toLowerCase();
		return (
			host.endsWith('.trycloudflare.com') ||
			host.endsWith('.ngrok-free.app') ||
			host.endsWith('.ngrok.io') ||
			host.endsWith('.ngrok-free.dev')
		);
	} catch {
		return false;
	}
}

function isPrivateIpv4Host(host: string): boolean {
	const parts = host.split('.').map((p) => Number(p));
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return false;
	}
	if (parts[0] === 127) return true;
	if (parts[0] === 10) return true;
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	if (parts[0] === 192 && parts[1] === 168) return true;
	return false;
}

export function isLocalWebhookUrl(webhookUrl: string): boolean {
	try {
		const { hostname } = new URL(webhookUrl);
		const host = hostname.toLowerCase();
		return LOCAL_HOSTS.has(host) || isPrivateIpv4Host(host);
	} catch {
		return true;
	}
}

const PUBLIC_WEBHOOK_HELP =
	'Use a public HTTPS URL so Spectrum can deliver webhooks. ' +
	'Local dev: run <code>npm run dev:tunnel</code> in this repo, then activate the workflow. ' +
	'Production: set <code>WEBHOOK_URL=https://your-domain</code> when starting n8n. ' +
	'n8n Cloud sets this automatically.';

export function assertPublicWebhookUrl(node: INode, webhookUrl: string): void {
	if (!isLocalWebhookUrl(webhookUrl)) return;

	throw new NodeApiError(node, {
		message: `Webhook URL must be public (${webhookUrl}).`,
		description: PUBLIC_WEBHOOK_HELP,
	});
}
