import type { IMessageEffect } from './types';

// Resolves an n8n effect option key to the MessageEffect value exposed at
// `imessage.effect.message[key]`. Returns undefined for "none" so callers
// can skip wrapping. Values are read at runtime from the imported provider
// to track upstream additions automatically.
//
// `logger` is the node's logger and is optional — when an unknown effect key
// is requested (e.g. spectrum-ts renamed a constant or shipped a new one we
// don't track yet) we emit a warn so the silent drop shows up in the workflow
// execution log instead of producing a confusing no-op effect.
export function resolveEffect(
	imessageNamespace: { effect: { message: Record<string, string> } },
	effect: IMessageEffect,
	logger?: { warn: (msg: string) => void },
): string | undefined {
	if (!effect || effect === 'none') return undefined;
	const value = imessageNamespace.effect.message[effect];
	if (value === undefined) {
		logger?.warn(
			`[iMessage by Photon] Unknown effect "${effect}" — not found in spectrum-ts imessage.effect.message. Sending without effect. ` +
				'This usually means spectrum-ts was upgraded and the effect key was renamed; update lib/effects.ts to match.',
		);
		return undefined;
	}
	return value;
}
