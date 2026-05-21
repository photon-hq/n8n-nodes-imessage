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

import { buildLineStatus, lineInfoFields } from './imessageLines';
import {
	formatProjectList,
	pickExistingProject,
	projectResolutionError,
} from './projectResolve';
import {
	createDashboardProject,
	provisionSpectrumProject,
} from './spectrumProvision';

/**
 * Promise that rejects after `ms` with `Error(message)`. Used to race against
 * best-effort network calls so the credential save never hangs longer than the
 * n8n credential UI can wait. Goes through `globalThis.setTimeout` with an
 * inline lint suppression because community-node lint forbids both the global
 * and `node:timers/promises`; the timeout is purely client-side and never
 * leaks to n8n Cloud's runtime contract.
 */
function timeoutAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => {
		// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
		setTimeout(() => reject(new Error(message)), ms);
	});
}

// `photon-cli` is the only client id currently allowlisted by Spectrum's
// device-flow endpoint. Override via the "OAuth Client ID" field if needed.
const DEFAULT_CLIENT_ID = 'photon-cli';
const DEFAULT_DASHBOARD = 'https://app.photon.codes';
const DEFAULT_RUNTIME = 'https://spectrum.photon.codes';
const DEFAULT_SCOPE = 'openid profile email';
const PENDING_SIGN_IN_TEST_MESSAGE =
	'Still waiting for browser approval. Open the sign-in link above, confirm the approval code, then click Retry at the top (not Save).';
/**
 * Sentinel value written to `bearerToken` when the user supplied projectId/secret
 * manually (no OAuth device-flow). Compared in other branches to distinguish a
 * real bearer from the manual-setup placeholder — extracted to a named constant
 * so a typo (`'manuall'`, `'manaul'`) silently breaking the branch shows up as a
 * compile error rather than a runtime regression.
 */
const BEARER_MANUAL_SENTINEL = 'manual';
// n8n RoutingNode evaluates $credentials BEFORE preAuthentication runs, so we cannot
// reliably branch on bearerToken vs projectSecret here. The expression also cannot
// use regex literals. We always hit the dashboard probe (auth/ok) — it's a 200 OK
// public endpoint that proves DNS/connectivity. preAuthentication does the real work
// (device-flow exchange, project minting); the resulting auth state then surfaces in
// the credential UI fields.
const CREDENTIAL_TEST_URL = `${DEFAULT_DASHBOARD}/api/auth/ok`;
/** Device-flow HTTP calls only; omit timeout so n8n uses its default (avoids ECONNABORTED on slow networks). */
const DEVICE_HTTP_TIMEOUT_MS = 60_000;

/** Drives which fields n8n shows (set on every preAuthentication return). */
type ConnectionState = 'setup' | 'pending' | 'connected';

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
	// Spectrum runtime project id — different from the dashboard `id`. Nodes
	// authenticate against Spectrum using this id, not the dashboard id.
	spectrumProjectId?: string;
	// Some dashboard responses include the current projectSecret inline, in which
	// case we can skip the regenerate-secret call (which invalidates any other
	// tool using the same project).
	projectSecret?: string;
}

function trimHost(host: unknown, fallback: string): string {
	const raw = (typeof host === 'string' && host) || fallback;
	return raw.replace(/\/+$/, '');
}

function withConnectionState(
	data: IDataObject,
	state: ConnectionState,
): IDataObject {
	return { ...data, connectionState: state };
}

function wantsManualCredentials(credentials: ICredentialDataDecryptedObject): boolean {
	return credentials.manualFallback === true;
}

