import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { ApplicationError, NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getSpectrumCredentials } from './lib/credentials';
import { resolveEffect } from './lib/effects';
import { isDeliverabilityError, throwDeliverabilityError } from './lib/outboundErrors';
import { withSpectrum, type SpectrumSession } from './lib/spectrumClient';
import {
	BUBBLE_EFFECTS,
	SCREEN_EFFECTS,
	TAPBACKS,
	type IMessageEffect,
} from './lib/types';

/* eslint-disable n8n-nodes-base/node-param-operation-option-without-action -- only the four primary actions expose picker entries */

const REACTION_OPTIONS = [
	...TAPBACKS.map((t) => ({
		name: t.charAt(0).toUpperCase() + t.slice(1),
		value: t,
	})),
	{ name: 'Custom (Emoji / String)', value: '__custom__' },
];

const EFFECT_OPTIONS = [
	{ name: 'None', value: 'none' as const, description: 'No special effect' },
	...BUBBLE_EFFECTS.map((e) => ({
		name: `Bubble: ${e.charAt(0).toUpperCase() + e.slice(1)}`,
		value: e,
		description: 'Bubble effect — animates the message itself',
	})),
	...SCREEN_EFFECTS.map((e) => ({
		name: `Screen: ${e.charAt(0).toUpperCase() + e.slice(1)}`,
		value: e,
		description: 'Screen effect — animates the recipient screen',
	})),
];

const OPERATION_LABELS: Record<string, string> = {
	sendMessage: 'Send Message',
	sendAttachment: 'Send Attachment',
	replyToMessage: 'Reply',
	reactToMessage: 'React',
	sendRichLink: 'Send Rich Link',
	sendVoice: 'Send Voice Note',
	wrapWithTyping: 'Send With Typing',
	editMessage: 'Edit Message',
	createPoll: 'Create Poll',
	shareContact: 'Share Contact',
	sendGroup: 'Send Group (Album)',
	getMessage: 'Get Message',
	sendCustom: 'Send Custom Payload',
	setBackground: 'Set Chat Background',
};

const STANDARD_OPERATIONS = [
	{
		name: 'Send Message',
		value: 'sendMessage',
		action: 'Send a message',
		description: 'Text someone — works with Manual Trigger, no iMessage trigger needed',
	},
	{
		name: 'Send Attachment',
		value: 'sendAttachment',
		action: 'Send an attachment',
		description: 'Send a photo, PDF, or other file from a path or n8n binary input',
	},
	{
		name: 'Reply to Message',
		value: 'replyToMessage',
		action: 'Reply in thread',
		description: 'Reply to an inbound message — wire after On iMessage Event',
	},
	{
		name: 'React to Message',
		value: 'reactToMessage',
		action: 'React to a message',
		description: 'Send a tapback — wire after On iMessage Event',
	},
	{
		name: 'Send Rich Link',
		value: 'sendRichLink',
		description: 'Send a URL rendered as a rich link card',
	},
	{
		name: 'Send Voice Note',
		value: 'sendVoice',
		description: 'Send an audio clip as an iMessage voice note',
	},
	{
		name: 'Send With Typing',
		value: 'wrapWithTyping',
		description: 'Show typing indicator, wait, then send text',
	},
	{
		name: 'Edit Message',
		value: 'editMessage',
		description: 'Edit the text of a message you previously sent',
	},
	{
		name: 'Create Poll',
		value: 'createPoll',
		description: 'Create a poll in a conversation',
	},
	{
		name: 'Share Contact Card',
		value: 'shareContact',
		description: 'Share a contact card with someone',
	},
];

const EXPERT_OPERATIONS = [
	{
		name: 'Send Group (Album)',
		value: 'sendGroup',
		description: 'Bundle multiple attachments and/or text into one album',
	},
	{
		name: 'Get Message',
		value: 'getMessage',
		description: 'Look up a message by ID in a conversation',
	},
	{
		name: 'Send Custom Payload',
		value: 'sendCustom',
		description: 'Advanced — raw provider JSON',
	},
	{
		name: 'Set Chat Background',
		value: 'setBackground',
		description: 'Set or clear the chat background image',
	},
];

const RECIPIENT_OPERATIONS = [
	'sendMessage',
	'sendAttachment',
	'sendVoice',
	'sendRichLink',
	'sendGroup',
	'sendCustom',
	'getMessage',
	'wrapWithTyping',
	'createPoll',
	'shareContact',
	'setBackground',
];

