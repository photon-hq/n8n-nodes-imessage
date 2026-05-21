import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const DELIVERABILITY_PATTERNS = [
	/\binbound[- ]first\b/i,
	/\bdeliverability\b/i,
	/\bnew conversation\b/i,
	/\bquota\b/i,
	/\brate.?limit/i,
	/\bnot.?messaged\b/i,
	/\bhas not (written|messaged|texted|contacted)\b/i,
	/\bmust (message|text|contact).{0,30}first\b/i,
	/\bcold.?outreach\b/i,
	/\b50 new conversations\b/i,
	/\b5000 messages\b/i,
	/\breport junk\b/i,
];

function errorText(err: unknown): string {
	if (typeof err === 'string') return err;
	if (!err || typeof err !== 'object') return '';
	const e = err as Record<string, unknown>;
	const nested = e.cause && typeof e.cause === 'object' ? (e.cause as Record<string, unknown>) : undefined;
	return [
		e.message,
		e.description,
		e.error,
		nested?.message,
	]
		.filter((p): p is string => typeof p === 'string' && p.length > 0)
		.join(' ');
}

export function isDeliverabilityError(err: unknown): boolean {
	const text = errorText(err);
	if (!text) return false;
	return DELIVERABILITY_PATTERNS.some((re) => re.test(text));
}

export function throwDeliverabilityError(
	ctx: IExecuteFunctions,
	err: unknown,
	itemIndex: number,
): never {
	const detail = errorText(err);
	ctx.logger.warn(
		`[iMessage by Photon] Outbound rejected${detail ? `: ${detail}` : ''}`,
	);
	throw new NodeOperationError(
		ctx.getNode(),
		detail ? `Outbound message rejected: ${detail}` : 'Outbound message rejected.',
		{
			itemIndex,
			description:
				'The recipient may need to message your line first, or your line may be rate-limited. ' +
				'See https://docs.photon.codes/best-practices/imessage-deliverability',
		},
	);
}
