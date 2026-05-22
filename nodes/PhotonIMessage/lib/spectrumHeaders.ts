export function getSpectrumHeader(
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | undefined {
	const lower = name.toLowerCase();
	const direct = headers[lower] ?? headers[name];
	if (Array.isArray(direct)) return direct[0];
	return direct;
}

export function isDevTunnelWebhookUrl(webhookUrl: string): boolean {
	try {
		const { hostname } = new URL(webhookUrl);
		const host = hostname.toLowerCase();
		return (
			host === 'localhost' ||
			host.endsWith('.trycloudflare.com') ||
			host.endsWith('.ngrok-free.app') ||
			host.endsWith('.ngrok.io') ||
			host.endsWith('.ngrok-free.dev')
		);
	} catch {
		return false;
	}
}
