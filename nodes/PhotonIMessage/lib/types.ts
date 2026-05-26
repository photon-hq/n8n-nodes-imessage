export interface SpectrumCredentials {
	projectId: string;
	projectSecret: string;
	apiHost: string;
}

export interface WebhookRegistration {
	id: string;
	signingSecret: string;
	webhookUrl: string;
}

export const TAPBACKS = [
	'love',
	'like',
	'dislike',
	'laugh',
	'emphasize',
	'question',
] as const;
export type NamedTapback = (typeof TAPBACKS)[number];
/**
 * Spectrum accepts any string as a reaction — the named tapbacks are just
 * convenience constants. Custom emoji like "🔥" work too.
 */
export type Tapback = NamedTapback | string;

export const SCREEN_EFFECTS = [
	'confetti',
	'fireworks',
	'balloons',
	'heart',
	'lasers',
	'celebration',
	'sparkles',
	'spotlight',
	'echo',
] as const;
export type ScreenEffect = (typeof SCREEN_EFFECTS)[number];

export const BUBBLE_EFFECTS = ['slam', 'loud', 'gentle', 'invisible'] as const;
export type BubbleEffect = (typeof BUBBLE_EFFECTS)[number];

export type IMessageEffect = ScreenEffect | BubbleEffect | 'none';
