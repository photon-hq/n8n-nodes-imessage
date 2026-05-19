import type {
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { getSpectrumCredentials } from './lib/credentials';
import { recordInbound } from './lib/inboundFirst';
import { verifySpectrumWebhook } from './lib/verifySignature';
import { deleteWebhook, listWebhooks, registerWebhook } from './lib/webhookApi';
import type { WebhookRegistration } from './lib/types';

const CONTENT_TYPE_OPTIONS = [
	{ name: 'All', value: '*', description: 'Trigger on every content type' },
	{ name: 'Text', value: 'text', description: 'Plain text messages' },
	{ name: 'Attachment', value: 'attachment', description: 'Photos, videos, files' },
	{ name: 'Voice', value: 'voice', description: 'Voice notes' },
	{ name: 'Reaction', value: 'reaction', description: 'Tapback reactions' },
	{ name: 'Reply', value: 'reply', description: 'Threaded replies' },
	{ name: 'Poll', value: 'poll', description: 'Poll messages' },
	{ name: 'Poll Vote', value: 'poll_option', description: 'Poll vote / unvote' },
	{ name: 'Contact', value: 'contact', description: 'Contact card shares' },
	{ name: 'Rich Link', value: 'richlink', description: 'Rich link previews' },
];

const SPACE_TYPE_OPTIONS = [
	{ name: 'Any', value: 'any' },
	{ name: 'DM', value: 'dm', description: 'One-to-one conversations only' },
	{ name: 'Group', value: 'group', description: 'Group chats only' },
];

interface StoredWebhook {
	id: string;
	signingSecret: string;
	webhookUrl: string;
}

export class PhotonIMessageTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'iMessage by Photon Trigger',
		name: 'photonIMessageTrigger',
		icon: 'file:Dark.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["contentTypes"] || []).join(", ") || "all events" }}',
		description: 'Triggers on real-time iMessage events via Spectrum-managed webhooks',
		defaults: { name: 'On iMessage Event' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		credentials: [
			{
				name: 'photonSpectrumApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'When this trigger is activated, n8n registers a webhook URL with Spectrum (<a href="https://docs.photon.codes/webhooks/overview" target="_blank">docs</a>). Deactivating the trigger removes it. Spectrum signs each delivery with HMAC-SHA256 — verification is automatic.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Content Types',
				name: 'contentTypes',
				type: 'multiOptions',
				options: CONTENT_TYPE_OPTIONS,
				default: ['*'],
				description:
					'Filter messages by content type. Today Spectrum emits only the `messages` event family; new event categories will appear here automatically.',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				options: [
					{
						displayName: 'Sender Address',
						name: 'senderAddress',
						type: 'string',
						default: '',
						placeholder: '+15551234567 or alice@example.com',
						description: 'Only trigger when the sender matches (case-insensitive, exact match)',
					},
					{
						displayName: 'Space Type',
						name: 'spaceType',
						type: 'options',
						options: SPACE_TYPE_OPTIONS,
						default: 'any',
					},
					{
						displayName: 'Space ID',
						name: 'spaceId',
						type: 'string',
						default: '',
						placeholder: 'any;-;+15551234567',
						description: 'Only trigger for messages in this exact Space ID',
					},
				],
			},
		],
		usableAsTool: true,
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored = staticData.webhook as StoredWebhook | undefined;
				if (!stored?.id) return false;

				try {
					const creds = await getSpectrumCredentials(this);
					const webhooks = await listWebhooks(this, creds);
					return webhooks.some((w) => w.id === stored.id);
				} catch {
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) return false;

				const creds = await getSpectrumCredentials(this);
				const registration: WebhookRegistration = await registerWebhook(
					this,
					creds,
					webhookUrl,
				);

				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored: StoredWebhook = {
					id: registration.id,
					signingSecret: registration.signingSecret,
					webhookUrl: registration.webhookUrl,
				};
				staticData.webhook = stored;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored = staticData.webhook as StoredWebhook | undefined;
				if (!stored?.id) return true;

				const creds = await getSpectrumCredentials(this);
				await deleteWebhook(this, creds, stored.id);
				delete staticData.webhook;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();

		// HMAC verification requires the exact bytes Spectrum signed. If n8n
		// didn't capture rawBody, falling back to JSON.stringify will fail
		// verification — which correctly surfaces the misconfiguration.
		const rawBody = ((req as { rawBody?: Buffer | string }).rawBody ?? '').toString();
		const fallbackBody = rawBody || JSON.stringify(req.body ?? {});

		const headers = this.getHeaderData() as Record<string, string | undefined>;
		const signature = headers['x-spectrum-signature'];
		const timestamp = headers['x-spectrum-timestamp'];
		const eventHeader = headers['x-spectrum-event'];
		const webhookIdHeader = headers['x-spectrum-webhook-id'];

		const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
		const stored = staticData.webhook as StoredWebhook | undefined;

		if (!stored?.signingSecret) {
			return {
				webhookResponse: 'webhook is not registered',
				noWebhookResponse: false,
			};
		}

		const verification = verifySpectrumWebhook({
			rawBody: fallbackBody,
			signingSecret: stored.signingSecret,
			signature,
			timestamp,
		});

		if (!verification.ok) {
			return {
				webhookResponse: `signature verification failed: ${verification.reason}`,
				noWebhookResponse: false,
			};
		}

		const payload = req.body as
			| {
					event?: string;
					space?: { id?: string; platform?: string };
					message?: {
						id?: string;
						platform?: string;
						direction?: string;
						timestamp?: string;
						sender?: { id?: string; platform?: string };
						space?: { id?: string; platform?: string };
						content?: { type?: string; [key: string]: unknown };
					};
			  }
			| undefined;

		if (!payload?.event) {
			return { webhookResponse: 'missing event field', noWebhookResponse: false };
		}

		if (payload.event !== 'messages') {
			return { webhookResponse: 'ok', noWebhookResponse: false };
		}

		const senderAddress = payload.message?.sender?.id ?? '';
		const spaceId = payload.message?.space?.id ?? payload.space?.id ?? '';
		const contentType = payload.message?.content?.type ?? '';

		if (senderAddress) {
			recordInbound(this, senderAddress);
		}

		const contentTypes = this.getNodeParameter('contentTypes', []) as string[];
		if (
			contentTypes.length > 0 &&
			!contentTypes.includes('*') &&
			!contentTypes.includes(contentType)
		) {
			return { webhookResponse: 'ok', noWebhookResponse: false };
		}

		const filters = this.getNodeParameter('filters', {}) as {
			senderAddress?: string;
			spaceType?: 'any' | 'dm' | 'group';
			spaceId?: string;
		};

		if (
			filters.senderAddress &&
			filters.senderAddress.toLowerCase() !== senderAddress.toLowerCase()
		) {
			return { webhookResponse: 'ok', noWebhookResponse: false };
		}
		if (filters.spaceId && filters.spaceId !== spaceId) {
			return { webhookResponse: 'ok', noWebhookResponse: false };
		}
		if (filters.spaceType && filters.spaceType !== 'any') {
			// Inferred from id shape: DMs use `any;-;<addr>`, groups use a chat
			// GUID. Webhook payload doesn't yet expose space-type directly.
			const isDm = spaceId.includes(';-;');
			const isGroup = !isDm && spaceId !== '';
			if (filters.spaceType === 'dm' && !isDm) {
				return { webhookResponse: 'ok', noWebhookResponse: false };
			}
			if (filters.spaceType === 'group' && !isGroup) {
				return { webhookResponse: 'ok', noWebhookResponse: false };
			}
		}

		const content = payload.message?.content ?? {};
		const output: INodeExecutionData = {
			json: {
				event: payload.event,
				webhookId: webhookIdHeader ?? null,
				eventHeader: eventHeader ?? null,
				messageId: payload.message?.id ?? null,
				platform: payload.message?.platform ?? 'iMessage',
				spaceId: spaceId || null,
				sender: senderAddress || null,
				timestamp: payload.message?.timestamp ?? null,
				contentType: contentType || null,
				text: contentType === 'text' ? (content.text as string | undefined) ?? null : null,
				attachment:
					contentType === 'attachment' || contentType === 'voice'
						? {
								name: content.name ?? null,
								mimeType: content.mimeType ?? null,
								size: content.size ?? null,
							}
						: null,
				reaction:
					contentType === 'reaction'
						? {
								emoji: content.emoji ?? null,
								targetId: (content.target as { id?: string } | undefined)?.id ?? null,
							}
						: null,
				pollVote:
					contentType === 'poll_option'
						? {
								selected: content.selected ?? null,
								title: content.title ?? null,
							}
						: null,
				raw: payload,
			},
		};

		return { workflowData: [[output]] };
	}
}
