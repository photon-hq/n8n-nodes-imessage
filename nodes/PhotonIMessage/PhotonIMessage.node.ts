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
import { enforceInboundFirst } from './lib/inboundFirst';
import { withSpectrum, type SpectrumSession } from './lib/spectrumClient';
import {
	BUBBLE_EFFECTS,
	SCREEN_EFFECTS,
	TAPBACKS,
	type IMessageEffect,
	type SpectrumCredentials,
	type Tapback,
} from './lib/types';

const REACTION_OPTIONS = TAPBACKS.map((t) => ({
	name: t.charAt(0).toUpperCase() + t.slice(1),
	value: t,
}));

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

function splitAddresses(raw: string): string[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

export class PhotonIMessage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'iMessage by Photon',
		name: 'photonIMessage',
		icon: 'file:Dark.svg',
		group: ['output'],
		version: 1,
		subtitle:
			'={{ ({"sendMessage":"Send Message","sendAttachment":"Send Attachment","sendVoice":"Send Voice Note","sendContact":"Share Contact","sendRichLink":"Send Rich Link","sendGroup":"Send Group (Album)","editMessage":"Edit Message","reactToMessage":"React","replyToMessage":"Reply","createSpace":"Create / Resolve Space","startTyping":"Start Typing","stopTyping":"Stop Typing","setBackground":"Set Chat Background","createPoll":"Create Poll"}[$parameter["operation"]] || $parameter["operation"]) }}',
		description: 'Send iMessages, react, reply, edit, share contacts, set chat backgrounds, and more — backed by Spectrum',
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
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message', description: 'Send, react, reply, or edit messages' },
					{ name: 'Space', value: 'space', description: 'Create or resolve conversations, manage typing, set backgrounds' },
					{ name: 'Poll', value: 'poll', description: 'Create polls in a conversation' },
					{ name: 'Contact', value: 'contact', description: 'Share contact cards' },
				],
				default: 'message',
			},

			// =====================================================================
			// MESSAGE
			// =====================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{ name: 'Edit Message', value: 'editMessage', action: 'Edit a sent message', description: 'Edit the text of a previously sent message you own' },
					{ name: 'React to Message', value: 'reactToMessage', action: 'React to a message', description: 'Send a tapback reaction' },
					{ name: 'Reply to Message', value: 'replyToMessage', action: 'Reply in thread', description: 'Send a threaded reply to a specific message' },
					{ name: 'Send Attachment', value: 'sendAttachment', action: 'Send an attachment', description: 'Send a file from a path or n8n binary input' },
					{ name: 'Send Group (Album)', value: 'sendGroup', action: 'Send a bundled group', description: 'Bundle multiple items into one logical unit (album)' },
					{ name: 'Send Message', value: 'sendMessage', action: 'Send a message', description: 'Send a text message (optionally with an effect)' },
					{ name: 'Send Rich Link', value: 'sendRichLink', action: 'Send a rich link preview', description: 'Send a URL rendered as a rich link card (Open Graph)' },
					{ name: 'Send Voice Note', value: 'sendVoice', action: 'Send a voice note', description: 'Send an audio clip rendered as an iMessage voice note' },
				],
				default: 'sendMessage',
			},

			// --- Common: Recipients (DM = 1 address, Group = many)
			{
				displayName: 'Recipients',
				name: 'recipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567 or alice@example.com (comma-separated for group)',
				description: 'Phone (E.164) or email of the recipient(s). One for a DM, multiple for a group chat.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendMessage', 'sendAttachment', 'sendVoice', 'sendRichLink', 'sendGroup'],
					},
				},
			},

			// --- Send Message
			{
				displayName: 'Message Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'Hello!',
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'sendMessageOptions',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
				options: [
					{
						displayName: 'Effect',
						name: 'effect',
						type: 'options',
						options: EFFECT_OPTIONS,
						default: 'none',
						description: 'IMessage bubble (animates message) or screen (full-screen) effect',
					},
					{
						displayName: 'Send From Phone',
						name: 'fromPhone',
						type: 'string',
						default: '',
						placeholder: '+15559999999',
						description:
							'For Business-plan dedicated lines: pin this conversation to a specific line. Ignored on shared-pool plans.',
					},
				],
			},

			// --- Send Attachment
			{
				displayName: 'Source',
				name: 'attachmentSource',
				type: 'options',
				options: [
					{ name: 'File Path', value: 'path', description: 'Absolute file path readable by the n8n process' },
					{ name: 'Binary Property', value: 'binary', description: 'Use the binary data on the incoming item' },
				],
				default: 'path',
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment', 'sendVoice'] } },
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
						resource: ['message'],
						operation: ['sendAttachment', 'sendVoice'],
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
						resource: ['message'],
						operation: ['sendAttachment', 'sendVoice'],
						attachmentSource: ['binary'],
					},
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'attachmentOptions',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment', 'sendVoice'] } },
				options: [
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						description: 'Override the filename shown to the recipient',
					},
					{
						displayName: 'MIME Type',
						name: 'mimeType',
						type: 'string',
						default: '',
						description:
							'Override the MIME type. Required when using binary input and the type cannot be inferred from the filename.',
					},
					{
						displayName: 'Voice Duration (Seconds)',
						name: 'duration',
						type: 'number',
						default: 0,
						description: 'Voice notes only — clip length in seconds (used for waveform UI)',
					},
					{
						displayName: 'Send From Phone',
						name: 'fromPhone',
						type: 'string',
						default: '',
						placeholder: '+15559999999',
					},
				],
			},

			// --- Send Rich Link
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/article',
				displayOptions: { show: { resource: ['message'], operation: ['sendRichLink'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'richLinkOptions',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendRichLink'] } },
				options: [
					{
						displayName: 'Send From Phone',
						name: 'fromPhone',
						type: 'string',
						default: '',
					},
				],
			},

			// --- Send Group (Album)
			{
				displayName: 'Items',
				name: 'groupItems',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: { items: [] },
				placeholder: 'Add Item',
				displayOptions: { show: { resource: ['message'], operation: ['sendGroup'] } },
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
				displayName: 'Additional Fields',
				name: 'groupOptions',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendGroup'] } },
				options: [
					{
						displayName: 'Send From Phone',
						name: 'fromPhone',
						type: 'string',
						default: '',
					},
				],
			},

			// --- Reply / Edit / React: all keyed off recipient + message id
			{
				displayName: 'Recipients',
				name: 'targetRecipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567 (DM) or +1...,+1... (group)',
				description:
					'Phone/email of the conversation containing the target message. Use `sender` from the Trigger payload for DM replies.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['replyToMessage', 'editMessage', 'reactToMessage'],
					},
				},
			},
			{
				displayName: 'Send From Phone',
				name: 'replyFromPhone',
				type: 'string',
				default: '',
				placeholder: '+15559999999',
				description:
					'Dedicated lines only — pin to a specific line. Leave blank for shared pool.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['replyToMessage', 'editMessage', 'reactToMessage'],
					},
				},
			},
			{
				displayName: 'Target Message ID',
				name: 'targetMessageId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'spc-msg-…',
				description:
					'The ID of the message to reply to / react to / edit. Found in Trigger payload as `messageId`.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['replyToMessage', 'editMessage', 'reactToMessage'],
					},
				},
			},
			{
				displayName: 'Reply Text',
				name: 'replyText',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['replyToMessage'] } },
			},
			{
				displayName: 'New Text',
				name: 'editText',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				description: 'Replacement text. Only text edits are supported on iMessage.',
				displayOptions: { show: { resource: ['message'], operation: ['editMessage'] } },
			},
			{
				displayName: 'Reaction',
				name: 'reaction',
				type: 'options',
				options: REACTION_OPTIONS,
				required: true,
				default: 'love',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},

			// =====================================================================
			// SPACE
			// =====================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['space'] } },
				options: [
					{ name: 'Create / Resolve Space', value: 'createSpace', action: 'Create or resolve a conversation', description: 'Resolve a DM (one recipient) or group (many recipients) and return its Space ID' },
					{ name: 'Start Typing', value: 'startTyping', action: 'Start typing indicator' },
					{ name: 'Stop Typing', value: 'stopTyping', action: 'Stop typing indicator' },
					{ name: 'Set Background', value: 'setBackground', action: 'Set chat background image' },
				],
				default: 'createSpace',
			},
			{
				displayName: 'Recipients',
				name: 'spaceRecipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567 (DM) or +1..., +1... (group)',
				description: 'Phone or email of the recipient(s). One = DM. Two or more = group.',
				displayOptions: { show: { resource: ['space'], operation: ['createSpace', 'startTyping', 'stopTyping', 'setBackground'] } },
			},
			{
				displayName: 'Send From Phone',
				name: 'spaceFromPhone',
				type: 'string',
				default: '',
				placeholder: '+15559999999',
				description: 'Dedicated lines only — pin the conversation to a specific line',
				displayOptions: { show: { resource: ['space'] } },
			},
			{
				displayName: 'Source',
				name: 'backgroundSource',
				type: 'options',
				options: [
					{ name: 'File Path', value: 'path' },
					{ name: 'Binary Property', value: 'binary' },
					{ name: 'Clear', value: 'clear', description: 'Remove the current chat background' },
				],
				default: 'path',
				displayOptions: { show: { resource: ['space'], operation: ['setBackground'] } },
			},
			{
				displayName: 'File Path',
				name: 'backgroundPath',
				type: 'string',
				default: '',
				placeholder: '/Users/you/Desktop/wallpaper.jpg',
				required: true,
				displayOptions: { show: { resource: ['space'], operation: ['setBackground'], backgroundSource: ['path'] } },
			},
			{
				displayName: 'Binary Property',
				name: 'backgroundBinary',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: { show: { resource: ['space'], operation: ['setBackground'], backgroundSource: ['binary'] } },
			},
			{
				displayName: 'MIME Type',
				name: 'backgroundMime',
				type: 'string',
				default: '',
				placeholder: 'image/jpeg',
				description: 'Required when using a binary source',
				displayOptions: { show: { resource: ['space'], operation: ['setBackground'], backgroundSource: ['binary'] } },
			},

			// =====================================================================
			// POLL
			// =====================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['poll'] } },
				options: [
					{ name: 'Create Poll', value: 'createPoll', action: 'Create a poll' },
				],
				default: 'createPoll',
			},
			{
				displayName: 'Recipients',
				name: 'pollRecipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567, +15559876543',
				description: 'The recipients to send the poll to. Multiple → group.',
				displayOptions: { show: { resource: ['poll'] } },
			},
			{
				displayName: 'Title',
				name: 'pollTitle',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Where should we eat?',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			{
				displayName: 'Options',
				name: 'pollOptions',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: { values: [{ option: '' }, { option: '' }] },
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
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
				displayName: 'Send From Phone',
				name: 'pollFromPhone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},

			// =====================================================================
			// CONTACT
			// =====================================================================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Share Contact Card', value: 'shareContact', action: 'Share a contact card' },
				],
				default: 'shareContact',
			},
			{
				displayName: 'Recipients',
				name: 'contactRecipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567',
				displayOptions: { show: { resource: ['contact'] } },
			},
			{
				displayName: 'Source',
				name: 'contactSource',
				type: 'options',
				options: [
					{ name: 'Structured Fields', value: 'structured' },
					{ name: 'vCard String', value: 'vcard' },
				],
				default: 'structured',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'] } },
			},
			{
				displayName: 'vCard',
				name: 'vcard',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				placeholder: 'BEGIN:VCARD…',
				required: true,
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['vcard'] } },
			},
			{
				displayName: 'First Name',
				name: 'contactFirst',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['structured'] } },
			},
			{
				displayName: 'Last Name',
				name: 'contactLast',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['structured'] } },
			},
			{
				displayName: 'Phones',
				name: 'contactPhones',
				type: 'string',
				default: '',
				placeholder: '+15551234567, +15559876543',
				description: 'Comma-separated phone numbers',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['structured'] } },
			},
			{
				displayName: 'Emails',
				name: 'contactEmails',
				type: 'string',
				default: '',
				placeholder: 'alice@example.com',
				description: 'Comma-separated email addresses',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['structured'] } },
			},
			{
				displayName: 'Organization',
				name: 'contactOrg',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'], contactSource: ['structured'] } },
			},
			{
				displayName: 'Send From Phone',
				name: 'contactFromPhone',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContact'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await getSpectrumCredentials(this);
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		await withSpectrum(credentials, async (session) => {
			for (let i = 0; i < items.length; i++) {
				try {
					const result = await runOne(this, credentials, session, resource, operation, i);
					returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: i },
						});
						continue;
					}
					if (error instanceof NodeOperationError) throw error;
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}
			}
		});

		return [returnData];
	}
}