const TARGET_OPERATIONS = ['replyToMessage', 'editMessage', 'reactToMessage'];

const ATTACHMENT_OPERATIONS = ['sendAttachment', 'sendVoice'];

function splitAddresses(raw: string): string[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
		setTimeout(resolve, ms);
	});
}

function resolveOperation(ctx: IExecuteFunctions, itemIndex: number): string {
	const direct = ctx.getNodeParameter('operation', itemIndex, '') as string;
	if (direct) return direct;

	// Legacy v1 parameters (showAdvanced / resource / simpleOperation)
	const showAdvanced = ctx.getNodeParameter('showAdvanced', 0, false) as boolean;
	if (!showAdvanced) {
		return ctx.getNodeParameter('simpleOperation', itemIndex, 'sendMessage') as string;
	}

	const resource = ctx.getNodeParameter('resource', 0, 'message') as string;
	const legacyOp = ctx.getNodeParameter('operation', itemIndex, 'sendMessage') as string;
	if (resource === 'poll') return 'createPoll';
	if (resource === 'contact') return 'shareContact';
	if (resource === 'space') {
		if (legacyOp === 'wrapWithTyping' || legacyOp === 'setBackground') return legacyOp;
	}
	return legacyOp;
}

function getRecipients(ctx: IExecuteFunctions, itemIndex: number): string {
	const primary = ctx.getNodeParameter('recipients', itemIndex, '') as string;
	if (primary.trim()) return primary;

	for (const legacyField of ['pollRecipients', 'contactRecipients', 'spaceRecipients']) {
		const legacy = ctx.getNodeParameter(legacyField, itemIndex, '') as string;
		if (legacy.trim()) return legacy;
	}
	return primary;
}

function getFromPhone(ctx: IExecuteFunctions, itemIndex: number, operation: string): string {
	const expert = ctx.getNodeParameter('showExpertOptions', itemIndex, false) as boolean;
	if (expert) {
		return (ctx.getNodeParameter('fromPhone', itemIndex, '') as string) || '';
	}

	const legacyCollections: Record<string, string> = {
		sendMessage: 'sendMessageOptions',
		sendAttachment: 'attachmentOptions',
		sendVoice: 'attachmentOptions',
		sendRichLink: 'richLinkOptions',
		sendGroup: 'groupOptions',
		replyToMessage: 'replyOptions',
		editMessage: 'editOptions',
		reactToMessage: 'reactOptions',
	};

	const collection = legacyCollections[operation];
	if (collection) {
		const opts = ctx.getNodeParameter(collection, itemIndex, {}) as { fromPhone?: string };
		if (opts.fromPhone) return opts.fromPhone;
	}

	const legacyFields: Record<string, string> = {
		getMessage: 'lookupFromPhone',
		sendCustom: 'customFromPhone',
		createPoll: 'pollFromPhone',
		shareContact: 'contactFromPhone',
		setBackground: 'spaceFromPhone',
		wrapWithTyping: 'spaceFromPhone',
	};
	const legacyField = legacyFields[operation];
	if (legacyField) {
		return (ctx.getNodeParameter(legacyField, itemIndex, '') as string) || '';
	}

	return '';
}