// `createProjectIfNone` defaults to true. Treat unset/null as "use default" so
// the very first connect — when the UI hasn't shown the advanced toggle yet —
// still auto-creates an isolated n8n project instead of reusing whatever
// happens to be on the account.
function wantsAutoCreateProject(credentials: ICredentialDataDecryptedObject): boolean {
	const v = credentials.createProjectIfNone;
	if (v === false) return false;
	return true;
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
		{ displayName: 'Setup Method', name: 'setupMethod', type: 'hidden', default: 'browser' },

		// ── Setup (device sign-in — default) ───────────────────────────────
		{
			displayName:
				'<b>Step 1:</b> enter your iPhone number below (used to assign your shared-pool line). <b>Step 2:</b> click Save — a browser sign-in link appears. <b>Step 3:</b> reopen this panel, follow the link, approve, then click Retry at the top.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: { connectionState: ['setup'] },
				hide: { manualFallback: [true] },
			},
		},
		{
			displayName:
				'Open the sign-in link below in your browser. Confirm the approval code if prompted, then click <b>Retry</b> at the top (not Save — Save can reset sign-in progress).',
			name: 'pendingApprovalNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: { connectionState: ['pending'] },
				hide: { manualFallback: [true] },
			},
		},
		{
			displayName: 'Sign-in link',
			name: 'verificationUrl',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			description: 'Cmd+click (Mac) or copy and paste into your browser.',
			displayOptions: {
				show: { connectionState: ['pending'] },
				hide: { manualFallback: [true] },
			},
		},
		{
			displayName: 'Approval code',
			name: 'userCode',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			description: 'Enter on the Photon sign-in page if it asks for a code.',
			displayOptions: {
				show: { connectionState: ['pending'] },
				hide: { manualFallback: [true] },
			},
		},
		{
			displayName: 'Your iPhone Number (E.164)',
			name: 'yourPhoneNumber',
			type: 'string',
			default: '',
			placeholder: '+15551234567',
			required: true,
			description:
				'Required on shared/free plans. Spectrum assigns you a pool number to iMessage from this iPhone. Use E.164 format with country code, e.g. +14155550123. (Dedicated plans: ignored — your project has its own fixed line.)',
			displayOptions: {
				hide: { manualFallback: [true] },
				show: { connectionState: ['setup', 'pending', 'connected'] },
			},
		},
		{
			displayName: 'Troubleshooting: Use Project ID & Secret',
			name: 'manualFallback',
			type: 'boolean',
			default: false,
			description:
				'Fallback for CI, air-gapped n8n, or when browser sign-in fails. Paste credentials from app.photon.codes → Settings.',
			displayOptions: {
				show: { connectionState: ['setup'] },
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		{
			displayName:
				'Paste Project ID and Project Secret from the Photon dashboard, then click Save.',
			name: 'setupManualNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: { connectionState: ['setup'], manualFallback: [true] },
			},
		},
		// Manual-entry UI fields (only visible when user opts into the manual fallback).
		// These mirror the hidden storage fields below — preAuthentication copies them
		// into the canonical projectId/projectSecret so nodes always read the same keys.
		{
			displayName: 'Project ID',
			name: 'manualProjectId',
			type: 'string',
			default: '',
			placeholder: 'From app.photon.codes → Settings',
			displayOptions: {
				show: { connectionState: ['setup'], manualFallback: [true] },
			},
		},
		{
			displayName: 'Project Secret',
			name: 'manualProjectSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'From app.photon.codes → Settings',
			displayOptions: {
				show: { connectionState: ['setup'], manualFallback: [true] },
				hide: { connectionState: ['pending', 'connected'] },
			},
		},
		// Canonical storage — always serialized and passed to nodes regardless of
		// connectionState. n8n's displayOptions filter the payload at execute time,
		// so authoritative auth values must NOT be gated by show/hide.
		{
			displayName: 'Project ID (stored)',
			name: 'projectId',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Project Secret (stored)',
			name: 'projectSecret',
			type: 'hidden',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Show project options',
			name: 'showProjectOptions',
			type: 'boolean',
			default: false,
			description:
				'Advanced. By default a new Photon project named "n8n iMessage" is created and isolated from your other tools. Enable this to change the project name or opt out of creation.',
			displayOptions: {
				show: { connectionState: ['setup'] },
				hide: {
					manualFallback: [true],
					verificationUrl: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Auto-create Photon project',
			name: 'createProjectIfNone',
			type: 'boolean',
			default: true,
			description:
				'When on (default) we create a fresh "n8n iMessage" project so this credential never shares a Spectrum line pool or webhook list with your other tools (CLI, codex, etc.). Turn off to reuse an existing project — paste its ID via "Use Project ID & Secret".',
			displayOptions: {
				show: {
					connectionState: ['setup'],
					showProjectOptions: [true],
					manualFallback: [false],
				},
			},
		},
		{
			displayName: 'New Project Name',
			name: 'projectName',
			type: 'string',
			default: 'n8n iMessage',
			placeholder: 'n8n iMessage',
			description:
				'Used when auto-creating. Names starting with "n8n" are also matched on future Saves so we reuse the same project instead of creating duplicates.',
			displayOptions: {
				show: {
					connectionState: ['setup'],
					showProjectOptions: [true],
					createProjectIfNone: [true],
					manualFallback: [false],
				},
			},
		},

		// ── Connected ───────────────────────────────────────────────────────
		// Loud warning shown at top when connected but no iMessage line is assigned.
		// Covers both "phone empty" and "phone entered but Spectrum hasn't assigned a number yet".
		{
			displayName:
				'⚠ <b>No iMessage line assigned yet.</b> Enter your iPhone number in the field above (E.164 format, e.g. +15551234567), then click <b>Retry</b> at the top. Photon will assign a pool number you can text from your iPhone.',
			name: 'noLineWarningNoPhone',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					yourPhoneNumber: [''],
				},
				hide: {
					primaryLineNumber: [{ _cnd: { not: '' } }],
					verificationUrl: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName:
				'⚠ <b>No iMessage line assigned yet.</b> Your phone number is saved but Spectrum hasn\'t returned a pool line. Click <b>Retry</b> at the top — if it still doesn\'t appear, check your phone number is in E.164 (+CC...) format and try again.',
			name: 'noLineWarningWithPhone',
			type: 'notice',
			default: '',
			displayOptions: {
				show: { connectionState: ['connected'] },
				hide: {
					yourPhoneNumber: [''],
					primaryLineNumber: [{ _cnd: { not: '' } }],
					verificationUrl: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName:
				'You are connected. Triggers fire when anyone iMessages your project; use the action node to reply.',
			name: 'connectedNotice',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					projectId: [{ _cnd: { not: '' } }],
					primaryLineNumber: [{ _cnd: { not: '' } }],
				},
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		// The assigned iMessage line — shown for both dedicated and shared plans.
		{
			displayName: 'Your iMessage Line',
			name: 'primaryLineNumber',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			description: 'The number people iMessage to reach this n8n project.',
			displayOptions: {
				show: {
					projectId: [{ _cnd: { not: '' } }],
					primaryLineNumber: [{ _cnd: { not: '' } }],
				},
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		// Shared pool with an assigned line — tell the user what to do with it.
		{
			displayName:
				'<b>To test:</b> send an iMessage to <b>Your iMessage Line</b> above from your iPhone — your trigger fires immediately. To onboard more end users, add them on app.photon.codes (each gets their own pool number) or share a deep link <code>https://spectrum.photon.codes/users/{userId}/redirect</code> that opens iMessage pre-filled.',
			name: 'sharedPoolHowTo',
			type: 'notice',
			default: '',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					lineMode: ['shared'],
					primaryLineNumber: [{ _cnd: { not: '' } }],
				},
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		// Per-contact assigned numbers (populated when you have shared users with lines).
		{
			displayName: 'Assigned shared-pool lines',
			name: 'imessageLines',
			type: 'string',
			default: '',
			typeOptions: { editable: false, rows: 4 },
			description:
				'Lines assigned to each shared user on this project. Update or add contacts on app.photon.codes.',
			displayOptions: {
				show: {
					connectionState: ['connected'],
					imessageLines: [{ _cnd: { not: '' } }],
				},
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		{
			displayName: 'Line status',
			name: 'lineStatus',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			displayOptions: {
				show: { connectionState: ['connected'] },
				hide: {
					primaryLineNumber: [{ _cnd: { not: '' } }],
					lineMode: ['shared'],
					verificationUrl: [{ _cnd: { not: '' } }],
				},
			},
		},
		{
			displayName: 'Pre-approved recipients (optional)',
			name: 'preApproved',
			type: 'string',
			default: '',
			placeholder: '+15551234567, alice@example.com',
			description:
				'Phones or emails you may message before they text you first. Others unlock automatically after they message you.',
			displayOptions: {
				show: { projectId: [{ _cnd: { not: '' } }] },
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		{
			displayName: 'Show technical details',
			name: 'showTechnicalDetails',
			type: 'boolean',
			default: false,
			description: 'Project ID for support and dashboard cross-reference.',
			displayOptions: {
				show: { projectId: [{ _cnd: { not: '' } }] },
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},
		{
			displayName: 'Project ID',
			name: 'projectRef',
			type: 'string',
			default: '',
			typeOptions: { editable: false },
			displayOptions: {
				show: {
					projectId: [{ _cnd: { not: '' } }],
					showTechnicalDetails: [true],
				},
				hide: { verificationUrl: [{ _cnd: { not: '' } }] },
			},
		},

		// ── Hidden state ────────────────────────────────────────────────────
		{ displayName: 'Line mode key', name: 'lineMode', type: 'hidden', default: '' },
		{ displayName: 'Line mode label', name: 'lineModeLabel', type: 'hidden', default: '' },
		{ displayName: 'Spectrum Runtime URL', name: 'apiHost', type: 'hidden', default: DEFAULT_RUNTIME },
		{ displayName: 'Dashboard URL', name: 'dashboardHost', type: 'hidden', default: DEFAULT_DASHBOARD },
		{ displayName: 'OAuth Client ID', name: 'clientId', type: 'hidden', default: DEFAULT_CLIENT_ID },
		{
			displayName: 'Bearer token',
			name: 'bearerToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
		{ displayName: 'Device code', name: 'deviceCode', type: 'hidden', default: '' },
		{ displayName: 'Device code expires at', name: 'deviceCodeExpiresAt', type: 'hidden', default: 0 },
	];

	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		try {
			return await runPreAuthentication(this, credentials);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Pending approval is not an error — keep the existing device code so the
			// next Retry can poll again. Wiping it would force a fresh device-flow
			// start and break the approve-then-Retry loop.
			const isPending = message.includes(PENDING_SIGN_IN_TEST_MESSAGE);
			if (isPending) {
				return withConnectionState(
					{
						bearerToken: '',
						projectId: '',
						projectSecret: '',
						setupMethod: 'browser',
						manualFallback: false,
						// preserve: deviceCode, deviceCodeExpiresAt, verificationUrl, userCode
					},
					'pending',
				);
			}
			// Real failure — reset so Save starts fresh.
			return withConnectionState(
				{
					bearerToken: '',
					deviceCode: '',
					deviceCodeExpiresAt: 0,
					verificationUrl: '',
					userCode: '',
					projectId: '',
					projectSecret: '',
					lineStatus: `Photon sign-in error: ${message}. Click Save to try again.`,
					setupMethod: 'browser',
					manualFallback: false,
				},
				'setup',
			);
		}
	}

	// Sent on every authenticated runtime request from nodes. Spectrum endpoints expect
	// Basic projectId:projectSecret. Browser-flow bearer is used by preAuthentication
	// internally (to mint the project secret) and is not sent on node API calls.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.projectSecret ? "Basic " + Buffer.from($credentials.projectId + ":" + $credentials.projectSecret).toString("base64") : "" }}',
			},
		},
	};

	// Static absolute URL — n8n RoutingNode evaluates $credentials BEFORE preAuthentication,
	// so any expression here can resolve with stale/missing data. Hit a public dashboard
	// probe instead; preAuthentication produces the real auth state (or throws a clear error).
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
		const dashboardHost = trimHost(credentials.dashboardHost, DEFAULT_DASHBOARD);
		const clientId = (credentials.clientId as string) || DEFAULT_CLIENT_ID;
		const manual = wantsManualCredentials(credentials);

		// Manual UI fields write to manualProjectId/manualProjectSecret. We mirror them
		// into the canonical projectId/projectSecret so node code reads one place.
		const manualProjectId = ((credentials.manualProjectId as string) || '').trim();
		const manualProjectSecret = ((credentials.manualProjectSecret as string) || '').trim();
		const storedProjectId = ((credentials.projectId as string) || '').trim();
		const storedProjectSecret = ((credentials.projectSecret as string) || '').trim();
		const projectIdInput = manual && manualProjectId ? manualProjectId : storedProjectId;
		const projectSecretInput =
			manual && manualProjectSecret ? manualProjectSecret : storedProjectSecret;
		const bearer = ((credentials.bearerToken as string) || '').trim();

		// Spectrum secrets come in two shapes: 64-char hex (legacy) and ~43-char
		// base64url (current dashboard format, e.g. "9TQvmyTJUlz...-v8"). Accept both;
		// reject obvious placeholders like blank or short tokens.
		const looksLikeSpectrumSecret =
			projectSecretInput.length >= 24 &&
			/^[A-Za-z0-9_-]+$/.test(projectSecretInput);
		const hasConnectedSecret =
			!!projectIdInput && !!projectSecretInput && looksLikeSpectrumSecret;

		// FAST PATH: a stored, healthy projectId+projectSecret is already enough to
		// authenticate against Spectrum at runtime. n8n invokes preAuthentication on
		// every request when bearerToken is expirable; we must NOT touch dashboard
		// state here or any transient failure (network, rate limit, refresh latency)
		// will wipe a working credential and break running workflows.
		if (hasConnectedSecret) {
			const base: IDataObject = {
				projectId: projectIdInput,
				projectSecret: projectSecretInput,
				bearerToken: bearer || BEARER_MANUAL_SENTINEL,
				projectRef: projectIdInput,
				setupMethod: manual ? 'manual' : 'browser',
				manualFallback: manual,
				deviceCode: '',
				deviceCodeExpiresAt: 0,
				verificationUrl: '',
				userCode: '',
			};

			// Best-effort line provisioning + enrichment so the credential UI shows
			// the assigned number / shared-pool status. Any failure here (network,
			// slow API, etc.) must not wipe the working credential — we just skip
			// the UI fields. We provision (idempotent on the Photon side) before
			// reading so the very first Save assigns a line when possible.
			const apiHost = trimHost(credentials.apiHost, DEFAULT_RUNTIME);
			const yourPhone = ((credentials.yourPhoneNumber as string) || '').trim();
			try {
				await Promise.race([
					provisionSpectrumProject(helper, {
						apiHost,
						projectId: projectIdInput,
						projectSecret: projectSecretInput,
						contactPhone: yourPhone || undefined,
					}),
					timeoutAfter(6000, 'provision timeout'),
				]);
			} catch {
				// Non-fatal: line will surface on next reopen when API is healthy.
			}
			try {
				const lines = await Promise.race([
					lineInfoFields(helper, apiHost, projectIdInput, projectSecretInput, yourPhone || undefined),
					timeoutAfter(4000, 'line-enrich timeout'),
				]);
				base.lineMode = lines.lineMode;
				base.lineModeLabel = lines.lineModeLabel;
				base.imessageLines = lines.imessageLines;
				base.primaryLineNumber = lines.primaryLineNumber;
				base.lineStatus = buildLineStatus(lines, yourPhone);
			} catch {
				// Keep going — runtime auth still works with just projectId+secret.
			}

			return withConnectionState(base, 'connected');
		}

		// Note: the fast path above already returns for any `hasConnectedSecret`
		// case (manual or browser-flow). Code below this point only runs when
		// the credential is *not yet* fully connected — either pending the
		// device-flow approval, mid-`mintFromBearer`, or starting a fresh flow.

		const deviceCode = ((credentials.deviceCode as string) || '').trim();
		const expiresAt = Number(credentials.deviceCodeExpiresAt ?? 0);
		if (deviceCode && expiresAt > Date.now()) {
			// One token check per Save/Retry — never block "Testing…" while waiting in the browser.
			const polled = await pollDeviceToken(
				helper,
				dashboardHost,
				clientId,
				deviceCode,
			);
			if (polled.ok) {
				const newBearer = polled.access_token;
				const { projectId, projectSecret } = await mintFromBearer(helper, {
					bearer: newBearer,
					dashboardHost,
					projectIdInput,
					projectName: (credentials.projectName as string) || undefined,
					createProjectIfNone: wantsAutoCreateProject(credentials),
				});
				const base: IDataObject = {
					bearerToken: newBearer,
					projectId,
					projectSecret,
					createProjectIfNone: wantsAutoCreateProject(credentials),
					deviceCode: '',
					deviceCodeExpiresAt: 0,
					verificationUrl: '',
					userCode: '',
					setupMethod: 'browser',
					manualFallback: false,
				};
				// Provision iMessage + shared user inline so the user sees their assigned
				// pool number on the *same* Retry click instead of needing a second reopen.
				const yourPhone =
					((credentials.yourPhoneNumber as string) || '').trim();
				try {
					await Promise.race([
						provisionSpectrumProject(helper, {
							apiHost: trimHost(credentials.apiHost, DEFAULT_RUNTIME),
							projectId,
							projectSecret,
							contactPhone: yourPhone || undefined,
						}),
						timeoutAfter(8000, 'provision timeout'),
					]);
					const lines = await Promise.race([
						lineInfoFields(
							helper,
							trimHost(credentials.apiHost, DEFAULT_RUNTIME),
							projectId,
							projectSecret,
							yourPhone || undefined,
						),
						timeoutAfter(5000, 'line-enrich timeout'),
					]);
					base.lineMode = lines.lineMode;
					base.lineModeLabel = lines.lineModeLabel;
					base.imessageLines = lines.imessageLines;
					base.primaryLineNumber = lines.primaryLineNumber;
					base.lineStatus = buildLineStatus(lines, yourPhone);
				} catch {
					// Non-fatal — runtime still works; next reopen refreshes the line UI.
				}
				return connectedState(base);
			}
			if (polled.error === 'authorization_pending' || polled.error === 'slow_down') {
				throw new Error(PENDING_SIGN_IN_TEST_MESSAGE);
			}
			// expired / denied — fall through to a fresh device flow
		}

		if (manual) {
			return withConnectionState(
				{
					setupMethod: 'manual',
					manualFallback: true,
					bearerToken: '',
					deviceCode: '',
					deviceCodeExpiresAt: 0,
					verificationUrl: '',
					userCode: '',
				},
				'setup',
			);
		}

		// Browser sign-in whenever not fully connected (handles stale projectId-only creds).
		if (!manual && !hasConnectedSecret) {
			return startPendingDeviceFlow(helper, dashboardHost, clientId);
		}

		// The `(bearer && bearer !== BEARER_MANUAL_SENTINEL && hasConnectedSecret)`
		// rehydration branch that used to live here was unreachable — the fast
		// path at the top returns for every `hasConnectedSecret` case. If you
		// need to add a true bearer-rehydration path in the future (e.g. cached
		// bearer but missing projectId), gate it on `!hasConnectedSecret`.

		return startPendingDeviceFlow(helper, dashboardHost, clientId);
}

async function startPendingDeviceFlow(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	clientId: string,
): Promise<IDataObject> {
	const code = await startDeviceFlow(helper, dashboardHost, clientId);
	const verifyUrl = code.verification_uri_complete || code.verification_uri;
	return withConnectionState(
		{
			bearerToken: '',
			deviceCode: code.device_code,
			deviceCodeExpiresAt: Date.now() + code.expires_in * 1000,
			verificationUrl: verifyUrl,
			userCode: code.user_code,
			setupMethod: 'browser',
			manualFallback: false,
			projectId: '',
			projectSecret: '',
			lineStatus: '',
		},
		'pending',
	);
}

function connectedState(base: IDataObject): IDataObject {
	const fallbackStatus =
		'Connected. Save your workflow, then reopen this credential to refresh line details.';
	return withConnectionState(
		{
			...base,
			projectRef: base.projectId,
			lineStatus: base.lineStatus || fallbackStatus,
		},
		'connected',
	);
}

async function httpJson<T>(
	helper: IHttpRequestHelper,
	options: IHttpRequestOptions,
): Promise<T> {
	const response = (await helper.helpers.httpRequest({
		timeout: DEVICE_HTTP_TIMEOUT_MS,
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
		ignoreHttpStatusErrors: true,
		timeout: DEVICE_HTTP_TIMEOUT_MS,
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
		timeout: DEVICE_HTTP_TIMEOUT_MS,
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
		timeout: DEVICE_HTTP_TIMEOUT_MS,
	} as IHttpRequestOptions)) as { projectSecret?: string };
	if (!body?.projectSecret) {
		throw new Error('Spectrum did not return a projectSecret on rotation.');
	}
	return body.projectSecret;
}

async function mintFromBearer(
	helper: IHttpRequestHelper,
	args: {
		bearer: string;
		dashboardHost: string;
		projectIdInput: string;
		projectName?: string;
		/**
		 * Opt-out flag: by default we always create a fresh `n8n iMessage` project
		 * on first connect (so workflows never share a project — and thus a line
		 * pool — with another tool like the CLI or codex). Set to false to refuse
		 * creation and instead error out when no match exists.
		 */
		createProjectIfNone?: boolean;
	},
): Promise<{ projectId: string; projectSecret: string }> {
	const { bearer, dashboardHost, projectIdInput, projectName } = args;
	const allowCreate = args.createProjectIfNone !== false;

	const projects = await listProjects(helper, dashboardHost, bearer);

	let picked: ProjectSummary | undefined;
	const wantedId = projectIdInput.trim();
	if (wantedId) {
		// Match against either dashboard id or spectrum id — users may have pasted either.
		picked = projects.find(
			(p) => p.id === wantedId || p.spectrumProjectId === wantedId,
		);
	}

	if (!picked) {
		const pickedId = pickExistingProject(projects, {
			projectId: projectIdInput,
			preferredName: projectName,
		});
		if (pickedId) {
			picked = projects.find((p) => p.id === pickedId);
		} else if (allowCreate) {
			// Default path: no `n8n*` project exists yet (or this is a fresh
			// account). Create one so we don't clobber the user's other projects.
			const newDashboardId = await createDashboardProject(
				helper,
				dashboardHost,
				bearer,
				(projectName ?? '').trim() || 'n8n iMessage',
			);
			// Re-fetch to get the spectrumProjectId for the newly created project.
			const refreshed = await listProjects(helper, dashboardHost, bearer);
			picked = refreshed.find((p) => p.id === newDashboardId);
			if (!picked) {
				throw new Error('Created dashboard project but could not load it back.');
			}
		} else {
			const msg = projectResolutionError(projects, {
				createIfNone: allowCreate,
			});
			throw new Error(
				msg ||
					`Multiple Photon projects found: ${formatProjectList(projects)}. ` +
						'Paste the Project ID when using manual credentials, or rename one project to start with "n8n".',
			);
		}
	}

	if (!picked) {
		throw new Error('Could not resolve a Photon project to use.');
	}

	// Spectrum runtime expects the spectrumProjectId, not the dashboard id.
	const spectrumId = (picked.spectrumProjectId ?? '').trim();
	if (!spectrumId) {
		throw new Error(
			`Photon project "${picked.name ?? picked.id}" has Spectrum disabled. Enable Spectrum on the dashboard, then Save again.`,
		);
	}

	// Prefer the inline projectSecret from the dashboard response when present —
	// it pairs with spectrumProjectId and avoids rotating any secret another tool
	// (CLI, Codex, custom apps) may be using.
	const inlineSecret = (picked.projectSecret ?? '').trim();
	if (inlineSecret) {
		return { projectId: spectrumId, projectSecret: inlineSecret };
	}

	// Fallback: rotate to mint a fresh secret. Returns a secret tied to spectrumProjectId.
	const projectSecret = await regenerateSecret(helper, dashboardHost, bearer, picked.id);
	return { projectId: spectrumId, projectSecret };
}