async function runOne(
	ctx: IExecuteFunctions,
	credentials: SpectrumCredentials,
	session: SpectrumSession,
	resource: string,
	operation: string,
	i: number,
): Promise<unknown> {
	const { app, imessage, effect: effectBuilder, background: backgroundBuilder, sp } = session;
	const im = imessage(app);

	if (resource === 'message') {
		if (operation === 'sendMessage') {
			const recipientsRaw = ctx.getNodeParameter('recipients', i) as string;
			const text = ctx.getNodeParameter('text', i) as string;
			const opts = ctx.getNodeParameter('sendMessageOptions', i, {}) as {
				effect?: IMessageEffect;
				fromPhone?: string;
			};
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);

			const space = await resolveSpace(im, recipients, opts.fromPhone);
			const effectValue = opts.effect
				? resolveEffect(imessage, opts.effect)
				: undefined;

			let content: unknown = sp.text(text);
			if (effectValue) {
				content = effectBuilder(content, effectValue);
			}
			const result = await space.send(content as Parameters<typeof space.send>[0]);
			return {
				spaceId: space.id,
				messageId: (result as { id?: string } | undefined)?.id,
				phone: (space as { phone?: string }).phone,
				type: (space as { type?: string }).type,
			};
		}

		if (operation === 'sendAttachment' || operation === 'sendVoice') {
			const recipientsRaw = ctx.getNodeParameter('recipients', i) as string;
			const source = ctx.getNodeParameter('attachmentSource', i) as 'path' | 'binary';
			const opts = ctx.getNodeParameter('attachmentOptions', i, {}) as {
				fileName?: string;
				mimeType?: string;
				duration?: number;
				fromPhone?: string;
			};
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);
			const space = await resolveSpace(im, recipients, opts.fromPhone);

			const builder = operation === 'sendVoice' ? sp.voice : sp.attachment;

			let content: unknown;
			if (source === 'path') {
				const filePath = ctx.getNodeParameter('filePath', i) as string;
				const meta: Record<string, unknown> = {};
				if (opts.fileName) meta.name = opts.fileName;
				if (opts.mimeType) meta.mimeType = opts.mimeType;
				if (operation === 'sendVoice' && opts.duration) meta.duration = opts.duration;
				content = Object.keys(meta).length > 0
					? (builder as (p: string, m: unknown) => unknown)(filePath, meta)
					: (builder as (p: string) => unknown)(filePath);
			} else {
				const property = ctx.getNodeParameter('binaryProperty', i) as string;
				const binary = await ctx.helpers.getBinaryDataBuffer(i, property);
				const binaryMeta = ctx.helpers.assertBinaryData(i, property);
				const meta: Record<string, unknown> = {
					name: opts.fileName || binaryMeta.fileName || 'file',
					mimeType: opts.mimeType || binaryMeta.mimeType,
				};
				if (operation === 'sendVoice' && opts.duration) meta.duration = opts.duration;
				content = (builder as (b: Buffer, m: unknown) => unknown)(binary, meta);
			}

			const result = await space.send(content as Parameters<typeof space.send>[0]);
			return {
				spaceId: space.id,
				messageId: (result as { id?: string } | undefined)?.id,
				phone: (space as { phone?: string }).phone,
			};
		}

		if (operation === 'sendRichLink') {
			const recipientsRaw = ctx.getNodeParameter('recipients', i) as string;
			const url = ctx.getNodeParameter('url', i) as string;
			const opts = ctx.getNodeParameter('richLinkOptions', i, {}) as { fromPhone?: string };
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);
			const space = await resolveSpace(im, recipients, opts.fromPhone);
			const result = await space.send(sp.richlink(url) as Parameters<typeof space.send>[0]);
			return {
				spaceId: space.id,
				messageId: (result as { id?: string } | undefined)?.id,
			};
		}

		if (operation === 'sendGroup') {
			const recipientsRaw = ctx.getNodeParameter('recipients', i) as string;
			const itemsRaw = ctx.getNodeParameter('groupItems', i) as {
				items?: Array<{ kind: string; value: string }>;
			};
			const opts = ctx.getNodeParameter('groupOptions', i, {}) as { fromPhone?: string };
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);
			const space = await resolveSpace(im, recipients, opts.fromPhone);

			const builtItems: unknown[] = [];
			for (const entry of itemsRaw.items ?? []) {
				if (entry.kind === 'text') {
					builtItems.push(sp.text(entry.value));
				} else if (entry.kind === 'attachmentPath') {
					builtItems.push(sp.attachment(entry.value));
				} else if (entry.kind === 'attachmentBinary') {
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
			const recipientsRaw = ctx.getNodeParameter('targetRecipients', i) as string;
			const fromPhone = ctx.getNodeParameter('replyFromPhone', i, '') as string;
			const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
			const replyText = ctx.getNodeParameter('replyText', i) as string;
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);
			const space = await resolveSpace(im, recipients, fromPhone);
			const target = (await space.getMessage(targetId)) as Parameters<typeof sp.reply>[1];
			const result = await space.send(
				sp.reply(sp.text(replyText), target) as Parameters<typeof space.send>[0],
			);
			return {
				spaceId: space.id,
				messageId: (result as { id?: string } | undefined)?.id,
			};
		}

		if (operation === 'editMessage') {
			const recipientsRaw = ctx.getNodeParameter('targetRecipients', i) as string;
			const fromPhone = ctx.getNodeParameter('replyFromPhone', i, '') as string;
			const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
			const newText = ctx.getNodeParameter('editText', i) as string;
			const recipients = splitAddresses(recipientsRaw);
			// Editing your own outbound messages doesn't trigger inbound-first.
			const space = await resolveSpace(im, recipients, fromPhone);
			const target = (await space.getMessage(targetId)) as Parameters<typeof sp.edit>[1];
			await space.send(
				sp.edit(sp.text(newText), target) as Parameters<typeof space.send>[0],
			);
			return { spaceId: space.id, editedId: targetId };
		}

		if (operation === 'reactToMessage') {
			const recipientsRaw = ctx.getNodeParameter('targetRecipients', i) as string;
			const fromPhone = ctx.getNodeParameter('replyFromPhone', i, '') as string;
			const targetId = ctx.getNodeParameter('targetMessageId', i) as string;
			const reaction = ctx.getNodeParameter('reaction', i) as Tapback;
			const recipients = splitAddresses(recipientsRaw);
			enforceInboundFirst(ctx, credentials, recipients, i);
			const space = await resolveSpace(im, recipients, fromPhone);
			const target = await space.getMessage(targetId);
			await target.react(reaction);
			return { spaceId: space.id, targetId, reaction };
		}
	}

	if (resource === 'space') {
		const recipientsRaw = ctx.getNodeParameter('spaceRecipients', i) as string;
		const fromPhone = ctx.getNodeParameter('spaceFromPhone', i, '') as string;
		const recipients = splitAddresses(recipientsRaw);

		if (operation === 'createSpace') {
			// Resolving a space is read-only; inbound-first only gates outbound.
			const space = await resolveSpace(im, recipients, fromPhone);
			return {
				spaceId: space.id,
				phone: (space as { phone?: string }).phone,
				type: (space as { type?: string }).type,
				recipients,
			};
		}

		enforceInboundFirst(ctx, credentials, recipients, i);
		const space = await resolveSpace(im, recipients, fromPhone);

		if (operation === 'startTyping') {
			await space.startTyping();
			return { spaceId: space.id, typing: true };
		}
		if (operation === 'stopTyping') {
			await space.stopTyping();
			return { spaceId: space.id, typing: false };
		}
		if (operation === 'setBackground') {
			const source = ctx.getNodeParameter('backgroundSource', i) as
				| 'path'
				| 'binary'
				| 'clear';
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
				backgroundBuilder(buf, { mimeType: mime || binaryMeta.mimeType }) as Parameters<typeof space.send>[0],
			);
			return { spaceId: space.id, background: 'set', source: 'binary' };
		}
	}

	if (resource === 'poll' && operation === 'createPoll') {
		const recipientsRaw = ctx.getNodeParameter('pollRecipients', i) as string;
		const title = ctx.getNodeParameter('pollTitle', i) as string;
		const opts = ctx.getNodeParameter('pollOptions', i) as {
			values?: Array<{ option: string }>;
		};
		const fromPhone = ctx.getNodeParameter('pollFromPhone', i, '') as string;
		const recipients = splitAddresses(recipientsRaw);
		enforceInboundFirst(ctx, credentials, recipients, i);
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
			(sp.poll as (...args: unknown[]) => unknown)(title, ...options) as Parameters<typeof space.send>[0],
		);
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
			title,
			options,
		};
	}

	if (resource === 'contact' && operation === 'shareContact') {
		const recipientsRaw = ctx.getNodeParameter('contactRecipients', i) as string;
		const source = ctx.getNodeParameter('contactSource', i) as 'structured' | 'vcard';
		const fromPhone = ctx.getNodeParameter('contactFromPhone', i, '') as string;
		const recipients = splitAddresses(recipientsRaw);
		enforceInboundFirst(ctx, credentials, recipients, i);
		const space = await resolveSpace(im, recipients, fromPhone);

		let contactContent: unknown;
		if (source === 'vcard') {
			const vcard = ctx.getNodeParameter('vcard', i) as string;
			contactContent = sp.contact(vcard);
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
		return {
			spaceId: space.id,
			messageId: (result as { id?: string } | undefined)?.id,
		};
	}

	throw new NodeOperationError(
		ctx.getNode(),
		`Unsupported resource/operation: ${resource}/${operation}`,
		{ itemIndex: i },
	);
}

interface ResolvedSpace {
	id: string;
	phone?: string;
	type?: string;
	send: (content: unknown) => Promise<{ id?: string } | undefined>;
	startTyping: () => Promise<void>;
	stopTyping: () => Promise<void>;
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

