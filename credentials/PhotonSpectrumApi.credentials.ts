import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

// `photon-cli` is the only client id currently allowlisted by Spectrum's
// device-flow endpoint. Override via the "OAuth Client ID" field if needed.
const DEFAULT_CLIENT_ID = 'photon-cli';
const DEFAULT_DASHBOARD = 'https://app.photon.codes';
const DEFAULT_RUNTIME = 'https://spectrum.photon.codes';
const DEFAULT_SCOPE = 'openid profile email';

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	interval: number;
	expires_in: number;
}

interface DeviceTokenSuccess {
	access_token: string;
	expires_in?: number;
}

interface DeviceTokenError {
	error: string;
	error_description?: string;
}

interface ProjectSummary {
	id: string;
	name?: string;
	spectrum?: boolean;
}

function trimHost(host: unknown, fallback: string): string {
	const raw = (typeof host === 'string' && host) || fallback;
	return raw.replace(/\/+$/, '');
}

export class PhotonSpectrumApi implements ICredentialType {
	name = 'photonSpectrumApi';
	displayName = 'iMessage by Photon (Spectrum) API';
	icon = {
		light: 'file:../nodes/PhotonIMessage/Dark.svg',
		dark: 'file:../nodes/PhotonIMessage/Dark.svg',
	} as const;
	documentationUrl = 'https://docs.photon.codes/spectrum-ts/providers/imessage';

