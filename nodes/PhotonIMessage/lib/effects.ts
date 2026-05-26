import type { IMessageEffect } from './types';

// Resolves an n8n effect option key to the MessageEffect value exposed at
// `imessage.effect.message[key]`. Returns undefined for "none".
export function resolveEffect(
	imessageNamespace: { effect: { message: Record<string, string> } },
	effect: IMessageEffect,
	logger?: { warn: (msg: string) => void },
): string | undefined {
	if (!effect || effect === 'none') return undefined;
	const value = imessageNamespace.effect.message[effect];
	if (value === undefined) {
		logger?.warn(
			`[iMessage by Photon] Unknown effect "${effect}" — not found in spectrum-ts imessage.effect.message.`,
		);
		return undefined;
	}
	return value;
}