export class PhotonIMessage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'iMessage by Photon',
		name: 'photonIMessage',
		icon: 'file:Dark.svg',
		group: ['output'],
		version: 2,
		subtitle: `={{ (${JSON.stringify(OPERATION_LABELS)})[$parameter.operation] || $parameter.operation || 'Send Message' }}`,
		description: 'Send and automate iMessages — text, attachments, replies, reactions, and more',
		defaults: { name: 'iMessage by Photon' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'photonSpectrumApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'<b>Outbound:</b> Manual Trigger → <b>Send Message</b>. <b>Auto-reply:</b> On iMessage Event → <b>Reply</b> or <b>React</b> (fields auto-fill).',
				name: 'workflowNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Action',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { showExpertOptions: [false] } },
				options: STANDARD_OPERATIONS,
				default: 'sendMessage',
			},
			{
				displayName: 'Action',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { showExpertOptions: [true] } },
				options: [...STANDARD_OPERATIONS, ...EXPERT_OPERATIONS],
				default: 'sendMessage',
			},
			{
				displayName: 'Show Expert Options',
				name: 'showExpertOptions',
				type: 'boolean',
				default: false,
				description:
					'Whether to show custom payloads, message lookup, group albums, chat backgrounds, message effects, and dedicated-line options',
			},
			{
				displayName: 'Recipients',
				name: 'recipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567',
				description:
					'Phone (+15551234567) or email. When wired after On iMessage Event, map the Sender field from input data.',
				displayOptions: { show: { operation: RECIPIENT_OPERATIONS } },
			},
			{
				displayName: 'Message Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'Hello!',
				displayOptions: { show: { operation: ['sendMessage'] } },
			},
			{
				displayName: 'Effect',
				name: 'effect',
				type: 'options',
				options: EFFECT_OPTIONS,
				default: 'none',
				description: 'Optional iMessage bubble or screen effect',
				displayOptions: {
					show: { showExpertOptions: [true], operation: ['sendMessage'] },
				},
			},
			{
				displayName: 'Source',
				name: 'attachmentSource',
				type: 'options',
				options: [
					{ name: 'Binary Property', value: 'binary', description: 'Use binary data on the incoming item' },
					{ name: 'File Path', value: 'path', description: 'Absolute file path readable by the n8n process' },
				],
				default: 'path',
				displayOptions: { show: { operation: ATTACHMENT_OPERATIONS } },
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				required: true,
				default: '',
				placeholder: '/Users/you/Desktop/photo.jpg',
				displayOptions: {
					show: {
						operation: ATTACHMENT_OPERATIONS,
						attachmentSource: ['path'],
					},
				},
			},
			{
				displayName: 'Binary Property',
				name: 'binaryProperty',
				type: 'string',
				required: true,
				default: 'data',
				description: 'Name of the binary property on the incoming item that holds the file',
				displayOptions: {
					show: {
						operation: ATTACHMENT_OPERATIONS,
						attachmentSource: ['binary'],
					},
				},
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				description: 'Override the filename shown to the recipient',
				displayOptions: { show: { operation: ATTACHMENT_OPERATIONS } },
			},
			{
				displayName: 'MIME Type',
				name: 'mimeType',
				type: 'string',
				default: '',
				description: 'Override MIME type when it cannot be inferred automatically',
				displayOptions: { show: { operation: ATTACHMENT_OPERATIONS } },
			},
			{
				displayName: 'Voice Duration (Seconds)',
				name: 'duration',
				type: 'number',
				default: 0,
				description: 'Voice notes only — clip length in seconds (used for waveform UI)',
				displayOptions: { show: { operation: ['sendVoice'] } },
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/article',
				displayOptions: { show: { operation: ['sendRichLink'] } },
			},
			{
				displayName: 'Items',
				name: 'groupItems',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: { items: [] },
				placeholder: 'Add Item',
				displayOptions: { show: { operation: ['sendGroup'] } },
				options: [
					{
						displayName: 'Item',
						name: 'items',
						values: [
							{
								displayName: 'Kind',
								name: 'kind',
								type: 'options',
								options: [
									{ name: 'Attachment (Path)', value: 'attachmentPath' },
									{ name: 'Attachment (Binary)', value: 'attachmentBinary' },
									{ name: 'Text', value: 'text' },
								],
								default: 'attachmentPath',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description:
									'For Attachment (Path): the file path. For Attachment (Binary): the binary property name. For Text: the text to send.',
							},
						],
					},
				],
			},
			{
				displayName:
					'Pre-filled from the Trigger when this node is wired right after <b>On iMessage Event</b>.',
				name: 'replyNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { operation: ['replyToMessage', 'reactToMessage'] } },
			},
			{
				displayName: 'Conversation With',
				name: 'targetRecipients',
				type: 'string',
				required: true,
				default: '={{ $json.sender }}',
				placeholder: '={{ $json.sender }}',
				description: 'Phone or email of whoever sent the inbound message',
				displayOptions: { show: { operation: TARGET_OPERATIONS } },
			},
			{
				displayName: 'Message ID',
				name: 'targetMessageId',
				type: 'string',
				required: true,
				default: '={{ $json.messageId }}',
				placeholder: '={{ $json.messageId }}',
				description: 'The message to reply to, react to, or edit. Auto-filled from the Trigger.',
				displayOptions: { show: { operation: TARGET_OPERATIONS } },
			},
			{
				displayName: 'Reply Text',
				name: 'replyText',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				placeholder: 'Thanks for your message!',
				description: 'The text sent back as a threaded reply',
				displayOptions: { show: { operation: ['replyToMessage'] } },
			},
			{
				displayName: 'Attachment Binary Property',
				name: 'replyAttachmentBinary',
				type: 'string',
				default: '',
				description: 'Optional — reply with an attachment from this binary property',
				displayOptions: {
					show: { showExpertOptions: [true], operation: ['replyToMessage'] },
				},
			},
			{
				displayName: 'Attachment File Path',
				name: 'replyAttachmentPath',
				type: 'string',
				default: '',
				description: 'Optional — reply with an attachment from a filesystem path',
				displayOptions: {
					show: { showExpertOptions: [true], operation: ['replyToMessage'] },
				},
			},
			{
				displayName: 'New Text',
				name: 'editText',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				description: 'Replacement text. Only text edits are supported on iMessage.',
				displayOptions: { show: { operation: ['editMessage'] } },
			},
			{
				displayName: 'Reaction',
				name: 'reaction',
				type: 'options',
				options: REACTION_OPTIONS,
				required: true,
				default: 'love',
				description: 'Pick a built-in tapback or "Custom" to enter any emoji or string',
				displayOptions: { show: { operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Custom Reaction',
				name: 'reactionCustom',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 🔥 or any emoji',
				description: 'Free-form reaction string. iMessage renders most emojis as tapbacks.',
				displayOptions: {
					show: { operation: ['reactToMessage'], reaction: ['__custom__'] },
				},
			},
			{
				displayName: 'Message ID',
				name: 'lookupMessageId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'spc-msg-…',
				description: 'The Spectrum message ID to look up in the resolved conversation',
				displayOptions: { show: { operation: ['getMessage'] } },
			},
			{
				displayName: 'Custom Payload (JSON)',
				name: 'customPayload',
				type: 'json',
				required: true,
				default: '{}',
				description:
					'Raw provider-specific payload forwarded through Spectrum\'s custom() builder. Only use when you know the expected shape.',
				displayOptions: { show: { operation: ['sendCustom'] } },
			},
			{
				displayName: 'Text',
				name: 'wrapText',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				description: 'Text to send after the typing indicator has been shown',
				displayOptions: { show: { operation: ['wrapWithTyping'] } },
			},
			{
				displayName: 'Typing Delay (Ms)',
				name: 'wrapDelay',
				type: 'number',
				default: 1500,
				description: 'How long to show the typing indicator before sending',
				displayOptions: { show: { operation: ['wrapWithTyping'] } },
			},
			{
				displayName: 'Background Source',
				name: 'backgroundSource',
				type: 'options',
				options: [
					{ name: 'Binary Property', value: 'binary' },
					{ name: 'Clear', value: 'clear', description: 'Remove the current chat background' },
					{ name: 'File Path', value: 'path' },
				],
				default: 'path',
				displayOptions: { show: { operation: ['setBackground'] } },
			},
			{
				displayName: 'Background File Path',
				name: 'backgroundPath',
				type: 'string',
				default: '',
				placeholder: '/Users/you/Desktop/wallpaper.jpg',
				required: true,
				displayOptions: {
					show: { operation: ['setBackground'], backgroundSource: ['path'] },
				},
			},
			{
				displayName: 'Background Binary Property',
				name: 'backgroundBinary',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: { operation: ['setBackground'], backgroundSource: ['binary'] },
				},
			},
			{
				displayName: 'Background MIME Type',
				name: 'backgroundMime',
				type: 'string',
				default: '',
				placeholder: 'image/jpeg',
				description: 'Required when using a binary source',
				displayOptions: {
					show: { operation: ['setBackground'], backgroundSource: ['binary'] },
				},
			},
			{
				displayName: 'Poll Title',
				name: 'pollTitle',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Where should we eat?',
				displayOptions: { show: { operation: ['createPoll'] } },
			},
			{
				displayName: 'Poll Options',
				name: 'pollOptions',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: { values: [{ option: '' }, { option: '' }] },
				placeholder: 'Add Option',
				displayOptions: { show: { operation: ['createPoll'] } },
				options: [
					{
						displayName: 'Option',
						name: 'values',
						values: [
							{
								displayName: 'Option Text',
								name: 'option',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Contact Source',
				name: 'contactSource',
				type: 'options',
				options: [
					{ name: 'Structured Fields', value: 'structured' },
					{ name: 'vCard String', value: 'vcard' },
				],
				default: 'structured',
				displayOptions: { show: { operation: ['shareContact'] } },
			},
			{
				displayName: 'vCard',
				name: 'vcard',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				placeholder: 'BEGIN:VCARD…',
				required: true,
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['vcard'] },
				},
			},
			{
				displayName: 'First Name',
				name: 'contactFirst',
				type: 'string',
				default: '',
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['structured'] },
				},
			},
			{
				displayName: 'Last Name',
				name: 'contactLast',
				type: 'string',
				default: '',
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['structured'] },
				},
			},
			{
				displayName: 'Phones',
				name: 'contactPhones',
				type: 'string',
				default: '',
				placeholder: '+15551234567, +15559876543',
				description: 'Comma-separated phone numbers',
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['structured'] },
				},
			},
			{
				displayName: 'Emails',
				name: 'contactEmails',
				type: 'string',
				default: '',
				placeholder: 'alice@example.com',
				description: 'Comma-separated email addresses',
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['structured'] },
				},
			},
			{
				displayName: 'Organization',
				name: 'contactOrg',
				type: 'string',
				default: '',
				displayOptions: {
					show: { operation: ['shareContact'], contactSource: ['structured'] },
				},
			},
			{
				displayName: 'Send From Phone',
				name: 'fromPhone',
				type: 'string',
				default: '',
				placeholder: '+15559999999',
				description:
					'Dedicated-line accounts only — pin the conversation to a specific line. Ignored on shared-pool plans.',
				displayOptions: {
					show: {
						showExpertOptions: [true],
						operation: [
							'sendMessage',
							'sendAttachment',
							'sendVoice',
							'sendRichLink',
							'sendGroup',
							'sendCustom',
							'getMessage',
							'replyToMessage',
							'editMessage',
							'reactToMessage',
							'wrapWithTyping',
							'createPoll',
							'shareContact',
							'setBackground',
						],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await getSpectrumCredentials(this);

		await withSpectrum(credentials, async (session) => {
			for (let i = 0; i < items.length; i++) {
				try {
					const operation = resolveOperation(this, i);
					const result = await runOne(this, session, operation, i);
					returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: i },
						});
						continue;
					}
					if (isDeliverabilityError(error)) {
						throwDeliverabilityError(this, error, i);
					}
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex: i,
					});
				}
			}
		});

		return [returnData];
	}
}

