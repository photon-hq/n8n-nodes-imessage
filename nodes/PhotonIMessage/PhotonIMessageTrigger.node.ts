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

/** Filters aligned with Spectrum webhook payloads (messages event).
 *
 * Spectrum's webhook today only delivers `text` and `attachment` content
 * types, with attachments discriminated by MIME prefix (image/audio/video/
 * application). The SDK's content union also includes reaction, richlink,
 * poll, poll_option, contact, reply, edit, group, custom, and typing — these
 * may begin arriving on webhooks in a future release. We list them here so
 * workflows can opt in today and start receiving them with no node update.
 */
const CONTENT_TYPE_OPTIONS = [
	{ name: 'All Messages', value: '*', description: 'Every inbound message on this webhook' },
	{ name: 'Text', value: 'text', description: 'Plain text bodies' },
	{
		name: 'Photo (Image Attachment)',
		value: 'photo',
		description: 'Image attachments (mimeType image/*: HEIC, JPEG, PNG, etc.)',
	},
	{
		name: 'Voice Note / Audio',
		value: 'voice',
		description: 'Audio attachments (mimeType audio/*: M4A, etc.). Includes iMessage voice memos.',
	},
	{
		name: 'Video',
		value: 'video',
		description: 'Video attachments (mimeType video/*: MP4, MOV, etc.)',
	},
	{
		name: 'Document / File',
		value: 'document',
		description: 'Non-media attachments (mimeType application/*: PDF, ZIP, etc.)',
	},
	{
		name: 'Other Attachment',
		value: 'attachment-other',
		description: 'Any attachment whose mimeType doesn\'t fall into the categories above',
	},
	{
		name: 'Reaction (Tapback)',
		value: 'reaction',
		description: 'Tapback reactions on a previous message. Forward-compat: not delivered on webhooks today but reserved for when Spectrum adds them.',
	},
	{
		name: 'Reply (Threaded)',
		value: 'reply',
		description: 'Threaded reply wrapping inner content. Forward-compat.',
	},
	{
		name: 'Edit',
		value: 'edit',
		description: 'Rewrite of a previously-sent message. Forward-compat.',
	},
	{
		name: 'Rich Link Preview',
		value: 'richlink',
		description: 'Open Graph rich link card. Forward-compat.',
	},
	{
		name: 'Poll',
		value: 'poll',
		description: 'A new poll posted to the conversation. Forward-compat.',
	},
	{
		name: 'Poll Vote',
		value: 'poll_option',
		description: 'A vote (or unvote) on a poll option. Forward-compat.',
	},
	{
		name: 'Contact Card',
		value: 'contact',
		description: 'Shared contact card (vCard). Forward-compat.',
	},
	{
		name: 'Group (Album / Bundle)',
		value: 'group',
		description: 'Multi-item group bundle (e.g. photo album). Forward-compat.',
	},
	{
		name: 'Custom (Platform-Specific)',
		value: 'custom',
		description: 'Provider-defined custom payload. Forward-compat.',
	},
];

/** Classify an attachment by its MIME prefix into one of our display buckets. */
function classifyAttachment(mime: string): 'photo' | 'voice' | 'video' | 'document' | 'attachment-other' {
	if (mime.startsWith('image/')) return 'photo';
	if (mime.startsWith('audio/')) return 'voice';
	if (mime.startsWith('video/')) return 'video';
	if (mime.startsWith('application/')) return 'document';
	return 'attachment-other';
}

