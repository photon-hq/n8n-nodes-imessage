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
import { getSpectrumHeader } from './lib/spectrumHeaders';
import { assertPublicWebhookUrl, isLocalWebhookUrl } from './lib/webhookUrl';
import {
	hasStaleRemoteWebhooks,
	isWebhookRegistered,
	type StoredWebhook,
	syncSpectrumWebhook,
} from './lib/webhookSync';
import { verifySpectrumWebhook } from './lib/verifySignature';
import { deleteWebhook, listWebhooks } from './lib/webhookApi';

function classifyAttachment(mime: string): 'photo' | 'voice' | 'video' | 'document' | 'attachment-other' {
	if (mime.startsWith('image/')) return 'photo';
	if (mime.startsWith('audio/')) return 'voice';
	if (mime.startsWith('video/')) return 'video';
	if (mime.startsWith('application/')) return 'document';
	return 'attachment-other';
}

function resolveSigningSecret(
	stored: StoredWebhook,
	webhookIdHeader: string | undefined,
): string | undefined {
	if (!webhookIdHeader || webhookIdHeader === stored.id) {
		return stored.signingSecret;
	}
	return undefined;
}

function webhookFailureMessage(
	reason:
		| 'not-registered'
		| 'missing-body'
		| 'unknown-webhook-id'
		| 'missing-headers'
		| 'stale-timestamp'
		| 'bad-signature',
): string {
	switch (reason) {
		case 'not-registered':
			return 'not listening — click Test this trigger or activate the workflow';
		case 'missing-body':
			return 'empty request body — check your reverse proxy is forwarding POST bodies';
		case 'unknown-webhook-id':
		case 'bad-signature':
			return 'stale webhook — toggle Active off/on, or click Test this trigger again';
		case 'missing-headers':
			return 'missing Spectrum signature headers';
		case 'stale-timestamp':
			return 'webhook timestamp too old — check server clock or retry';
	}
}

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class PhotonIMessageTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'iMessage by Photon Trigger',
		name: 'photonIMessageTrigger',
		icon: 'file:Dark.svg',
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{ $credentials.primaryLineNumber ? "Line " + $credentials.primaryLineNumber : "Set up credential" }}',
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
					'<b>Local dev:</b> run <code>npm run dev:tunnel</code> then toggle this workflow <b>Active</b>. <b>n8n Cloud:</b> just toggle Active. Test mode catches one message per Test click.',
				name: 'webhookModeNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl || isLocalWebhookUrl(webhookUrl)) return false;

				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored = staticData.webhook as StoredWebhook | undefined;
				const creds = await getSpectrumCredentials(this);
				const remote = await listWebhooks(this, creds);
				const nodeWebhookId = this.getNode().webhookId;

				if (!isWebhookRegistered(remote, stored, webhookUrl)) return false;
				if (hasStaleRemoteWebhooks(remote, stored, webhookUrl, nodeWebhookId)) return false;
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) return false;

				assertPublicWebhookUrl(this.getNode(), webhookUrl);

				const creds = await getSpectrumCredentials(this);
				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const stored = staticData.webhook as StoredWebhook | undefined;
				const nodeWebhookId = this.getNode().webhookId;

				const synced = await syncSpectrumWebhook(
					this,
					creds,
					webhookUrl,
					nodeWebhookId,
					stored,
				);

				staticData.webhook = synced;
				this.logger.info(
					`[iMessage by Photon Trigger] Spectrum webhook ${synced.id} synced → ${webhookUrl}`,
				);
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

		const rawBodyBuf = req.rawBody;
		const rawBody =
			rawBodyBuf instanceof Buffer
				? rawBodyBuf.toString('utf8')
				: typeof rawBodyBuf === 'string'
					? rawBodyBuf
					: '';

		const headers = this.getHeaderData() as Record<string, string | string[] | undefined>;
		const signature = getSpectrumHeader(headers, 'x-spectrum-signature');
		const timestamp = getSpectrumHeader(headers, 'x-spectrum-timestamp');
		const eventHeader = getSpectrumHeader(headers, 'x-spectrum-event');
		const webhookIdHeader = getSpectrumHeader(headers, 'x-spectrum-webhook-id');

		const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
		const stored = staticData.webhook as StoredWebhook | undefined;

		if (!stored?.signingSecret) {
			return {
				webhookResponse: webhookFailureMessage('not-registered'),
				noWebhookResponse: false,
			};
		}

		if (!rawBody) {
			return {
				webhookResponse: webhookFailureMessage('missing-body'),
				noWebhookResponse: false,
			};
		}

		const signingSecret = resolveSigningSecret(stored, webhookIdHeader);
		if (!signingSecret) {
			return {
				webhookResponse: webhookFailureMessage('unknown-webhook-id'),
				noWebhookResponse: false,
			};
		}

		const verification = verifySpectrumWebhook({
			rawBody,
			signingSecret,
			signature,
			timestamp,
		});

		if (!verification.ok) {
			this.logger.warn(
				`[iMessage by Photon Trigger] Signature verification failed (${verification.reason})`,
			);
			return {
				webhookResponse: webhookFailureMessage(verification.reason),
				noWebhookResponse: false,
			};
		}

		let payload: {
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
		};
		try {
			payload = JSON.parse(rawBody) as typeof payload;
		} catch {
			return { webhookResponse: 'invalid json body', noWebhookResponse: false };
		}

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

		const mime = String(content.mimeType ?? '');
		const attachmentKind =
			rawContentType === 'attachment' ? classifyAttachment(mime) : undefined;
		const contentType =
			rawContentType === 'attachment' && attachmentKind === 'voice'
				? 'voice'
				: rawContentType;

		const output: INodeExecutionData = {
			json: {
				event: payload.event,
				webhookId: webhookIdHeader ?? null,
				eventHeader: eventHeader ?? null,
				messageId: payload.message?.id ?? null,
				platform: payload.message?.platform ?? 'iMessage',
				direction: payload.message?.direction ?? 'inbound',
				spaceId: spaceId || null,
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
