import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

function generateTempGuid(): string {
	const hex = '0123456789abcdef';
	let result = 'temp_';
	for (let i = 0; i < 32; i++) {
		result += hex[Math.floor(Math.random() * 16)];
	}
	return result;
}

export class PhotonIMessage implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Photon iMessage',
		name: 'photonIMessage',
		icon: 'file:photon-imessage.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send, search, and manage iMessage conversations via the Photon server',
		defaults: {
			name: 'Photon iMessage',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'photonIMessageApi',
				required: true,
			},
		],
		properties: [
			// ------ Resource selector ------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Chat', value: 'chat' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Poll', value: 'poll' },
					{ name: 'Scheduled Message', value: 'scheduledMessage' },
					{ name: 'Handle', value: 'handle' },
				],
				default: 'message',
			},

			// ====== MESSAGE operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{ name: 'Send Message', value: 'sendMessage', action: 'Send a message', description: 'Send a text message to a chat' },
					{ name: 'Send Attachment', value: 'sendAttachment', action: 'Send an attachment', description: 'Send a file attachment to a chat' },
					{ name: 'Unsend Message', value: 'unsendMessage', action: 'Unsend a message', description: 'Retract a sent message' },
					{ name: 'Edit Message', value: 'editMessage', action: 'Edit a message', description: 'Edit the text of a sent message' },
					{ name: 'React to Message', value: 'reactToMessage', action: 'React to a message', description: 'Send a tapback reaction to a message' },
					{ name: 'Download Attachment', value: 'downloadAttachment', action: 'Download an attachment', description: 'Download a received file or media attachment' },
					{ name: 'Search Messages', value: 'searchMessages', action: 'Search messages', description: 'Search messages by text content' },
					{ name: 'Get Messages', value: 'getMessages', action: 'Get messages', description: 'Retrieve messages from a chat' },
				],
				default: 'sendMessage',
			},
			// --- Send Message fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier (e.g. iMessage;-;+1234567890 or iMessage;+;chat123)',
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
			},
			{
				displayName: 'Message Text',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The text content of the message to send',
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
				options: [
					{
						displayName: 'Method',
						name: 'method',
						type: 'options',
						options: [
							{ name: 'AppleScript', value: 'apple-script' },
							{ name: 'Private API', value: 'private-api' },
						],
						default: 'apple-script',
						description: 'The method used to send the message',
					},
					{
						displayName: 'Subject',
						name: 'subject',
						type: 'string',
						default: '',
						description: 'Optional subject line for the message',
					},
					{
						displayName: 'Effect ID',
						name: 'effectId',
						type: 'options',
						options: [
							{ name: 'None', value: '' },
							{ name: 'Confetti', value: 'com.apple.messages.effect.CKConfettiEffect' },
							{ name: 'Fireworks', value: 'com.apple.messages.effect.CKFireworksEffect' },
							{ name: 'Balloons', value: 'com.apple.messages.effect.CKBalloonEffect' },
							{ name: 'Hearts', value: 'com.apple.messages.effect.CKHeartEffect' },
							{ name: 'Lasers', value: 'com.apple.messages.effect.CKHappyBirthdayEffect' },
							{ name: 'Shooting Star', value: 'com.apple.messages.effect.CKShootingStarEffect' },
							{ name: 'Sparkles', value: 'com.apple.messages.effect.CKSparklesEffect' },
							{ name: 'Echo', value: 'com.apple.messages.effect.CKEchoEffect' },
							{ name: 'Spotlight', value: 'com.apple.messages.effect.CKSpotlightEffect' },
							{ name: 'Gentle', value: 'com.apple.MobileSMS.expressivesend.gentle' },
							{ name: 'Loud', value: 'com.apple.MobileSMS.expressivesend.loud' },
							{ name: 'Slam', value: 'com.apple.MobileSMS.expressivesend.impact' },
							{ name: 'Invisible Ink', value: 'com.apple.MobileSMS.expressivesend.invisibleink' },
						],
						default: '',
						description: 'iMessage screen effect to send with the message',
					},
					{
						displayName: 'Reply To Message GUID',
						name: 'selectedMessageGuid',
						type: 'string',
						default: '',
						description: 'GUID of a message to reply to inline',
					},
				],
			},
			// --- Send Attachment fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier',
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				required: true,
				default: '',
				placeholder: '/Users/you/Desktop/photo.jpg',
				description: 'Absolute file path on the Photon server Mac',
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'attachmentAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
				options: [
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						description: 'Override the file name sent with the attachment',
					},
					{
						displayName: 'Is Audio Message',
						name: 'isAudioMessage',
						type: 'boolean',
						default: false,
						description: 'Whether to send as a voice message',
					},
				],
			},
			// --- Unsend Message fields ---
			{
				displayName: 'Message GUID',
				name: 'messageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the message to unsend',
				displayOptions: { show: { resource: ['message'], operation: ['unsendMessage'] } },
			},
			{
				displayName: 'Part Index',
				name: 'unsendPartIndex',
				type: 'number',
				default: 0,
				description: 'Index of the message part to unsend (0 for the first part)',
				displayOptions: { show: { resource: ['message'], operation: ['unsendMessage'] } },
			},
			// --- Edit Message fields ---
			{
				displayName: 'Message GUID',
				name: 'messageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the message to edit',
				displayOptions: { show: { resource: ['message'], operation: ['editMessage'] } },
			},
			{
				displayName: 'New Text',
				name: 'editedMessage',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The replacement text for the message',
				displayOptions: { show: { resource: ['message'], operation: ['editMessage'] } },
			},
			{
				displayName: 'Part Index',
				name: 'editPartIndex',
				type: 'number',
				default: 0,
				description: 'Index of the message part to edit (0 for the first part)',
				displayOptions: { show: { resource: ['message'], operation: ['editMessage'] } },
			},
			// --- Download Attachment fields ---
			{
				displayName: 'Attachment GUID',
				name: 'attachmentGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the attachment to download',
				displayOptions: { show: { resource: ['message'], operation: ['downloadAttachment'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'downloadAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['downloadAttachment'] } },
				options: [
					{
						displayName: 'Width',
						name: 'width',
						type: 'number',
						default: 0,
						description: 'Desired image width in pixels (0 for original)',
					},
					{
						displayName: 'Height',
						name: 'height',
						type: 'number',
						default: 0,
						description: 'Desired image height in pixels (0 for original)',
					},
					{
						displayName: 'Quality',
						name: 'quality',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 100 },
						default: 80,
						description: 'Image quality (1-100)',
					},
				],
			},
			// --- React to Message fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Message GUID',
				name: 'messageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the message to react to',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Reaction',
				name: 'reaction',
				type: 'options',
				required: true,
				options: [
					{ name: 'Love', value: 'love' },
					{ name: 'Like', value: 'like' },
					{ name: 'Dislike', value: 'dislike' },
					{ name: 'Laugh', value: 'laugh' },
					{ name: 'Emphasize', value: 'emphasize' },
					{ name: 'Question', value: 'question' },
				],
				default: 'love',
				description: 'The tapback reaction to send',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Part Index',
				name: 'partIndex',
				type: 'number',
				default: 0,
				description: 'Index of the message part to react to (0 for the first part)',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			// --- Search Messages fields ---
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				description: 'Text to search for in messages',
				displayOptions: { show: { resource: ['message'], operation: ['searchMessages'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'searchAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['searchMessages'] } },
				options: [
					{
						displayName: 'Chat GUID',
						name: 'chatGuid',
						type: 'string',
						default: '',
						description: 'Limit search to a specific chat',
					},
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 20,
						description: 'Max number of results to return',
					},
					{
						displayName: 'Sort',
						name: 'sort',
						type: 'options',
						options: [
							{ name: 'Newest First', value: 'DESC' },
							{ name: 'Oldest First', value: 'ASC' },
						],
						default: 'DESC',
						description: 'Sort order of results',
					},
				],
			},
			// --- Get Messages fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier to retrieve messages from',
				displayOptions: { show: { resource: ['message'], operation: ['getMessages'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'getMessagesAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['getMessages'] } },
				options: [
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 20,
						description: 'Max number of messages to return',
					},
					{
						displayName: 'After',
						name: 'after',
						type: 'dateTime',
						default: '',
						description: 'Only return messages after this date',
					},
					{
						displayName: 'Before',
						name: 'before',
						type: 'dateTime',
						default: '',
						description: 'Only return messages before this date',
					},
					{
						displayName: 'Sort',
						name: 'sort',
						type: 'options',
						options: [
							{ name: 'Newest First', value: 'DESC' },
							{ name: 'Oldest First', value: 'ASC' },
						],
						default: 'DESC',
						description: 'Sort order of results',
					},
				],
			},

			// ====== CHAT operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['chat'] } },
				options: [
					{ name: 'List Chats', value: 'listChats', action: 'List chats', description: 'Retrieve a list of conversations' },
					{ name: 'Create Chat', value: 'createChat', action: 'Create a chat', description: 'Start a new conversation' },
					{ name: 'Mark Chat Read', value: 'markChatRead', action: 'Mark a chat as read', description: 'Mark all messages in a chat as read' },
					{ name: 'Start Typing', value: 'startTyping', action: 'Start typing indicator', description: 'Show the typing indicator in a chat' },
					{ name: 'Stop Typing', value: 'stopTyping', action: 'Stop typing indicator', description: 'Hide the typing indicator in a chat' },
				],
				default: 'listChats',
			},
			// --- List Chats fields ---
			{
				displayName: 'Additional Fields',
				name: 'listChatsAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['chat'], operation: ['listChats'] } },
				options: [
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 20,
						description: 'Max number of chats to return',
					},
					{
						displayName: 'Include Last Message',
						name: 'withLastMessage',
						type: 'boolean',
						default: true,
						description: 'Whether to include the last message in each chat',
					},
				],
			},
			// --- Create Chat fields ---
			{
				displayName: 'Phone Numbers',
				name: 'phoneNumbers',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+1234567890,+0987654321',
				description: 'Comma-separated phone numbers or email addresses for the chat participants',
				displayOptions: { show: { resource: ['chat'], operation: ['createChat'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'createChatAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['chat'], operation: ['createChat'] } },
				options: [
					{
						displayName: 'Initial Message',
						name: 'message',
						type: 'string',
						default: '',
						description: 'An optional first message to send when creating the chat',
					},
					{
						displayName: 'Service',
						name: 'service',
						type: 'options',
						options: [
							{ name: 'iMessage', value: 'iMessage' },
							{ name: 'SMS', value: 'SMS' },
						],
						default: 'iMessage',
						description: 'The messaging service to use',
					},
				],
			},
			// --- Mark Chat Read fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier to mark as read',
				displayOptions: { show: { resource: ['chat'], operation: ['markChatRead'] } },
			},

			// --- Start/Stop Typing fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier to show typing in',
				displayOptions: { show: { resource: ['chat'], operation: ['startTyping', 'stopTyping'] } },
			},

			// ====== SCHEDULED MESSAGE operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['scheduledMessage'] } },
				options: [
					{ name: 'Create Scheduled Message', value: 'createScheduledMessage', action: 'Create a scheduled message', description: 'Schedule a message to be sent later' },
					{ name: 'List Scheduled Messages', value: 'listScheduledMessages', action: 'List scheduled messages', description: 'Get all scheduled messages' },
					{ name: 'Delete Scheduled Message', value: 'deleteScheduledMessage', action: 'Delete a scheduled message', description: 'Remove a scheduled message' },
				],
				default: 'createScheduledMessage',
			},
			// --- Create Scheduled Message fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The text content of the scheduled message',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Send At',
				name: 'sendAt',
				type: 'dateTime',
				required: true,
				default: '',
				description: 'When to send the message',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Schedule Type',
				name: 'scheduleType',
				type: 'options',
				options: [
					{ name: 'Once', value: 'once' },
					{ name: 'Hourly', value: 'hourly' },
					{ name: 'Daily', value: 'daily' },
					{ name: 'Weekly', value: 'weekly' },
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'Yearly', value: 'yearly' },
				],
				default: 'once',
				description: 'How often to send the message',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			// --- Delete Scheduled Message fields ---
			{
				displayName: 'Scheduled Message ID',
				name: 'scheduledMessageId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID of the scheduled message to delete',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['deleteScheduledMessage'] } },
			},

			// ====== POLL operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['poll'] } },
				options: [
					{ name: 'Create Poll', value: 'createPoll', action: 'Create a poll', description: 'Create an interactive poll in a chat' },
					{ name: 'Vote', value: 'vote', action: 'Vote on a poll', description: 'Vote on a poll option' },
					{ name: 'Unvote', value: 'unvote', action: 'Remove vote from a poll', description: 'Remove your vote from a poll option' },
					{ name: 'Add Option', value: 'addOption', action: 'Add a poll option', description: 'Add a new option to an existing poll' },
				],
				default: 'createPoll',
			},
			// --- Create Poll fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier to create the poll in',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			{
				displayName: 'Options',
				name: 'pollOptions',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Option A, Option B, Option C',
				description: 'Comma-separated list of poll options',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			{
				displayName: 'Title',
				name: 'pollTitle',
				type: 'string',
				default: '',
				description: 'Optional title for the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			// --- Vote / Unvote fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier containing the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			{
				displayName: 'Poll Message GUID',
				name: 'pollMessageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the poll message',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			{
				displayName: 'Option Identifier',
				name: 'optionIdentifier',
				type: 'string',
				required: true,
				default: '',
				description: 'UUID of the poll option to vote on or unvote from',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			// --- Add Option fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat identifier containing the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['addOption'] } },
			},
			{
				displayName: 'Poll Message GUID',
				name: 'pollMessageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'GUID of the poll message to add the option to',
				displayOptions: { show: { resource: ['poll'], operation: ['addOption'] } },
			},
			{
				displayName: 'Option Text',
				name: 'optionText',
				type: 'string',
				required: true,
				default: '',
				description: 'Text for the new poll option',
				displayOptions: { show: { resource: ['poll'], operation: ['addOption'] } },
			},

			// ====== CONTACT operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{ name: 'Share Contact Card', value: 'shareContactCard', action: 'Share your contact card', description: 'Share your Name and Photo contact card in a chat' },
				],
				default: 'shareContactCard',
			},
			// --- Share Contact Card fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'The chat to share your contact card in',
				displayOptions: { show: { resource: ['contact'], operation: ['shareContactCard'] } },
			},

			// ====== HANDLE operations ======
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['handle'] } },
				options: [
					{ name: 'Check iMessage Availability', value: 'checkAvailability', action: 'Check i message availability', description: 'Check if a phone number or email supports iMessage' },
				],
				default: 'checkAvailability',
			},
			// --- Check Availability fields ---
			{
				displayName: 'Phone or Email',
				name: 'address',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+1234567890',
				description: 'The phone number or email address to check',
				displayOptions: { show: { resource: ['handle'], operation: ['checkAvailability'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('photonIMessageApi');
		const baseUrl = (credentials.serverUrl as string).replace(/\/+$/, '');

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: unknown;

				// ===== MESSAGE =====
				if (resource === 'message') {
					if (operation === 'sendMessage') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const message = this.getNodeParameter('message', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as {
							method?: string;
							subject?: string;
							effectId?: string;
							selectedMessageGuid?: string;
						};

						const body: Record<string, unknown> = {
							chatGuid,
							message,
							tempGuid: generateTempGuid(),
							method: additionalFields.method || 'apple-script',
						};
						if (additionalFields.subject) body.subject = additionalFields.subject;
						if (additionalFields.effectId) body.effectId = additionalFields.effectId;
						if (additionalFields.selectedMessageGuid) body.selectedMessageGuid = additionalFields.selectedMessageGuid;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/text`,
							body,
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'sendAttachment') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const filePath = this.getNodeParameter('filePath', i) as string;
						const additionalFields = this.getNodeParameter('attachmentAdditionalFields', i) as {
							fileName?: string;
							isAudioMessage?: boolean;
						};

						const body: Record<string, unknown> = {
							chatGuid,
							filePath,
						};
						if (additionalFields.fileName) body.name = additionalFields.fileName;
						if (additionalFields.isAudioMessage) body.isAudioMessage = additionalFields.isAudioMessage;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/attachment`,
							body,
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'unsendMessage') {
						const messageGuid = this.getNodeParameter('messageGuid', i) as string;
						const partIndex = this.getNodeParameter('unsendPartIndex', i, 0) as number;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/${encodeURIComponent(messageGuid)}/unsend`,
							body: { partIndex },
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'editMessage') {
						const messageGuid = this.getNodeParameter('messageGuid', i) as string;
						const editedMessage = this.getNodeParameter('editedMessage', i) as string;
						const partIndex = this.getNodeParameter('editPartIndex', i, 0) as number;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/${encodeURIComponent(messageGuid)}/edit`,
							body: {
								editedMessage,
								backwardsCompatibilityMessage: editedMessage,
								partIndex,
							},
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'downloadAttachment') {
						const attachmentGuid = this.getNodeParameter('attachmentGuid', i) as string;
						const additionalFields = this.getNodeParameter('downloadAdditionalFields', i) as {
							width?: number;
							height?: number;
							quality?: number;
						};

						const qs: IDataObject = {};
						if (additionalFields.width) qs.width = additionalFields.width;
						if (additionalFields.height) qs.height = additionalFields.height;
						if (additionalFields.quality) qs.quality = additionalFields.quality;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'GET' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/attachment/${encodeURIComponent(attachmentGuid)}/download`,
							qs,
							json: true,
							encoding: 'arraybuffer',
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'reactToMessage') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const messageGuid = this.getNodeParameter('messageGuid', i) as string;
						const reaction = this.getNodeParameter('reaction', i) as string;
						const partIndex = this.getNodeParameter('partIndex', i, 0) as number;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/react`,
							body: {
								chatGuid,
								selectedMessageGuid: messageGuid,
								reaction,
								partIndex,
							},
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'searchMessages') {
						const query = this.getNodeParameter('query', i) as string;
						const additionalFields = this.getNodeParameter('searchAdditionalFields', i) as {
							chatGuid?: string;
							limit?: number;
							sort?: string;
						};

						const body: Record<string, unknown> = {
							where: [
								{
									statement: 'message.text LIKE :text',
									args: { text: `%${query}%` },
								},
							],
							limit: additionalFields.limit ?? 20,
							sort: additionalFields.sort ?? 'DESC',
						};
						if (additionalFields.chatGuid) body.chatGuid = additionalFields.chatGuid;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/query`,
							body,
							json: true,
						});

						const messages = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
						if (Array.isArray(messages)) {
							for (const msg of messages) {
								returnData.push({
									json: {
										guid: msg.guid,
										text: msg.text,
										sender: (msg.handle as Record<string, unknown>)?.address ?? null,
										dateCreated: msg.dateCreated,
										isFromMe: msg.isFromMe,
									},
								});
							}
							continue;
						}
						responseData = messages;

					} else if (operation === 'getMessages') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const additionalFields = this.getNodeParameter('getMessagesAdditionalFields', i) as {
							limit?: number;
							after?: string;
							before?: string;
							sort?: string;
						};

						const body: Record<string, unknown> = {
							chatGuid,
							limit: additionalFields.limit ?? 20,
							sort: additionalFields.sort ?? 'DESC',
						};
						if (additionalFields.after) {
							const afterTime = new Date(additionalFields.after as string).getTime();
							if (!Number.isNaN(afterTime)) body.after = afterTime;
						}
						if (additionalFields.before) {
							const beforeTime = new Date(additionalFields.before as string).getTime();
							if (!Number.isNaN(beforeTime)) body.before = beforeTime;
						}

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/query`,
							body,
							json: true,
						});

						const messages = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
						if (Array.isArray(messages)) {
							for (const msg of messages) {
								returnData.push({
									json: {
										guid: msg.guid,
										text: msg.text,
										sender: (msg.handle as Record<string, unknown>)?.address ?? null,
										dateCreated: msg.dateCreated,
										isFromMe: msg.isFromMe,
									},
								});
							}
							continue;
						}
						responseData = messages;
					}

				// ===== CHAT =====
				} else if (resource === 'chat') {
					if (operation === 'listChats') {
						const additionalFields = this.getNodeParameter('listChatsAdditionalFields', i) as {
							limit?: number;
							withLastMessage?: boolean;
						};

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/query`,
							body: {
								limit: additionalFields.limit ?? 20,
								withLastMessage: additionalFields.withLastMessage !== false,
							},
							json: true,
						});

						const chats = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
						if (Array.isArray(chats)) {
							for (const chat of chats) {
								const lastMessage = chat.lastMessage as Record<string, unknown> | undefined;
								returnData.push({
									json: {
										guid: chat.guid,
										displayName: chat.displayName,
										lastMessageText: lastMessage?.text ?? null,
										lastMessageDate: lastMessage?.dateCreated ?? null,
									},
								});
							}
							continue;
						}
						responseData = chats;

					} else if (operation === 'createChat') {
						const phoneNumbers = this.getNodeParameter('phoneNumbers', i) as string;
						const additionalFields = this.getNodeParameter('createChatAdditionalFields', i) as {
							message?: string;
							service?: string;
						};

						const body: Record<string, unknown> = {
							addresses: phoneNumbers.split(',').map((s) => s.trim()),
							service: additionalFields.service || 'iMessage',
							method: 'private-api',
						};
						if (additionalFields.message) body.message = additionalFields.message;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/new`,
							body,
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'markChatRead') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/${encodeURIComponent(chatGuid)}/read`,
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'startTyping') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;

						await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/${encodeURIComponent(chatGuid)}/typing`,
							json: true,
						});
						responseData = { typing: true, chatGuid };

					} else if (operation === 'stopTyping') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;

						await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'DELETE' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/${encodeURIComponent(chatGuid)}/typing`,
							json: true,
						});
						responseData = { typing: false, chatGuid };
					}

				// ===== SCHEDULED MESSAGE =====
				} else if (resource === 'scheduledMessage') {
					if (operation === 'createScheduledMessage') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const message = this.getNodeParameter('message', i) as string;
						const sendAt = this.getNodeParameter('sendAt', i) as string;
						const scheduleType = this.getNodeParameter('scheduleType', i) as string;

						const schedule: Record<string, unknown> = { type: scheduleType };
						if (scheduleType !== 'once') {
							schedule.type = 'recurring';
							schedule.intervalType = scheduleType;
							schedule.interval = 1;
						}

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/schedule`,
							body: {
								type: 'send-message',
								payload: {
									chatGuid,
									message,
									method: 'apple-script',
								},
								scheduledFor: new Date(sendAt).getTime(),
								schedule,
							},
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'listScheduledMessages') {
						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'GET' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/schedule`,
							json: true,
						});

						const schedules = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
						if (Array.isArray(schedules)) {
							for (const sched of schedules) {
								const payload = sched.payload as Record<string, unknown> | undefined;
								const scheduleInfo = sched.schedule as Record<string, unknown> | undefined;
								returnData.push({
									json: {
										id: sched.id,
										message: payload?.message ?? null,
										chatGuid: payload?.chatGuid ?? null,
										scheduledFor: sched.scheduledFor,
										scheduleType: scheduleInfo?.type ?? null,
									},
								});
							}
							continue;
						}
						responseData = schedules;

					} else if (operation === 'deleteScheduledMessage') {
						const scheduledMessageId = this.getNodeParameter('scheduledMessageId', i) as string;

						await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'DELETE' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/schedule/${encodeURIComponent(scheduledMessageId)}`,
							json: true,
						});
						responseData = { deleted: true };
					}

				// ===== POLL =====
				} else if (resource === 'poll') {
					if (operation === 'createPoll') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const pollOptions = this.getNodeParameter('pollOptions', i) as string;
						const pollTitle = this.getNodeParameter('pollTitle', i, '') as string;

						const body: Record<string, unknown> = {
							chatGuid,
							options: pollOptions.split(',').map((s) => s.trim()).filter(Boolean),
						};
						if (pollTitle) body.title = pollTitle;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/poll/create`,
							body,
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'vote') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const pollMessageGuid = this.getNodeParameter('pollMessageGuid', i) as string;
						const optionIdentifier = this.getNodeParameter('optionIdentifier', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/poll/vote`,
							body: { chatGuid, pollMessageGuid, optionIdentifier },
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'unvote') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const pollMessageGuid = this.getNodeParameter('pollMessageGuid', i) as string;
						const optionIdentifier = this.getNodeParameter('optionIdentifier', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/poll/unvote`,
							body: { chatGuid, pollMessageGuid, optionIdentifier },
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;

					} else if (operation === 'addOption') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const pollMessageGuid = this.getNodeParameter('pollMessageGuid', i) as string;
						const optionText = this.getNodeParameter('optionText', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/message/poll/add-option`,
							body: { chatGuid, pollMessageGuid, optionText },
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;
					}

				// ===== CONTACT =====
				} else if (resource === 'contact') {
					if (operation === 'shareContactCard') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/contact/share`,
							body: { chatGuid },
							json: true,
						});
						responseData = (response as { data?: unknown }).data ?? response;
					}

				// ===== HANDLE =====
				} else if (resource === 'handle') {
					if (operation === 'checkAvailability') {
						const address = this.getNodeParameter('address', i) as string;

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'GET' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/handle/availability/imessage`,
							qs: { address },
							json: true,
						});
						const availData = response as IDataObject;
						responseData = {
							address,
							available: !!availData.data,
						};
					}
				}

				if (responseData !== undefined) {
					returnData.push({
						json: responseData as IDataObject,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
