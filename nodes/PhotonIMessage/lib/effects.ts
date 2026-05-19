import type { IMessageEffect } from './types';

// Resolves an n8n effect option key to the MessageEffect value exposed at
// `imessage.effect.message[key]`. Returns undefined for "none" so callers
// can skip wrapping. Values are read at runtime from the imported provider
// to track upstream additions automatically.
export function resolveEffect(
	imessageNamespace: { effect: { message: Record<string, string> } },
	effect: IMessageEffect,
): string | undefined {
	if (!effect || effect === 'none') return undefined;
	const value = imessageNamespace.effect.message[effect];
	return value;
}
