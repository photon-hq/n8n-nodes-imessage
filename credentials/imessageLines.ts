import type { IHttpRequestHelper } from 'n8n-workflow';

const HTTP_TIMEOUT_MS = 20_000;

/** Result of Spectrum project line lookup for the credential form. */
export interface IMessageLineInfo {
	mode: 'shared' | 'dedicated' | '';
	lineModeLabel: string;
	imessageLines: string;
	/** E.164 line end users text to reach this project (first match). */
	primaryLineNumber: string;
}

interface SpectrumEnvelope<T> {
	succeed?: boolean;
	data: T;
}

interface IMessageInfoData {
	type: 'shared' | 'dedicated';
}

interface DedicatedLine {
	platform: string;
	phoneNumber: string;
	status?: string;
}

interface SharedUser {
	id: string;
	type: string;
	firstName?: string | null;
	lastName?: string | null;
	email?: string | null;
	phoneNumber?: string;
	assignedPhoneNumber?: string;
}

async function spectrumGet<T>(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	path: string,
): Promise<T> {
	const host = apiHost.replace(/\/+$/, '');
	const auth =
		'Basic ' + Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
	const raw = (await helper.helpers.httpRequest({
		method: 'GET',
		url: `${host}/projects/${encodeURIComponent(projectId)}${path}`,
		headers: {
			Authorization: auth,
			Accept: 'application/json',
		},
		json: true,
		timeout: HTTP_TIMEOUT_MS,
	})) as SpectrumEnvelope<T> | T;
	if (raw && typeof raw === 'object' && 'data' in raw) {
		return (raw as SpectrumEnvelope<T>).data;
	}
	return raw as T;
}

function userLabel(user: SharedUser): string {
	const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
	if (name) return name;
	if (user.email) return user.email;
	if (user.phoneNumber) return user.phoneNumber;
	return user.id;
}

function formatDedicatedLines(lines: DedicatedLine[]): string {
	const numbers = lines
		.filter((l) => l.platform === 'imessage' && l.phoneNumber)
		.map((l) => l.phoneNumber);
	if (numbers.length === 0) {
		return 'No dedicated iMessage lines on this project yet. Add one in the Photon dashboard.';
	}
	return numbers.map((n) => `Dedicated line: ${n}`).join('\n');
}

function formatSharedUsers(users: SharedUser[]): string {
	const withLine = users.filter((u) => u.assignedPhoneNumber);
	if (withLine.length === 0) {
		return 'No shared contacts with assigned lines yet. Create a shared user in the Photon dashboard — each gets a number end users can text.';
	}
	return withLine
		.map((u) => {
			const label = userLabel(u);
			const contact = u.phoneNumber ? ` (contact ${u.phoneNumber})` : '';
			return `${label}${contact} → text ${u.assignedPhoneNumber}`;
		})
		.join('\n');
}

/**
 * Loads iMessage line mode and human-readable numbers from the Spectrum API.
 * @see https://docs.photon.codes/api-reference/imessage/get-imessage-info
 * @see https://docs.photon.codes/api-reference/lines/list-project-lines
 * @see https://docs.photon.codes/api-reference/users/list-users
 */
export async function fetchIMessageLineInfo(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	contactPhone?: string,
): Promise<IMessageLineInfo> {
	const info = await spectrumGet<IMessageInfoData>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'/imessage/',
	);

	if (info.type === 'dedicated') {
		const linesData = await spectrumGet<{ lines: DedicatedLine[] }>(
			helper,
			apiHost,
			projectId,
			projectSecret,
			'/lines/?platform=imessage',
		);
		const lines = linesData.lines ?? [];
		const imessageOnly = lines.filter((l) => l.platform === 'imessage' && l.phoneNumber);
		return {
			mode: 'dedicated',
			lineModeLabel: 'Dedicated line(s)',
			imessageLines: formatDedicatedLines(lines),
			primaryLineNumber: imessageOnly[0]?.phoneNumber ?? '',
		};
	}

	const usersData = await spectrumGet<{ users: SharedUser[] }>(
		helper,
		apiHost,
		projectId,
		projectSecret,
		'/users/?type=shared',
	);
	const users = usersData.users ?? [];
	const withLine = users.filter((u) => u.assignedPhoneNumber);
	const prefer = contactPhone
		? withLine.find(
				(u) =>
					u.phoneNumber &&
					u.phoneNumber.replace(/\s+/g, '') === contactPhone.replace(/\s+/g, ''),
			)
		: undefined;
	return {
		mode: 'shared',
		lineModeLabel: 'Shared pool (per-contact lines)',
		imessageLines: formatSharedUsers(users),
		primaryLineNumber:
			prefer?.assignedPhoneNumber ?? withLine[0]?.assignedPhoneNumber ?? '',
	};
}

/** Short status copy for the credential form (no expressions). */
export function buildLineStatus(
	lines: {
		lineMode: string;
		lineModeLabel: string;
		imessageLines: string;
		primaryLineNumber: string;
	},
	yourPhone: string,
): string {
	if (lines.primaryLineNumber) {
		const extra =
			lines.imessageLines &&
			!lines.imessageLines.startsWith('No ') &&
			lines.imessageLines !== lines.primaryLineNumber
				? `\n${lines.imessageLines}`
				: '';
		return `${lines.lineModeLabel}${extra}`;
	}
	if (lines.lineMode === 'shared') {
		return yourPhone
			? 'No line assigned yet for this mobile — click Retry after saving your number.'
			: 'Shared plan: enter your mobile below, Save, then Retry to get your iMessage line.';
	}
	if (lines.imessageLines) return lines.imessageLines;
	return 'Click Retry to load your project line from Spectrum.';
}

export async function lineInfoFields(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	contactPhone?: string,
): Promise<{
	lineMode: string;
	lineModeLabel: string;
	imessageLines: string;
	primaryLineNumber: string;
}> {
	try {
		const info = await fetchIMessageLineInfo(
			helper,
			apiHost,
			projectId,
			projectSecret,
			contactPhone,
		);
		return {
			lineMode: info.mode,
			lineModeLabel: info.lineModeLabel,
			imessageLines: info.imessageLines,
			primaryLineNumber: info.primaryLineNumber,
		};
	} catch {
		return {
			lineMode: '',
			lineModeLabel: '',
			primaryLineNumber: '',
			imessageLines:
				'Could not load line numbers from Spectrum. Check the dashboard at app.photon.codes.',
		};
	}
}
