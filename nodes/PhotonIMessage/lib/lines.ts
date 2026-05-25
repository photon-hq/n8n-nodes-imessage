import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const SHARED_LINE_SENTINEL = 'shared';

export interface CredentialLineContext {
	lineMode: string;
	lineNumbers: string[];
	primaryLineNumber: string;
}

export function parseLineNumbersJson(raw: unknown, primaryFallback = ''): string[] {
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
			}
		} catch {
			// fall through
		}
	}
	if (primaryFallback.trim()) return [primaryFallback.trim()];
	return [];
}

export async function getCredentialLineContext(
	ctx: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<CredentialLineContext> {
	const raw = await ctx.getCredentials('photonSpectrumApi');
	const primaryLineNumber = ((raw.primaryLineNumber as string) || '').trim();
	return {
		lineMode: ((raw.lineMode as string) || '').trim(),
		lineNumbers: parseLineNumbersJson(raw.lineNumbersJson, primaryLineNumber),
		primaryLineNumber,
	};
}

export function normalizeLinePhone(value: string | undefined | null): string | undefined {
	const trimmed = (value || '').trim();
	if (!trimmed || trimmed === SHARED_LINE_SENTINEL) return undefined;
	return trimmed;
}

export function parseWebhookLinePhone(payload: {
	space?: { phone?: string; type?: string; id?: string; platform?: string };
	message?: {
		space?: { phone?: string; type?: string; id?: string; platform?: string };
	};
}): string | null {
	const raw =
		payload.message?.space?.phone ??
		payload.space?.phone ??
		'';
	const line = normalizeLinePhone(raw);
	return line ?? null;
}

export function parseWebhookSpaceType(payload: {
	space?: { type?: string; id?: string };
	message?: { space?: { type?: string; id?: string } };
}): 'dm' | 'group' | null {
	const spaceType = payload.message?.space?.type ?? payload.space?.type;
	if (spaceType === 'dm' || spaceType === 'group') return spaceType;

	const spaceId = payload.message?.space?.id ?? payload.space?.id ?? '';
	if (!spaceId) return null;
	if (spaceId.includes(';-;')) return 'dm';
	if (spaceId.includes(';+;') || spaceId) return 'group';
	return null;
}

function legacyFromPhone(ctx: IExecuteFunctions, itemIndex: number, operation: string): string {
	const expert = ctx.getNodeParameter('showExpertOptions', itemIndex, false) as boolean;
	if (expert) {
		const direct = (ctx.getNodeParameter('fromPhone', itemIndex, '') as string) || '';
		if (direct.trim()) return direct.trim();
	}

	const legacyCollections: Record<string, string> = {
		sendMessage: 'sendMessageOptions',
		sendAttachment: 'attachmentOptions',
		sendVoice: 'attachmentOptions',
		sendRichLink: 'richLinkOptions',
		replyToMessage: 'replyOptions',
		editMessage: 'editOptions',
		reactToMessage: 'reactOptions',
	};

	const collection = legacyCollections[operation];
	if (collection) {
		const opts = ctx.getNodeParameter(collection, itemIndex, {}) as { fromPhone?: string };
		if (opts.fromPhone?.trim()) return opts.fromPhone.trim();
	}

	const legacyFields: Record<string, string> = {
		createPoll: 'pollFromPhone',
		shareContact: 'contactFromPhone',
		setBackground: 'spaceFromPhone',
	};
	const legacyField = legacyFields[operation];
	if (legacyField) {
		return ((ctx.getNodeParameter(legacyField, itemIndex, '') as string) || '').trim();
	}

	return '';
}

export async function resolveLinePhone(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<string | undefined> {
	const lines = await getCredentialLineContext(ctx);
	if (lines.lineMode !== 'dedicated') return undefined;

	let chosen: string | undefined;
	try {
		chosen = normalizeLinePhone(ctx.getNodeParameter('sendFromLine', itemIndex, '') as string);
	} catch {
		// v2 workflows saved before sendFromLine existed
	}
	if (!chosen) chosen = normalizeLinePhone(legacyFromPhone(ctx, itemIndex, operation));

	if (!chosen) {
		const item = ctx.getInputData()[itemIndex]?.json;
		chosen = normalizeLinePhone(typeof item?.linePhone === 'string' ? item.linePhone : undefined);
	}

	if (!chosen && lines.lineNumbers.length === 1) {
		chosen = lines.lineNumbers[0];
	}

	if (!chosen && lines.lineNumbers.length > 1) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Choose a Send From Line. After On iMessage Event, use {{ $json.linePhone }}.',
			{ itemIndex },
		);
	}

	return chosen;
}

export async function getProjectLineOptions(
	ctx: ILoadOptionsFunctions,
): Promise<Array<{ name: string; value: string }>> {
	const lines = await getCredentialLineContext(ctx);
	if (lines.lineMode !== 'dedicated' || lines.lineNumbers.length === 0) {
		return [];
	}
	return lines.lineNumbers.map((phone) => ({ name: phone, value: phone }));
}