function matchesContentTypeFilter(
	selected: string[],
	rawType: string,
	content: Record<string, unknown>,
): boolean {
	if (selected.length === 0 || selected.includes('*')) return true;
	const mime = String(content.mimeType ?? '');
	for (const sel of selected) {
		if (sel === rawType) return true;
		// Map the rawType "attachment" onto our split buckets.
		if (rawType === 'attachment' && sel === classifyAttachment(mime)) return true;
	}
	return false;
}

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

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
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
				rawBody: true,
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
					'Filter inbound webhook payloads. Today Spectrum delivers Text and Attachment (Photo/Voice/Video/Document). The remaining variants are reserved for forward compatibility — when Spectrum starts emitting them, this trigger will route them too without a node update. See https://docs.photon.codes/webhooks/events.',
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
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored = staticData.webhook as StoredWebhook | undefined;
				if (!stored?.id) return false;

				const creds = await getSpectrumCredentials(this);
				const webhooks = await listWebhooks(this, creds);
				return webhooks.some((w) => w.id === stored.id);
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
		const req = this.getRequestObject() as ReturnType<IWebhookFunctions['getRequestObject']> & {
			rawBody?: Buffer | string;
			readRawBody?: () => Promise<void>;
		};

		if (!req.rawBody && typeof req.readRawBody === 'function') {
			try {
				await req.readRawBody();
			} catch {
				// ignore
			}
		}
		const rawBody = (req.rawBody ?? '').toString();
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
			this.logger.warn(
				`[iMessage by Photon Trigger] Spectrum webhook signature verification failed: ${verification.reason}. ` +
					'Webhook ignored. This usually means the registered signing secret no longer matches the active webhook — re-activate the trigger to rotate it.',
			);
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
		const content = payload.message?.content ?? {};
		const rawContentType = payload.message?.content?.type ?? '';

		if (senderAddress) {
			recordInbound(this, senderAddress);
		}

		const contentTypes = this.getNodeParameter('contentTypes', []) as string[];
		if (
			!matchesContentTypeFilter(
				contentTypes,
				rawContentType,
				content as Record<string, unknown>,
			)
		) {
			return { webhookResponse: 'ok', noWebhookResponse: false };
		}

		const mime = String(content.mimeType ?? '');
		const attachmentKind =
			rawContentType === 'attachment' ? classifyAttachment(mime) : undefined;
		const contentType =
			rawContentType === 'attachment' && attachmentKind === 'voice'
				? 'voice'
				: rawContentType;

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

		const output: INodeExecutionData = {
			json: {
				event: payload.event,
				webhookId: webhookIdHeader ?? null,
				eventHeader: eventHeader ?? null,
				messageId: payload.message?.id ?? null,
				platform: payload.message?.platform ?? 'iMessage',
				direction: payload.message?.direction ?? 'inbound',
				spaceId: spaceId || null,
				// `space.id` shape is the only signal currently surfaced for DM vs.
				// group; webhook payloads don't include `space.type` today.
				spaceType: spaceId.includes(';-;') ? 'dm' : spaceId ? 'group' : null,
				sender: senderAddress || null,
				senderPlatform: payload.message?.sender?.platform ?? null,
				timestamp: payload.message?.timestamp ?? null,
				contentType: contentType || null,
				attachmentKind: attachmentKind ?? null,
				text: contentType === 'text' ? ((content.text as string | undefined) ?? null) : null,
				attachment:
					rawContentType === 'attachment'
						? {
								kind: attachmentKind ?? null,
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
				reply:
					contentType === 'reply'
						? {
								targetId: (content.target as { id?: string } | undefined)?.id ?? null,
								innerType:
									(content.content as { type?: string } | undefined)?.type ?? null,
							}
						: null,
				edit:
					contentType === 'edit'
						? {
								targetId: (content.target as { id?: string } | undefined)?.id ?? null,
								innerType:
									(content.content as { type?: string } | undefined)?.type ?? null,
							}
						: null,
				richlink:
					contentType === 'richlink'
						? {
								url: (content.url as string | undefined) ?? null,
							}
						: null,
				poll:
					contentType === 'poll'
						? {
								title: (content.title as string | undefined) ?? null,
								options: ((content.options as Array<{ title?: string }> | undefined) ?? [])
									.map((o) => o?.title ?? '')
									.filter(Boolean),
							}
						: null,
				pollVote:
					contentType === 'poll_option'
						? {
								selected: (content.selected as boolean | undefined) ?? null,
								title: (content.title as string | undefined) ?? null,
								pollId:
									(content.poll as { id?: string } | undefined)?.id ?? null,
							}
						: null,
				contact:
					contentType === 'contact'
						? {
								name: content.name ?? null,
								phones: content.phones ?? null,
								emails: content.emails ?? null,
								org: content.org ?? null,
							}
						: null,
				group:
					contentType === 'group'
						? {
								itemCount: Array.isArray(content.items)
									? (content.items as unknown[]).length
									: 0,
							}
						: null,
				custom:
					contentType === 'custom' ? (content.raw ?? content) : null,
				raw: payload,
			},
		};

		return { workflowData: [[output]] };
	}
}
