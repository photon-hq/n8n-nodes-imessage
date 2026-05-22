import type {
	IExecuteFunctions,
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { SpectrumCredentials } from './types';

const DEFAULT_HOST = 'https://spectrum.photon.codes';
const NOT_CONNECTED_HINT =
	'Photon iMessage is not connected. Open the credential → Step 1: enter iPhone number and Save → Step 2: approve sign-in link and Save again. Or use Troubleshooting → Project ID & Secret from app.photon.codes.';
const PENDING_APPROVAL_HINT =
	'Browser sign-in pending. Open the credential, approve the sign-in link in your browser, then click Save again.';

export async function getSpectrumCredentials(
	ctx: IExecuteFunctions | IHookFunctions | IWebhookFunctions,
): Promise<SpectrumCredentials> {
	const raw = await ctx.getCredentials('photonSpectrumApi');
	const apiHost = ((raw.apiHost as string) || DEFAULT_HOST).replace(/\/+$/, '');
	const projectId = ((raw.projectId as string) || '').trim();
	const projectSecret = ((raw.projectSecret as string) || '').trim();
	const connectionState = (raw.connectionState as string) || '';
	const deviceCode = ((raw.deviceCode as string) || '').trim();

	if (!projectId || !projectSecret) {
		const pending = connectionState === 'pending' || !!deviceCode;
		throw new NodeOperationError(
			ctx.getNode(),
			pending ? PENDING_APPROVAL_HINT : NOT_CONNECTED_HINT,
			{ level: 'warning' },
		);
	}

	return {
		projectId,
		projectSecret,
		apiHost,
	};
}
