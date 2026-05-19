export interface SpectrumCredentials {
	projectId: string;
	projectSecret: string;
	apiHost: string;
	inboundFirst: 'strict' | 'off';
	preApproved: string;
}

export interface AllowlistEntry {
	address: string;
	firstSeen: number;
	lastSeen: number;
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
export type Tapback = (typeof TAPBACKS)[number];

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