	properties: INodeProperties[] = [
		{
			displayName:
				'<b>Sign in with your browser</b> — leave the fields below blank and click <b>Save</b>. An approval link appears here; open it, sign in to Photon, and click Save again. Done.<br><br>Already have credentials? Paste your <b>Project ID</b> and <b>Project Secret</b> from <a href="https://app.photon.codes" target="_blank">app.photon.codes</a> and click Save. Prefer the terminal? Run <code>npx n8n-nodes-imessage login</code>.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		{
			// displayOptions hides this when no approval is pending; the
			// expression in displayName is a fallback for n8n versions that
			// don't evaluate _cnd on hidden-field triggers.
			displayName:
				'={{ $credentials.verificationUrl ? "<b>One more step</b> — <a href=\\"" + $credentials.verificationUrl + "\\" target=\\"_blank\\">open this approval link</a>, sign in to Photon, then click <b>Save</b> again. The code shown on the approval page should match <code>" + $credentials.userCode + "</code>." : "" }}',
			name: 'pendingApprovalNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					verificationUrl: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Project ID',
			name: 'projectId',
			type: 'string',
			default: '',
			placeholder: 'leave blank to auto-fill',
			description:
				'Filled automatically when you sign in with the browser. Set this manually only if you own multiple Photon projects and want this credential bound to a specific one.',
		},
		{
			displayName: 'Project Secret',
			name: 'projectSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'leave blank to mint via browser login',
			description:
				'Minted automatically when you sign in with the browser. Paste manually only if you already have a secret from the Photon dashboard.',
		},
		{
			displayName: 'Spectrum Runtime URL',
			name: 'apiHost',
			type: 'string',
			default: DEFAULT_RUNTIME,
			placeholder: DEFAULT_RUNTIME,
			description:
				'Spectrum cloud backend. Leave default unless you are targeting staging or a self-hosted runtime. No trailing slash.',
		},
		{
			displayName: 'Inbound-First Policy',
			name: 'inboundFirst',
			type: 'options',
			options: [
				{
					name: 'Strict (Recommended)',
					value: 'strict',
					description:
						'Only allow sending to contacts who have messaged you first. Best deliverability; avoids "Report Junk" banner.',
				},
				{
					name: 'Off',
					value: 'off',
					description:
						'Allow outbound to anyone. Read iMessage Deliverability docs before enabling — Apple may flag your line.',
				},
			],
			default: 'strict',
			description:
				'How aggressively to enforce inbound-first messaging. Strict is strongly recommended per Photon deliverability guidance.',
		},
		{
			displayName: 'Pre-Approved Recipients',
			name: 'preApproved',
			type: 'string',
			default: '',
			placeholder: '+15551234567, hello@example.com',
			description:
				'Comma-separated phone numbers (E.164) or emails that bypass the inbound-first check. Useful for bootstrapping existing contacts.',
		},
		{
			displayName:
				'<i>Advanced — only change these for staging or self-hosted Photon deployments.</i>',
			name: 'advancedSection',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Dashboard URL',
			name: 'dashboardHost',
			type: 'string',
			default: DEFAULT_DASHBOARD,
			description: 'Photon dashboard URL used for browser login.',
		},
		{
			displayName: 'OAuth Client ID',
			name: 'clientId',
			type: 'string',
			default: DEFAULT_CLIENT_ID,
			description:
				'OAuth client id for the device flow. The default is registered with Photon for this package.',
		},
		{
			displayName: 'Bearer Token',
			name: 'bearerToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
		{
			displayName: 'Device Code',
			name: 'deviceCode',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Device Code Expires At',
			name: 'deviceCodeExpiresAt',
			type: 'hidden',
			default: 0,
		},
		{
			displayName: 'Verification URL',
			name: 'verificationUrl',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'User Code',
			name: 'userCode',
			type: 'hidden',
			default: '',
		},
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const dashboardHost = trimHost(credentials.dashboardHost, DEFAULT_DASHBOARD);
		const clientId = (credentials.clientId as string) || DEFAULT_CLIENT_ID;
		const projectIdInput = ((credentials.projectId as string) || '').trim();
		const projectSecretInput = ((credentials.projectSecret as string) || '').trim();
		const bearer = ((credentials.bearerToken as string) || '').trim();

		// Manual paste. `bearerToken: 'manual'` satisfies n8n's expirable-field
		// persistence rule (otherwise the returned object is discarded).
		if (projectIdInput && projectSecretInput) {
			return {
				projectId: projectIdInput,
				projectSecret: projectSecretInput,
				bearerToken: 'manual',
				deviceCode: '',
				deviceCodeExpiresAt: 0,
				verificationUrl: '',
				userCode: '',
			};
		}

		// Cached bearer — rotate to a fresh secret. On 401/403 the bearer is
		// dead; fall through and start a new device flow.
		if (bearer && bearer !== 'manual') {
			try {
				const { projectId, projectSecret } = await mintFromBearer(this, {
					bearer,
					dashboardHost,
					projectIdInput,
				});
				return {
					bearerToken: bearer,
					projectId,
					projectSecret,
					deviceCode: '',
					deviceCodeExpiresAt: 0,
					verificationUrl: '',
					userCode: '',
				};
			} catch (err) {
				const status = (err as { httpCode?: number; statusCode?: number }).httpCode
					?? (err as { statusCode?: number }).statusCode;
				if (status !== 401 && status !== 403) throw err;
			}
		}

		const deviceCode = ((credentials.deviceCode as string) || '').trim();
		const expiresAt = Number(credentials.deviceCodeExpiresAt ?? 0);
		if (deviceCode && expiresAt > Date.now()) {
			const polled = await pollDeviceToken(this, dashboardHost, clientId, deviceCode);
			if (polled.ok) {
				const newBearer = polled.access_token;
				const { projectId, projectSecret } = await mintFromBearer(this, {
					bearer: newBearer,
					dashboardHost,
					projectIdInput,
				});
				return {
					bearerToken: newBearer,
					projectId,
					projectSecret,
					deviceCode: '',
					deviceCodeExpiresAt: 0,
					verificationUrl: '',
					userCode: '',
				};
			}
			if (polled.error === 'authorization_pending' || polled.error === 'slow_down') {
				return {
					bearerToken: '',
					deviceCode,
					deviceCodeExpiresAt: expiresAt,
					verificationUrl: (credentials.verificationUrl as string) || '',
					userCode: (credentials.userCode as string) || '',
				};
			}
			// access_denied / expired_token / etc — start a fresh flow below.
		}

		const code = await startDeviceFlow(this, dashboardHost, clientId);
		const verifyUrl = code.verification_uri_complete || code.verification_uri;
		return {
			bearerToken: '',
			deviceCode: code.device_code,
			deviceCodeExpiresAt: Date.now() + code.expires_in * 1000,
			verificationUrl: verifyUrl,
			userCode: code.user_code,
		};
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ "Basic " + Buffer.from($credentials.projectId + ":" + $credentials.projectSecret).toString("base64") }}',
			},
		},
	};

	// Mid-handshake there's no projectSecret to authenticate with, so route
	// the test to a dashboard health probe (always 200) for a clean Save.
	// Once a secret is minted, the real Spectrum endpoint is checked.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ $credentials.projectSecret ? $credentials.apiHost : $credentials.dashboardHost }}',
			url:
				"={{ $credentials.projectSecret ? '/projects/' + $credentials.projectId + '/imessage' : '/api/auth/ok' }}",
			method: 'GET',
		},
	};
}

