import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	INodeProperties,
} from 'n8n-workflow';

import { buildLineStatus, lineInfoFields } from './imessageLines';
import { isAuthError } from './httpErrors';
import { provisionSpectrumProject } from './spectrumProvision';

const DEFAULT_RUNTIME = 'https://spectrum.photon.codes';
const DEFAULT_DASHBOARD = 'https://app.photon.codes';
const CREDENTIAL_TEST_URL = `${DEFAULT_DASHBOARD}/api/auth/ok`;

function timeoutAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
		setTimeout(() => reject(new Error(message)), ms);
	});
}

function trimHost(host: unknown, fallback: string): string {
	const raw = (typeof host === 'string' && host) || fallback;
	return raw.replace(/\/+$/, '');
}

function isRedactedSecret(value: unknown): boolean {
	return typeof value === 'string' && value.startsWith('*****');
}

function looksLikeSpectrumSecret(value: string): boolean {
	return value.length >= 24 && /^[A-Za-z0-9_-]+$/.test(value);
}

function withConnectionState(
	data: IDataObject,
	state: 'setup' | 'connected',
): IDataObject {
	return { ...data, connectionState: state };
}

export class PhotonSpectrumApi implements ICredentialType {
	name = 'photonSpectrumApi';
	displayName = 'Photon iMessage API';
	icon = {
		light: 'file:../nodes/PhotonIMessage/Dark.svg',
		dark: 'file:../nodes/PhotonIMessage/Dark.svg',
	} as const;
	documentationUrl = 'https://docs.photon.codes/spectrum-ts/providers/imessage';

	properties: INodeProperties[] = [
		{ displayName: 'Connection State', name: 'connectionState', type: 'hidden', default: 'setup' },

		{
			displayName:
				'Enter <b>Project ID</b> and <b>API Key</b> from <a href="https://app.photon.codes" target="_blank">app.photon.codes</a> → your project → <b>Settings</b>, then click <b>Save</b>.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: { connectionState: ['setup'] },
			},
		},
		{
			displayName: 'Project ID',
			name: 'projectId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'From app.photon.codes → Settings',
		},
		{
			displayName: 'API Key',
			name: 'projectSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Project API key from app.photon.codes → Settings (shown as Project Secret on the dashboard).',
			placeholder: 'From app.photon.codes → Settings',
		},
		{
			displayName:
				'<b>Connected.</b> Add <b>iMessage by Photon Trigger</b> to a workflow and toggle it <b>Active</b>. Manage lines and contacts on app.photon.codes.',
			name: 'connectedNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					projectId: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Your iMessage Line',
			name: 'primaryLineNumber',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			description: 'First line on this project (read-only). Add or assign lines on app.photon.codes.',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					primaryLineNumber: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Project lines',
			name: 'imessageLines',
			type: 'string',
			default: '',
			typeOptions: { editable: false, rows: 4 },
			description: 'Lines loaded from Spectrum. Update users and assignments on app.photon.codes.',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					imessageLines: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Line status',
			name: 'lineStatus',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			displayOptions: {
				show: {
					connectionState: ['connected'],
					lineStatus: [{ _cnd: { not: '' } }],
					primaryLineNumber: [''],
				},
			},
		},
		{ displayName: 'Line mode key', name: 'lineMode', type: 'hidden', default: '' },
		{ displayName: 'Line mode label', name: 'lineModeLabel', type: 'hidden', default: '' },
		{ displayName: 'Line numbers JSON', name: 'lineNumbersJson', type: 'hidden', default: '[]' },
		{ displayName: 'Line count', name: 'lineCount', type: 'hidden', default: 0 },
		{ displayName: 'Spectrum Runtime URL', name: 'apiHost', type: 'hidden', default: DEFAULT_RUNTIME },
		{ displayName: 'Dashboard URL', name: 'dashboardHost', type: 'hidden', default: DEFAULT_DASHBOARD },
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		try {
			return await runPreAuthentication(this, credentials);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const projectId = ((credentials.projectId as string) || '').trim();
			const projectSecret = ((credentials.projectSecret as string) || '').trim();
			return withConnectionState(
				{
					projectId,
					projectSecret,
					lineStatus: message,
				},
				'setup',
			);
		}
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.projectSecret ? "Basic " + Buffer.from($credentials.projectId + ":" + $credentials.projectSecret).toString("base64") : "" }}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			url: CREDENTIAL_TEST_URL,
			method: 'GET',
		},
	};
}

async function runPreAuthentication(
	helper: IHttpRequestHelper,
	credentials: ICredentialDataDecryptedObject,
): Promise<IDataObject> {
	const projectId = ((credentials.projectId as string) || '').trim();
	const projectSecretRaw = ((credentials.projectSecret as string) || '').trim();
	const connectionState = (credentials.connectionState as string) || '';
	const projectSecret = isRedactedSecret(projectSecretRaw) ? '' : projectSecretRaw;

	if (
		!projectId ||
		(!projectSecret && !(isRedactedSecret(projectSecretRaw) && connectionState === 'connected'))
	) {
		return withConnectionState({ projectId, projectSecret: projectSecretRaw }, 'setup');
	}

	if (!projectSecret && isRedactedSecret(projectSecretRaw)) {
		return withConnectionState(
			{
				projectId,
				projectSecret: projectSecretRaw,
				lineMode: credentials.lineMode,
				lineModeLabel: credentials.lineModeLabel,
				imessageLines: credentials.imessageLines,
				primaryLineNumber: credentials.primaryLineNumber,
				lineStatus: credentials.lineStatus,
				lineNumbersJson: credentials.lineNumbersJson,
				lineCount: credentials.lineCount,
			},
			'connected',
		);
	}

	if (!looksLikeSpectrumSecret(projectSecret)) {
		throw new Error(
			'API Key looks invalid. Copy it again from app.photon.codes → Settings.',
		);
	}

	const apiHost = trimHost(credentials.apiHost, DEFAULT_RUNTIME);
	const base: IDataObject = {
		projectId,
		projectSecret,
	};

	try {
		await Promise.race([
			provisionSpectrumProject(helper, {
				apiHost,
				projectId,
				projectSecret,
			}),
			timeoutAfter(15_000, 'provision timeout'),
		]);
	} catch (err) {
		if (isAuthError(err)) {
			throw new Error(
				'Invalid Project ID or API Key. Check values at app.photon.codes → Settings.',
			);
		}
	}

	try {
		const lines = await Promise.race([
			lineInfoFields(helper, apiHost, projectId, projectSecret),
			timeoutAfter(10_000, 'line-enrich timeout'),
		]);
		base.lineMode = lines.lineMode;
		base.lineModeLabel = lines.lineModeLabel;
		base.imessageLines = lines.imessageLines;
		base.primaryLineNumber = lines.primaryLineNumber;
		base.lineNumbersJson = lines.lineNumbersJson;
		base.lineCount = lines.lineCount;
		base.lineStatus = buildLineStatus(lines);
	} catch (err) {
		if (isAuthError(err)) {
			throw new Error(
				'Invalid Project ID or API Key. Check values at app.photon.codes → Settings.',
			);
		}
		base.lineStatus =
			'Connected, but line details could not be loaded. Save again to refresh.';
	}

	return withConnectionState(base, 'connected');
}
