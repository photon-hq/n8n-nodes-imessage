import type { IHttpRequestHelper } from 'n8n-workflow';

const HTTP_TIMEOUT_MS = 20_000;

interface SpectrumEnvelope<T> {
	succeed?: boolean;
	data: T;
}

interface IMessageInfoData {
	type: 'shared' | 'dedicated';
}

interface SharedUser {
	phoneNumber?: string;
	assignedPhoneNumber?: string;
}

async function spectrumRequest<T>(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	method: 'GET' | 'POST' | 'PATCH',
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const host = apiHost.replace(/\/+$/, '');
	const auth =
		'Basic ' + Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
	const raw = (await helper.helpers.httpRequest({
		method,
		url: `${host}/projects/${encodeURIComponent(projectId)}${path}`,
		headers: {
			Authorization: auth,
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body,
		json: true,
		ignoreHttpStatusErrors: false,
		timeout: HTTP_TIMEOUT_MS,
	})) as SpectrumEnvelope<T> | T;
	if (raw && typeof raw === 'object' && 'data' in raw) {
		return (raw as SpectrumEnvelope<T>).data;
	}
	return raw as T;
}

function normalizePhone(phone: string): string {
	return phone.replace(/\s+/g, '').trim();
}

/** Enable iMessage on the Spectrum project (runtime API, same as codex). */
export async function enableImessagePlatform(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
): Promise<void> {
	await spectrumRequest(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'PATCH',
		'/platforms/',
		{ platform: 'imessage', enabled: true },
	);
}

/** Create a shared-pool user; Spectrum assigns `assignedPhoneNumber`. */
export async function ensureSharedUser(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	contactPhone: string,
): Promise<string | undefined> {
	const phone = normalizePhone(contactPhone);
	if (!phone) return undefined;

	const usersData = await spectrumRequest<{ users: SharedUser[] }>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'GET',
		'/users/?type=shared',
	);
	const users = usersData.users ?? [];
	const existing = users.find(
		(u) => u.phoneNumber && normalizePhone(u.phoneNumber) === phone,
	);
	if (existing?.assignedPhoneNumber) {
		return existing.assignedPhoneNumber;
	}

	const created = await spectrumRequest<SharedUser>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'POST',
		'/users/',
		{ type: 'shared', phoneNumber: phone },
	);
	return created.assignedPhoneNumber;
}

export async function createDashboardProject(
	helper: IHttpRequestHelper,
	dashboardHost: string,
	bearer: string,
	name: string,
): Promise<string> {
	const host = dashboardHost.replace(/\/+$/, '');
	const body = (await helper.helpers.httpRequest({
		method: 'POST',
		url: `${host}/api/projects`,
		headers: {
			authorization: `Bearer ${bearer}`,
			'content-type': 'application/json',
		},
		body: {
			name: name || 'n8n iMessage',
			location: 'United States',
			spectrum: true,
			template: false,
			observability: false,
		},
		json: true,
		timeout: HTTP_TIMEOUT_MS,
	})) as { id?: string };
	if (!body?.id) {
		throw new Error('Photon dashboard did not return a project id when creating a project.');
	}
	return body.id;
}

/**
 * Turns on iMessage for the project and, on shared plans, registers the contact
 * phone so Spectrum can assign a line (codex-style provisioning).
 */
export async function provisionSpectrumProject(
	helper: IHttpRequestHelper,
	opts: {
		apiHost: string;
		projectId: string;
		projectSecret: string;
		contactPhone?: string;
	},
): Promise<{ assignedPhone?: string; mode: 'shared' | 'dedicated' | '' }> {
	const { apiHost, projectId, projectSecret } = opts;
	const contactPhone = (opts.contactPhone ?? '').trim();

	await enableImessagePlatform(helper, apiHost, projectId, projectSecret);

	const info = await spectrumRequest<IMessageInfoData>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'GET',
		'/imessage/',
	);

	if (info.type === 'dedicated') {
		return { mode: 'dedicated' };
	}

	if (!contactPhone) {
		return { mode: 'shared' };
	}

	const assignedPhone = await ensureSharedUser(
		helper,
		apiHost,
		projectId,
		projectSecret,
		contactPhone,
	);
	return { assignedPhone, mode: 'shared' };
}
