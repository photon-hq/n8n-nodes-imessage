import type { IHttpRequestHelper } from 'n8n-workflow';

import { photonHttpsJson } from './photonHttp';

import type { IMessageInfoData, SpectrumEnvelope } from './spectrumTypes';

const HTTP_TIMEOUT_MS = 20_000;

/** Result of Spectrum project line lookup for the credential form. */
export interface IMessageLineInfo {
	mode: 'shared' | 'dedicated' | '';
	lineModeLabel: string;
	imessageLines: string;
	/** E.164 line end users text to reach this project (first match). */
	primaryLineNumber: string;
	lineNumbers: string[];
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
	_helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
	path: string,
): Promise<T> {
	const host = apiHost.replace(/\/+$/, '');
	const auth =
		'Basic ' + Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
	const raw = await photonHttpsJson<SpectrumEnvelope<T> | T>(
		`${host}/projects/${encodeURIComponent(projectId)}${path}`,
		{
			method: 'GET',
			headers: {
				Authorization: auth,
				Accept: 'application/json',
			},
			timeout: HTTP_TIMEOUT_MS,
		},
	);
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
		const numbers = imessageOnly.map((l) => l.phoneNumber);
		return {
			mode: 'dedicated',
			lineModeLabel: 'Dedicated line(s)',
			imessageLines: formatDedicatedLines(lines),
			primaryLineNumber: numbers[0] ?? '',
			lineNumbers: numbers,
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
	const numbers = withLine.map((u) => u.assignedPhoneNumber as string);
	return {
		mode: 'shared',
		lineModeLabel: 'Shared pool (per-contact lines)',
		imessageLines: formatSharedUsers(users),
		primaryLineNumber: numbers[0] ?? '',
		lineNumbers: numbers,
	};
}

/** Short status copy for the credential form (no expressions). */
export function buildLineStatus(lines: {
	lineMode: string;
	lineModeLabel: string;
	imessageLines: string;
	primaryLineNumber: string;
}): string {
	if (lines.primaryLineNumber) {
		const extra =
			lines.imessageLines &&
			!lines.imessageLines.startsWith('No ') &&
			lines.imessageLines !== lines.primaryLineNumber
				? `\n${lines.imessageLines}`
				: '';
		return `${lines.lineModeLabel}${extra}`;
	}
	if (lines.imessageLines) return lines.imessageLines;
	return 'No iMessage line on this project yet. Add lines or shared users on app.photon.codes, then Save again.';
}

export async function lineInfoFields(
	helper: IHttpRequestHelper,
	apiHost: string,
	projectId: string,
	projectSecret: string,
): Promise<{
	lineMode: string;
	lineModeLabel: string;
	imessageLines: string;
	primaryLineNumber: string;
	lineNumbersJson: string;
	lineCount: number;
}> {
	try {
		const info = await fetchIMessageLineInfo(helper, apiHost, projectId, projectSecret);
		return {
			lineMode: info.mode,
			lineModeLabel: info.lineModeLabel,
			imessageLines: info.imessageLines,
			primaryLineNumber: info.primaryLineNumber,
			lineNumbersJson: JSON.stringify(info.lineNumbers),
			lineCount: info.lineNumbers.length,
		};
	} catch {
		return {
			lineMode: '',
			lineModeLabel: '',
			primaryLineNumber: '',
			lineNumbersJson: '[]',
			lineCount: 0,
			imessageLines:
				'Could not load line numbers from Spectrum. Check the dashboard at app.photon.codes.',
		};
	}
}
