import type {
	IExecuteFunctions,
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import type { SpectrumCredentials } from './types';

const DEFAULT_HOST = 'https://spectrum.photon.codes';

export async function getSpectrumCredentials(
	ctx: IExecuteFunctions | IHookFunctions | IWebhookFunctions,
): Promise<SpectrumCredentials> {
	const raw = await ctx.getCredentials('photonSpectrumApi');
	const apiHost = ((raw.apiHost as string) || DEFAULT_HOST).replace(/\/+$/, '');
	const inboundFirst =
		(raw.inboundFirst as 'strict' | 'off' | undefined) ?? 'strict';
	return {
		projectId: raw.projectId as string,
		projectSecret: raw.projectSecret as string,
		apiHost,
		inboundFirst,
		preApproved: (raw.preApproved as string) || '',
	};
}
