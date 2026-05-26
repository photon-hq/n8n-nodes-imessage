import { createHmac, timingSafeEqual } from 'crypto';

const TOLERANCE_SEC = 5 * 60;

export interface VerifyInput {
	rawBody: string;
	signingSecret: string;
	signature: string | undefined;
	timestamp: string | undefined;
	now?: number;
}

export type VerifyResult =
	| { ok: true }
	| { ok: false; reason: 'missing-headers' | 'stale-timestamp' | 'bad-signature' };

/**
 * Verify a Spectrum webhook delivery per
 * https://docs.photon.codes/webhooks/verifying-signatures.
 *
 * The four critical details (raw bytes, constant-time compare, staleness, v0= prefix)
 * are all enforced. Never accept a delivery whose verification did not return { ok: true }.
 */
export function verifySpectrumWebhook(input: VerifyInput): VerifyResult {
	const { rawBody, signingSecret, signature, timestamp } = input;
	if (!signature || !timestamp) {
		return { ok: false, reason: 'missing-headers' };
	}

	const now = input.now ?? Math.floor(Date.now() / 1000);
	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SEC) {
		return { ok: false, reason: 'stale-timestamp' };
	}

	const expected =
		'v0=' +
		createHmac('sha256', signingSecret)
			.update(`v0:${timestamp}:${rawBody}`)
			.digest('hex');

	const a = Buffer.from(expected);
	const b = Buffer.from(signature);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return { ok: false, reason: 'bad-signature' };
	}

	return { ok: true };
}