async function httpJson<T>(
	helper: IHttpRequestHelper,
	options: IHttpRequestOptions,
): Promise<T> {
	const response = (await helper.helpers.httpRequest({
		...options,
		json: true,
		returnFullResponse: false,
	} as IHttpRequestOptions)) as T;
	return response;
}

async function startDeviceFlow(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	clientId: string,
): Promise<DeviceCodeResponse> {
	return httpJson<DeviceCodeResponse>(helper, {
		method: 'POST',
		url: `${dashboardHost}/api/auth/device/code`,
		headers: { 'content-type': 'application/json' },
		body: { client_id: clientId, scope: DEFAULT_SCOPE },
	});
}

async function pollDeviceToken(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	clientId: string,
	deviceCode: string,
): Promise<{ ok: true; access_token: string } | { ok: false; error: string }> {
	const response = (await helper.helpers.httpRequest({
		method: 'POST',
		url: `${dashboardHost}/api/auth/device/token`,
		headers: { 'content-type': 'application/json' },
		body: {
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: deviceCode,
			client_id: clientId,
		},
		json: true,
		returnFullResponse: true,
		// authorization_pending is returned as a 400 — don't throw.
		ignoreHttpStatusErrors: true,
	} as IHttpRequestOptions)) as {
		statusCode: number;
		body: DeviceTokenSuccess | DeviceTokenError;
	};

	const body = response.body;
	if ('access_token' in body && body.access_token) {
		return { ok: true, access_token: body.access_token };
	}
	const err =
		('error' in body && body.error) || 'invalid_request';
	return { ok: false, error: err };
}

async function listProjects(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	bearer: string,
): Promise<ProjectSummary[]> {
	const body = (await helper.helpers.httpRequest({
		method: 'GET',
		url: `${dashboardHost}/api/projects`,
		headers: { authorization: `Bearer ${bearer}` },
		json: true,
	} as IHttpRequestOptions)) as ProjectSummary[] | { projects?: ProjectSummary[]; data?: ProjectSummary[] };
	if (Array.isArray(body)) return body;
	return body.projects ?? body.data ?? [];
}

async function regenerateSecret(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	bearer: string,
	projectId: string,
): Promise<string> {
	const body = (await helper.helpers.httpRequest({
		method: 'POST',
		url: `${dashboardHost}/api/projects/${encodeURIComponent(projectId)}/regenerate-secret`,
		headers: { authorization: `Bearer ${bearer}` },
		json: true,
	} as IHttpRequestOptions)) as { projectSecret?: string };
	if (!body?.projectSecret) {
		throw new Error('Spectrum did not return a projectSecret on rotation.');
	}
	return body.projectSecret;
}

async function mintFromBearer(
	helper: IHttpRequestHelper,
	args: { bearer: string; dashboardHost: string; projectIdInput: string },
): Promise<{ projectId: string; projectSecret: string }> {
	const { bearer, dashboardHost, projectIdInput } = args;

	let projectId = projectIdInput;
	if (!projectId) {
		const projects = await listProjects(helper, dashboardHost, bearer);
		if (projects.length === 0) {
			throw new Error(
				'Your Photon account has no projects. Create one at https://app.photon.codes, then click Save again.',
			);
		}
		if (projects.length === 1) {
			projectId = projects[0].id;
		} else {
			const list = projects
				.map((p) => `${p.id}${p.name ? ` (${p.name})` : ''}`)
				.join(', ');
			throw new Error(
				`Multiple Photon projects found: ${list}. Set Project ID to one of them and click Save again.`,
			);
		}
	}

	const projectSecret = await regenerateSecret(helper, dashboardHost, bearer, projectId);
	return { projectId, projectSecret };
}
