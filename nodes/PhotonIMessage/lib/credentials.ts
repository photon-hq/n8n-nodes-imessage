import type {
	IExecuteFunctions,
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { SpectrumCredentials } from './types';

const DEFAULT_HOST = 'https://spectrum.photon.codes';
const NOT_CONNECTED_HINT =
	'Photon iMessage is not connected. Enter Project ID and API Key from app.photon.codes → Settings, then Save.';

export async function getSpectrumCredentials(
	ctx: IExecuteFunctions | IHookFunctions | IWebhookFunctions,
): Promise<SpectrumCredentials> {
	const raw = await ctx.getCredentials('photonSpectrumApi');
	const apiHost = ((raw.apiHost as string) || DEFAULT_HOST).replace(/\/+$/, '');
	const projectId = ((raw.projectId as string) || '').trim();
	const projectSecret = ((raw.projectSecret as string) || '').trim();

	if (!projectId || !projectSecret) {
		throw new NodeOperationError(ctx.getNode(), NOT_CONNECTED_HINT, { level: 'warning' });
	}

	return {
		projectId,
		projectSecret,
		apiHost,
	};
}
