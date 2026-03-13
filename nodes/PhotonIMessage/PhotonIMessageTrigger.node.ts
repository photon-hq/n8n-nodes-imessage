import type {
	IWebhookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	IHookFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { createHmac } from 'crypto';

const PHOTON_EVENTS = [
	{ name: 'All Events', value: '*', description: 'Trigger on every event type' },
	{ name: 'New Message', value: 'new-message', description: 'Messages: A new message was received or sent' },
	{ name: 'Updated Message', value: 'updated-message', description: 'Messages: A message was edited or a reaction was added' },
	{ name: 'Message Send Error', value: 'message-send-error', description: 'Messages: A message failed to send' },
	{ name: 'Chat Read Status Changed', value: 'chat-read-status-changed', description: 'Chat: A chat was marked as read or unread' },
	{ name: 'Typing Indicator', value: 'typing-indicator', description: 'Chat: Someone started or stopped typing' },
	{ name: 'Group Name Change', value: 'group-name-change', description: 'Group: A group chat was renamed' },
	{ name: 'Participant Added', value: 'participant-added', description: 'Group: Someone was added to a group chat' },
	{ name: 'Participant Removed', value: 'participant-removed', description: 'Group: Someone was removed from a group chat' },
	{ name: 'Participant Left', value: 'participant-left', description: 'Group: Someone left a group chat' },
	{ name: 'Group Icon Changed', value: 'group-icon-changed', description: 'Group: The group chat icon was updated' },
	{ name: 'Group Icon Removed', value: 'group-icon-removed', description: 'Group: The group chat icon was removed' },
	{ name: 'FaceTime Call Status Changed', value: 'ft-call-status-changed', description: 'Apple: A FaceTime call started, ended, or changed status' },
	{ name: 'New FindMy Location', value: 'new-findmy-location', description: 'Apple: A new Find My location update was received' },
	{ name: 'Scheduled Message Created', value: 'scheduled-message-created', description: 'Scheduled: A new message was scheduled' },
	{ name: 'Scheduled Message Updated', value: 'scheduled-message-updated', description: 'Scheduled: A scheduled message was modified' },
	{ name: 'Scheduled Message Deleted', value: 'scheduled-message-deleted', description: 'Scheduled: A scheduled message was cancelled' },
	{ name: 'Scheduled Message Sent', value: 'scheduled-message-sent', description: 'Scheduled: A scheduled message was delivered' },
	{ name: 'Scheduled Message Error', value: 'scheduled-message-error', description: 'Scheduled: A scheduled message failed to send' },
	{ name: 'New Server', value: 'new-server', description: 'Server: A new Photon server came online' },
	{ name: 'Server Update', value: 'server-update', description: 'Server: A server update is available' },
	{ name: 'Server Update Downloading', value: 'server-update-downloading', description: 'Server: A server update is being downloaded' },
	{ name: 'Server Update Installing', value: 'server-update-installing', description: 'Server: A server update is being installed' },
];

export class PhotonIMessageTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Photon iMessage Trigger',
		name: 'photonIMessageTrigger',
		icon: 'file:photon-imessage.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Triggers on real-time iMessage events via the Photon Webhook service',
		defaults: {
			name: 'On iMessage Event',
		},
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
				name: 'photonIMessageApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'Configure webhook at <a href="https://webhook.photon.codes" target="_blank">webhook.photon.codes</a>. Use the Webhook URL shown below as the "Webhook URL" field.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: PHOTON_EVENTS,
				default: ['new-message'],
				required: true,
				description: 'Which iMessage events to listen for',
			},
			{
				displayName: 'Signing Secret',
				name: 'signingSecret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'The signing secret you received when configuring the webhook at webhook.photon.codes. Used to verify incoming requests.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Filter by Chat GUID',
						name: 'chatGuid',
						type: 'string',
						default: '',
						placeholder: 'iMessage;-;+1234567890',
						description: 'Only trigger for events in this chat (leave blank for all)',
					},
					{
						displayName: 'Ignore Own Messages',
						name: 'ignoreOwn',
						type: 'boolean',
						default: true,
						description: 'Whether to skip messages you sent (isFromMe = true)',
					},
				],
			},
		],
		usableAsTool: true,
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = req.body as { event?: string; data?: Record<string, unknown> };

		const signingSecret = this.getNodeParameter('signingSecret', '') as string;

		if (signingSecret) {
			const signature = this.getHeaderData()['x-photon-signature'] as string | undefined;
			const timestamp = this.getHeaderData()['x-photon-timestamp'] as string | undefined;

			if (!signature || !timestamp) {
				return { webhookResponse: 'Missing signature headers', noWebhookResponse: false };
			}

			const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);
			const sigBase = `v0:${timestamp}:${rawBody}`;
			const expected = `v0=${createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`;

			if (expected !== signature) {
				return { webhookResponse: 'Invalid signature', noWebhookResponse: false };
			}
		}

		if (!body.event) {
			return { webhookResponse: 'Missing event field', noWebhookResponse: false };
		}

		const selectedEvents = this.getNodeParameter('events', []) as string[];
		if (!selectedEvents.includes('*') && !selectedEvents.includes(body.event)) {
			return { noWebhookResponse: true };
		}

		const options = this.getNodeParameter('options', {}) as {
			chatGuid?: string;
			ignoreOwn?: boolean;
		};

		const data = body.data ?? {};

		if (options.ignoreOwn !== false && data.isFromMe) {
			return { noWebhookResponse: true };
		}

		if (options.chatGuid) {
			const chats = data.chats as Array<Record<string, unknown>> | undefined;
			const chatGuids = chats?.map((c) => c.guid as string) ?? [];
			const cacheRoomnames = data.cacheRoomnames as string | undefined;

			const parts = options.chatGuid.split(';');
			const addr = parts.length === 3 ? parts[2] : options.chatGuid;

			const matches = chatGuids.some((g) => g.includes(addr)) ||
				(cacheRoomnames != null && cacheRoomnames.includes(addr));

			if (!matches) {
				return { noWebhookResponse: true };
			}
		}

		const handle = data.handle as Record<string, unknown> | undefined;
		const chats = data.chats as Array<Record<string, unknown>> | undefined;
		const attachments = data.attachments as unknown[] | undefined;

		const output: INodeExecutionData = {
			json: {
				event: body.event,
				guid: data.guid ?? null,
				text: data.text ?? null,
				sender: handle?.address ?? null,
				chatGuid: chats?.[0]?.guid ?? null,
				dateCreated: data.dateCreated ?? null,
				isFromMe: data.isFromMe ?? false,
				hasAttachments: Array.isArray(attachments) && attachments.length > 0,
				rawData: data,
			},
		};

		return {
			workflowData: [[output]],
		};
	}
}
