import type {
	IExecuteFunctions,
	IHookFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { SpectrumCredentials } from './types';

const DEFAULT_HOST = 'https://spectrum.photon.codes';
const NOT_CONNECTED_HINT =
	'Photon iMessage credential is not connected yet. Open the credential, complete browser sign-in (Save → reopen → open Sign-in link → approve → Retry), or enable "Use Project ID & Secret" and paste values from app.photon.codes.';
const PENDING_APPROVAL_HINT =
	'Browser sign-in is still pending. Open the credential (pencil icon next to "Photon iMessage account" above), confirm the approval code in your browser, then click the Retry button at the top of the credential panel. The trigger only runs after Retry finishes minting your project secret.';

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