async function runOne(
	ctx: IExecuteFunctions,
	session: SpectrumSession,
	operation: string,
	i: number,
): Promise<unknown> {
	const { app, imessage, effect: effectBuilder, background: backgroundBuilder, sp } = session;
	const im = imessage(app);

	if (operation === 'sendMessage') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const text = ctx.getNodeParameter('text', i) as string;
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);

		let effectValue: ReturnType<typeof resolveEffect> | undefined;
		const expert = ctx.getNodeParameter('showExpertOptions', i, false) as boolean;
		if (expert) {
			const effect = ctx.getNodeParameter('effect', i, 'none') as IMessageEffect;
			if (effect && effect !== 'none') {
				effectValue = resolveEffect(imessage, effect, ctx.logger);
			}
		} else {
			const legacyOpts = ctx.getNodeParameter('sendMessageOptions', i, {}) as {
				effect?: IMessageEffect;
			};
			if (legacyOpts.effect && legacyOpts.effect !== 'none') {
				effectValue = resolveEffect(imessage, legacyOpts.effect, ctx.logger);
			}
		}

		let content: unknown = sp.text(text);
		if (effectValue) content = effectBuilder(content, effectValue);

		const result = await space.send(content as Parameters<typeof space.send>[0]);
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
			phone: space.phone,
			type: space.type,
		};
	}

	if (operation === 'sendAttachment' || operation === 'sendVoice') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const source = ctx.getNodeParameter('attachmentSource', i) as 'path' | 'binary';
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const builder = operation === 'sendVoice' ? sp.voice : sp.attachment;

		const fileName = ctx.getNodeParameter('fileName', i, '') as string;
		const mimeType = ctx.getNodeParameter('mimeType', i, '') as string;
		const duration = ctx.getNodeParameter('duration', i, 0) as number;

		const legacyOpts = ctx.getNodeParameter('attachmentOptions', i, {}) as {
			fileName?: string;
			mimeType?: string;
			duration?: number;
		};

		const resolvedFileName = fileName || legacyOpts.fileName || '';
		const resolvedMime = mimeType || legacyOpts.mimeType || '';
		const resolvedDuration = duration || legacyOpts.duration || 0;

		let content: unknown;
		if (source === 'path') {
			const filePath = ctx.getNodeParameter('filePath', i) as string;
			const meta: Record<string, unknown> = {};
			if (resolvedFileName) meta.name = resolvedFileName;
			if (resolvedMime) meta.mimeType = resolvedMime;
			if (operation === 'sendVoice' && resolvedDuration) meta.duration = resolvedDuration;
			content =
				Object.keys(meta).length > 0
					? (builder as (p: string, m: unknown) => unknown)(filePath, meta)
					: (builder as (p: string) => unknown)(filePath);
		} else {
			const property = ctx.getNodeParameter('binaryProperty', i) as string;
			const binary = await ctx.helpers.getBinaryDataBuffer(i, property);
			const binaryMeta = ctx.helpers.assertBinaryData(i, property);
			const meta: Record<string, unknown> = {
				name: resolvedFileName || binaryMeta.fileName || 'file',
				mimeType: resolvedMime || binaryMeta.mimeType,
			};
			if (operation === 'sendVoice' && resolvedDuration) meta.duration = resolvedDuration;
			content = (builder as (b: Buffer, m: unknown) => unknown)(binary, meta);
		}

		const result = await space.send(content as Parameters<typeof space.send>[0]);
		return { spaceId: space.id, messageId: (result as { id?: string } | undefined)?.id };
	}

	if (operation === 'sendRichLink') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const url = ctx.getNodeParameter('url', i) as string;
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const result = await space.send(sp.richlink(url) as Parameters<typeof space.send>[0]);
		return { spaceId: space.id, messageId: (result as { id?: string } | undefined)?.id };
	}

	if (operation === 'sendGroup') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const itemsRaw = ctx.getNodeParameter('groupItems', i) as {
			items?: Array<{ kind: string; value: string }>;
		};
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);

		const builtItems: unknown[] = [];
		for (const entry of itemsRaw.items ?? []) {
			if (entry.kind === 'text') builtItems.push(sp.text(entry.value));
			else if (entry.kind === 'attachmentPath') builtItems.push(sp.attachment(entry.value));
			else if (entry.kind === 'attachmentBinary') {
				const binary = await ctx.helpers.getBinaryDataBuffer(i, entry.value);
				const binaryMeta = ctx.helpers.assertBinaryData(i, entry.value);
				builtItems.push(
					sp.attachment(binary, {
						name: binaryMeta.fileName || 'file',
						mimeType: binaryMeta.mimeType,
					}),
				);
			}
		}
		if (builtItems.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'Group requires at least one item', {
				itemIndex: i,
			});
		}
		const groupContent = (sp.group as (...args: unknown[]) => unknown)(...builtItems);
		const result = await space.send(groupContent as Parameters<typeof space.send>[0]);
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
			itemCount: builtItems.length,
		};
	}

	if (operation === 'replyToMessage') {
		const recipients = splitAddresses(ctx.getNodeParameter('targetRecipients', i) as string);
		const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
		const replyText = ctx.getNodeParameter('replyText', i, '') as string;
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const target = (await space.getMessage(targetId)) as Parameters<typeof sp.reply>[1];

		const replyAttachmentPath = ctx.getNodeParameter('replyAttachmentPath', i, '') as string;
		const replyAttachmentBinary = ctx.getNodeParameter('replyAttachmentBinary', i, '') as string;
		const legacyReplyOpts = ctx.getNodeParameter('replyOptions', i, {}) as {
			attachmentPath?: string;
			attachmentBinary?: string;
			attachmentName?: string;
			attachmentMime?: string;
		};

		const attachmentPath = replyAttachmentPath || legacyReplyOpts.attachmentPath || '';
		const attachmentBinary = replyAttachmentBinary || legacyReplyOpts.attachmentBinary || '';

		const inner: unknown[] = [];
		if (replyText) inner.push(sp.text(replyText));
		if (attachmentPath) {
			const meta: Record<string, unknown> = {};
			if (legacyReplyOpts.attachmentName) meta.name = legacyReplyOpts.attachmentName;
			if (legacyReplyOpts.attachmentMime) meta.mimeType = legacyReplyOpts.attachmentMime;
			inner.push(
				Object.keys(meta).length > 0
					? (sp.attachment as (p: string, m: unknown) => unknown)(attachmentPath, meta)
					: (sp.attachment as (p: string) => unknown)(attachmentPath),
			);
		} else if (attachmentBinary) {
			const binary = await ctx.helpers.getBinaryDataBuffer(i, attachmentBinary);
			const binaryMeta = ctx.helpers.assertBinaryData(i, attachmentBinary);
			inner.push(
				(sp.attachment as (b: Buffer, m: unknown) => unknown)(binary, {
					name: legacyReplyOpts.attachmentName || binaryMeta.fileName || 'file',
					mimeType: legacyReplyOpts.attachmentMime || binaryMeta.mimeType,
				}),
			);
		}
		if (inner.length === 0) {
			throw new NodeOperationError(ctx.getNode(), 'Reply requires either text or an attachment', {
				itemIndex: i,
			});
		}

		const wrapped = inner.map(
			(content) => sp.reply(content as Parameters<typeof sp.reply>[0], target) as unknown,
		);
		const result =
			wrapped.length === 1
				? await space.send(wrapped[0] as Parameters<typeof space.send>[0])
				: await (space.send as (...args: unknown[]) => Promise<unknown>)(...wrapped);
		const ids = Array.isArray(result)
			? (result as Array<{ id?: string }>).map((r) => r?.id).filter(Boolean)
			: [(result as { id?: string } | undefined)?.id].filter(Boolean);
		return { spaceId: space.id, messageIds: ids, messageId: ids[0] };
	}

	if (operation === 'editMessage') {
		const recipients = splitAddresses(ctx.getNodeParameter('targetRecipients', i) as string);
		const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
		const newText = ctx.getNodeParameter('editText', i) as string;
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const target = (await space.getMessage(targetId)) as Parameters<typeof sp.edit>[1];
		await space.send(sp.edit(sp.text(newText), target) as Parameters<typeof space.send>[0]);
		return { spaceId: space.id, editedId: targetId };
	}

	if (operation === 'reactToMessage') {
		const recipients = splitAddresses(ctx.getNodeParameter('targetRecipients', i) as string);
		const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
		const reactionRaw = ctx.getNodeParameter('reaction', i) as string;
		const reaction =
			reactionRaw === '__custom__'
				? (ctx.getNodeParameter('reactionCustom', i) as string)
				: reactionRaw;
		if (!reaction) {
			throw new NodeOperationError(ctx.getNode(), 'Reaction is required', { itemIndex: i });
		}
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const target = await space.getMessage(targetId);
		await target.react(reaction);
		return { spaceId: space.id, targetId, reaction };
	}

	if (operation === 'getMessage') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const fromPhone = getFromPhone(ctx, i, operation);
		const messageId = ctx.getNodeParameter('lookupMessageId', i) as string;
		const space = await resolveSpace(im, recipients, fromPhone);
		let msg: (Awaited<ReturnType<typeof space.getMessage>> & {
			id: string;
			platform?: string;
			timestamp?: Date;
			direction?: string;
			content?: { type?: string; text?: string };
			sender?: { id: string };
		}) | undefined;
		try {
			msg = (await space.getMessage(messageId)) as typeof msg;
		} catch (err) {
			const status =
				(err as { httpCode?: number; statusCode?: number }).httpCode ??
				(err as { statusCode?: number }).statusCode;
			if (status === 404) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Message ${messageId} not found in this conversation`,
					{ itemIndex: i },
				);
			}
			throw new NodeApiError(ctx.getNode(), err as JsonObject, { itemIndex: i });
		}
		if (!msg) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Message ${messageId} not found in this conversation`,
				{ itemIndex: i },
			);
		}
		return {
			spaceId: space.id,
			messageId: msg.id,
			platform: msg.platform,
			direction: msg.direction,
			timestamp: msg.timestamp,
			contentType: msg.content?.type,
			text: msg.content?.text,
			senderId: msg.sender?.id,
		};
	}

	if (operation === 'sendCustom') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const fromPhone = getFromPhone(ctx, i, operation);
		const payloadRaw = ctx.getNodeParameter('customPayload', i) as unknown;
		let payload: unknown = payloadRaw;
		if (typeof payloadRaw === 'string') {
			try {
				payload = JSON.parse(payloadRaw);
			} catch (parseError) {
				throw new NodeOperationError(
					ctx.getNode(),
					`Custom payload is not valid JSON: ${(parseError as Error).message}`,
					{ itemIndex: i },
				);
			}
		}
		const space = await resolveSpace(im, recipients, fromPhone);
		const customBuilder = sp.custom as (raw: unknown) => unknown;
		const result = await space.send(customBuilder(payload) as Parameters<typeof space.send>[0]);
		return { spaceId: space.id, messageId: (result as { id?: string } | undefined)?.id };
	}

	if (operation === 'wrapWithTyping') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const fromPhone = getFromPhone(ctx, i, operation);
		const wrapText = ctx.getNodeParameter('wrapText', i) as string;
		const delayMs = ctx.getNodeParameter('wrapDelay', i, 1500) as number;
		const space = await resolveSpace(im, recipients, fromPhone);
		const result = await space.responding(async () => {
			if (delayMs > 0) await sleep(delayMs);
			return space.send(sp.text(wrapText) as Parameters<typeof space.send>[0]);
		});
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
			typingMs: delayMs,
		};
	}

	if (operation === 'setBackground') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const source = ctx.getNodeParameter('backgroundSource', i) as 'path' | 'binary' | 'clear';
		if (source === 'clear') {
			await space.send(backgroundBuilder('clear') as Parameters<typeof space.send>[0]);
			return { spaceId: space.id, background: 'clear' };
		}
		if (source === 'path') {
			const path = ctx.getNodeParameter('backgroundPath', i) as string;
			await space.send(backgroundBuilder(path) as Parameters<typeof space.send>[0]);
			return { spaceId: space.id, background: 'set', source: path };
		}
		const property = ctx.getNodeParameter('backgroundBinary', i) as string;
		const mime = ctx.getNodeParameter('backgroundMime', i) as string;
		const buf = await ctx.helpers.getBinaryDataBuffer(i, property);
		const binaryMeta = ctx.helpers.assertBinaryData(i, property);
		await space.send(
			backgroundBuilder(buf, { mimeType: mime || binaryMeta.mimeType }) as Parameters<
				typeof space.send
			>[0],
		);
		return { spaceId: space.id, background: 'set', source: 'binary' };
	}

	if (operation === 'createPoll') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const title = ctx.getNodeParameter('pollTitle', i) as string;
		const opts = ctx.getNodeParameter('pollOptions', i) as {
			values?: Array<{ option: string }>;
		};
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);
		const options = (opts.values ?? [])
			.map((v) => (v.option ?? '').trim())
			.filter(Boolean);
		if (options.length < 2) {
			throw new NodeOperationError(ctx.getNode(), 'Polls require at least 2 options', {
				itemIndex: i,
			});
		}
		const result = await space.send(
			(sp.poll as (...args: unknown[]) => unknown)(title, ...options) as Parameters<
				typeof space.send
			>[0],
		);
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
			title,
			options,
		};
	}

	if (operation === 'shareContact') {
		const recipients = splitAddresses(getRecipients(ctx, i));
		const source = ctx.getNodeParameter('contactSource', i) as 'structured' | 'vcard';
		const fromPhone = getFromPhone(ctx, i, operation);
		const space = await resolveSpace(im, recipients, fromPhone);

		let contactContent: unknown;
		if (source === 'vcard') {
			contactContent = sp.contact(ctx.getNodeParameter('vcard', i) as string);
		} else {
			const first = ctx.getNodeParameter('contactFirst', i, '') as string;
			const last = ctx.getNodeParameter('contactLast', i, '') as string;
			const phones = (ctx.getNodeParameter('contactPhones', i, '') as string)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
				.map((value) => ({ value }));
			const emails = (ctx.getNodeParameter('contactEmails', i, '') as string)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
				.map((value) => ({ value }));
			const orgName = ctx.getNodeParameter('contactOrg', i, '') as string;
			const input: Record<string, unknown> = {
				name: { first: first || undefined, last: last || undefined },
			};
			if (phones.length > 0) input.phones = phones;
			if (emails.length > 0) input.emails = emails;
			if (orgName) input.org = { name: orgName };
			contactContent = (sp.contact as (input: unknown) => unknown)(input);
		}
		const result = await space.send(contactContent as Parameters<typeof space.send>[0]);
		return { spaceId: space.id, messageId: (result as { id?: string } | undefined)?.id };
	}

	throw new NodeOperationError(ctx.getNode(), `Unsupported action: ${operation}`, {
		itemIndex: i,
	});
}

interface ResolvedSpace {
	id: string;
	phone?: string;
	type?: string;
	send: (content: unknown) => Promise<{ id?: string } | undefined>;
	responding: <T>(fn: () => T | Promise<T>) => Promise<T>;
	getMessage: (id: string) => Promise<{
		id: string;
		react: (emoji: string) => Promise<void>;
	}>;
}

async function resolveSpace(
	im: {
		user: (id: string) => Promise<{ id: string }>;
		space: (...args: unknown[]) => Promise<unknown>;
	},
	recipients: string[],
	fromPhone?: string,
): Promise<ResolvedSpace> {
	if (recipients.length === 0) {
		throw new ApplicationError('At least one recipient is required');
	}
	const users = await Promise.all(recipients.map((r) => im.user(r)));
	const args: unknown[] = [...users];
	if (fromPhone) args.push({ phone: fromPhone });
	return (await im.space(...args)) as ResolvedSpace;
}
