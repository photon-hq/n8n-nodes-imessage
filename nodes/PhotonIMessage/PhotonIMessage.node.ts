import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
	IDataObject,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

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
		displayName: 'iMessage by Photon',
		name: 'photonIMessage',
		icon: 'file:Dark.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{{"sendMessage":"Send Message","sendAttachment":"Send Attachment","unsendMessage":"Unsend Message","editMessage":"Edit Message","reactToMessage":"React to Message","downloadAttachment":"Download Attachment","searchMessages":"Search Messages","getMessages":"Get Messages","listChats":"List Chats","createChat":"Create Chat","markChatRead":"Mark Chat Read","startTyping":"Start Typing","stopTyping":"Stop Typing","createScheduledMessage":"Schedule Message","listScheduledMessages":"List Scheduled","deleteScheduledMessage":"Delete Scheduled","createPoll":"Create Poll","vote":"Vote on Poll","unvote":"Unvote on Poll","addOption":"Add Poll Option","shareContactCard":"Share Contact Card","checkAvailability":"Check iMessage Availability"}[$parameter["operation"]] || $parameter["operation"]}}',
		description: 'Send, search, and manage iMessage conversations via the Photon server',
		defaults: {
			name: 'iMessage by Photon',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
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
					{ name: 'Chat', value: 'chat', description: 'Create and manage conversations' },
					{ name: 'Contact', value: 'contact', description: 'Share contact cards' },
					{ name: 'Handle', value: 'handle', description: 'Check iMessage availability' },
					{ name: 'Message', value: 'message', description: 'Send, search, and manage messages' },
					{ name: 'Poll', value: 'poll', description: 'Create and manage polls in chats' },
					{ name: 'Scheduled Message', value: 'scheduledMessage', description: 'Schedule messages for later delivery' },
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
					{ name: 'Download Attachment', value: 'downloadAttachment', action: 'Download an attachment', description: 'Download a received file or media attachment' },
					{ name: 'Edit Message', value: 'editMessage', action: 'Edit a message', description: 'Edit the text of a previously sent message' },
					{ name: 'Get Messages', value: 'getMessages', action: 'Get messages', description: 'Retrieve messages from a chat' },
					{ name: 'React to Message', value: 'reactToMessage', action: 'React to a message', description: 'Send a tapback reaction (love, like, laugh, etc.)' },
					{ name: 'Search Messages', value: 'searchMessages', action: 'Search messages', description: 'Search messages by text content across chats' },
					{ name: 'Send Attachment', value: 'sendAttachment', action: 'Send an attachment', description: 'Send a file attachment to a chat' },
					{ name: 'Send Message', value: 'sendMessage', action: 'Send a message', description: 'Send a text message to a chat' },
					{ name: 'Unsend Message', value: 'unsendMessage', action: 'Unsend a message', description: 'Retract a sent message (recipients will see it was unsent)' },
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" or "Create Chat" operation to find this value.',
				displayOptions: { show: { resource: ['message'], operation: ['sendMessage'] } },
			},
			{
				displayName: 'Message Text',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'Hello! How are you?',
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
						displayName: 'Effect',
						name: 'effectId',
						type: 'options',
						options: [
							{ name: 'Balloons', value: 'com.apple.messages.effect.CKBalloonEffect', description: 'Screen: floating balloons' },
							{ name: 'Confetti', value: 'com.apple.messages.effect.CKConfettiEffect', description: 'Screen: confetti celebration' },
							{ name: 'Echo', value: 'com.apple.messages.effect.CKEchoEffect', description: 'Screen: message multiplies' },
							{ name: 'Fireworks', value: 'com.apple.messages.effect.CKFireworksEffect', description: 'Screen: fireworks display' },
							{ name: 'Gentle', value: 'com.apple.MobileSMS.expressivesend.gentle', description: 'Bubble: gentle send animation' },
							{ name: 'Hearts', value: 'com.apple.messages.effect.CKHeartEffect', description: 'Screen: floating hearts' },
							{ name: 'Invisible Ink', value: 'com.apple.MobileSMS.expressivesend.invisibleink', description: 'Bubble: hidden until swiped' },
							{ name: 'Lasers', value: 'com.apple.messages.effect.CKHappyBirthdayEffect', description: 'Screen: laser light show' },
							{ name: 'Loud', value: 'com.apple.MobileSMS.expressivesend.loud', description: 'Bubble: grows large with shake' },
							{ name: 'None', value: '', description: 'No special effect' },
							{ name: 'Shooting Star', value: 'com.apple.messages.effect.CKShootingStarEffect', description: 'Screen: shooting star streak' },
							{ name: 'Slam', value: 'com.apple.MobileSMS.expressivesend.impact', description: 'Bubble: slams onto screen' },
							{ name: 'Sparkles', value: 'com.apple.messages.effect.CKSparklesEffect', description: 'Screen: sparkle animation' },
							{ name: 'Spotlight', value: 'com.apple.messages.effect.CKSpotlightEffect', description: 'Screen: spotlight on message' },
						],
						default: '',
						description: 'IMessage effect to send with the message. Bubble effects animate the message itself; Screen effects animate the full screen.',
					},
					{
						displayName: 'Reply to Message GUID',
						name: 'selectedMessageGuid',
						type: 'string',
						default: '',
						placeholder: 'e.g. p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
						description: 'GUID of a message to reply to as an inline thread',
					},
					{
						displayName: 'Subject',
						name: 'subject',
						type: 'string',
						default: '',
						description: 'Optional subject line (shown as bold header in the message)',
					},
					{
						displayName: 'Send Method',
						name: 'method',
						type: 'options',
						options: [
							{ name: 'Private API (Recommended)', value: 'private-api' },
							{ name: 'AppleScript (Fallback)', value: 'apple-script' },
						],
						default: 'private-api',
						description: 'How to send the message. Private API supports all features; AppleScript is a fallback if Private API is unavailable.',
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" or "Create Chat" operation to find this value.',
				displayOptions: { show: { resource: ['message'], operation: ['sendAttachment'] } },
			},
			{
				displayName: 'File Path',
				name: 'filePath',
				type: 'string',
				required: true,
				default: '',
				placeholder: '/Users/you/Desktop/photo.jpg',
				description: 'Absolute file path on the Photon server Mac. The file must exist on the machine running the Photon server.',
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
						placeholder: 'photo.jpg',
						description: 'Override the file name shown to the recipient',
					},
					{
						displayName: 'Send as Voice Message',
						name: 'isAudioMessage',
						type: 'boolean',
						default: false,
						description: 'Whether to send the audio file as an iMessage voice message (plays inline with waveform)',
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" or "Create Chat" operation to find this value.',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Message GUID',
				name: 'messageGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
				description: 'The GUID of the message to react to. Found in the output of "Get Messages" or the trigger node.',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Reaction',
				name: 'reaction',
				type: 'options',
				required: true,
				options: [
					{ name: 'Dislike', value: 'dislike', description: '👎 Thumbs down' },
					{ name: 'Emphasize', value: 'emphasize', description: '‼️ Double exclamation' },
					{ name: 'Laugh', value: 'laugh', description: '😂 Ha ha' },
					{ name: 'Like', value: 'like', description: '👍 Thumbs up' },
					{ name: 'Love', value: 'love', description: '❤️ Heart' },
					{ name: 'Question', value: 'question', description: '❓ Question mark' },
				],
				default: 'love',
				description: 'The tapback reaction to send',
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'reactAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['reactToMessage'] } },
				options: [
					{
						displayName: 'Part Index',
						name: 'partIndex',
						type: 'number',
						default: 0,
						description: 'Which part of the message to react to (0 for the first part). Only needed for multi-part messages.',
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" or "Create Chat" operation to find this value.',
				displayOptions: { show: { resource: ['message'], operation: ['getMessages'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['message'], operation: ['getMessages'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['message'], operation: ['getMessages'], returnAll: [false] } },
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
						displayName: 'After',
						name: 'after',
						type: 'dateTime',
						default: '',
						description: 'Only return messages sent after this date/time',
					},
					{
						displayName: 'Before',
						name: 'before',
						type: 'dateTime',
						default: '',
						description: 'Only return messages sent before this date/time',
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
			// --- Search Messages fields ---
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. dinner tonight',
				description: 'Text to search for in messages',
				displayOptions: { show: { resource: ['message'], operation: ['searchMessages'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['message'], operation: ['searchMessages'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['message'], operation: ['searchMessages'], returnAll: [false] } },
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
						placeholder: 'e.g. iMessage;-;+1234567890',
						description: 'Limit search to a specific chat (leave empty to search all chats)',
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
			// --- Download Attachment fields ---
			{
				displayName: 'Attachment GUID',
				name: 'attachmentGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
				description: 'The GUID of the attachment to download. Found in message data from "Get Messages" or the trigger node.',
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
						displayName: 'Height',
						name: 'height',
						type: 'number',
						default: 0,
						description: 'Resize image to this height in pixels (0 = original size)',
					},
					{
						displayName: 'Quality',
						name: 'quality',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 100 },
						default: 80,
						description: 'JPEG quality (1-100). Only applies to image attachments.',
					},
					{
						displayName: 'Width',
						name: 'width',
						type: 'number',
						default: 0,
						description: 'Resize image to this width in pixels (0 = original size)',
					},
				],
			},
			// --- Edit Message fields ---
			{
				displayName: 'Message GUID',
				name: 'messageGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
				description: 'The GUID of the message to edit. You can only edit messages you sent.',
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
				displayName: 'Additional Fields',
				name: 'editAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['editMessage'] } },
				options: [
					{
						displayName: 'Part Index',
						name: 'editPartIndex',
						type: 'number',
						default: 0,
						description: 'Which part of the message to edit (0 for the first part). Only needed for multi-part messages.',
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
				placeholder: 'e.g. p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
				description: 'The GUID of the message to unsend. You can only unsend messages you sent. Recipients will see "X unsent a message".',
				displayOptions: { show: { resource: ['message'], operation: ['unsendMessage'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'unsendAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['unsendMessage'] } },
				options: [
					{
						displayName: 'Part Index',
						name: 'unsendPartIndex',
						type: 'number',
						default: 0,
						description: 'Which part of the message to unsend (0 for the first part). Only needed for multi-part messages.',
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
					{ name: 'Create Chat', value: 'createChat', action: 'Create a chat', description: 'Start a new conversation with one or more participants' },
					{ name: 'List Chats', value: 'listChats', action: 'List chats', description: 'Retrieve recent conversations with participants and last message' },
					{ name: 'Mark Chat Read', value: 'markChatRead', action: 'Mark a chat as read', description: 'Mark all messages in a chat as read' },
					{ name: 'Start Typing', value: 'startTyping', action: 'Start typing indicator', description: 'Show the typing bubble (…) in a chat' },
					{ name: 'Stop Typing', value: 'stopTyping', action: 'Stop typing indicator', description: 'Hide the typing bubble' },
				],
				default: 'listChats',
			},
			// --- List Chats fields ---
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['chat'], operation: ['listChats'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['chat'], operation: ['listChats'], returnAll: [false] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'listChatsAdditionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['chat'], operation: ['listChats'] } },
				options: [
					{
						displayName: 'Include Last Message',
						name: 'withLastMessage',
						type: 'boolean',
						default: true,
						description: 'Whether to include the last message preview for each chat',
					},
				],
			},
			// --- Create Chat fields ---
			{
				displayName: 'Participants',
				name: 'phoneNumbers',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+1234567890, +0987654321',
				description: 'Comma-separated phone numbers or email addresses. Use one participant for a DM or multiple for a group chat.',
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
						typeOptions: { rows: 3 },
						default: '',
						placeholder: 'Hey! Added you to the group.',
						description: 'Send a message immediately when creating the chat',
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
						description: 'The messaging service to use. SMS is only available for phone numbers.',
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" operation to find this value.',
				displayOptions: { show: { resource: ['chat'], operation: ['markChatRead'] } },
			},

			// --- Start/Stop Typing fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" operation to find this value.',
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
					{ name: 'Create Scheduled Message', value: 'createScheduledMessage', action: 'Create a scheduled message', description: 'Schedule a message to be sent at a future date/time' },
					{ name: 'List Scheduled Messages', value: 'listScheduledMessages', action: 'List scheduled messages', description: 'Get all pending scheduled messages' },
					{ name: 'Delete Scheduled Message', value: 'deleteScheduledMessage', action: 'Delete a scheduled message', description: 'Cancel and remove a scheduled message before it sends' },
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" or "Create Chat" operation to find this value.',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				placeholder: 'Happy birthday! 🎂',
				description: 'The text content of the scheduled message',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Send At',
				name: 'sendAt',
				type: 'dateTime',
				required: true,
				default: '',
				description: 'The date and time when the message should be sent',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			{
				displayName: 'Repeat',
				name: 'scheduleType',
				type: 'options',
				options: [
					{ name: 'Daily', value: 'daily', description: 'Repeat every day at the same time' },
					{ name: 'Hourly', value: 'hourly', description: 'Repeat every hour' },
					{ name: 'Monthly', value: 'monthly', description: 'Repeat every month on the same date' },
					{ name: 'Once (No Repeat)', value: 'once', description: 'Send only once at the scheduled time' },
					{ name: 'Weekly', value: 'weekly', description: 'Repeat every week on the same day' },
					{ name: 'Yearly', value: 'yearly', description: 'Repeat every year on the same date' },
				],
				default: 'once',
				description: 'How often to repeat sending this message',
				displayOptions: { show: { resource: ['scheduledMessage'], operation: ['createScheduledMessage'] } },
			},
			// --- Delete Scheduled Message fields ---
			{
				displayName: 'Scheduled Message ID',
				name: 'scheduledMessageId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID of the scheduled message to delete. Use "List Scheduled Messages" to find this value.',
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
					{ name: 'Create Poll', value: 'createPoll', action: 'Create a poll', description: 'Create an interactive poll in a group chat' },
					{ name: 'Vote', value: 'vote', action: 'Vote on a poll', description: 'Cast a vote on a poll option' },
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
				placeholder: 'e.g. iMessage;+;chat123456',
				hint: 'Polls are typically used in group chats: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" operation to find this value.',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			{
				displayName: 'Poll Question / Title',
				name: 'pollTitle',
				type: 'string',
				default: '',
				placeholder: 'Where should we eat tonight?',
				description: 'The question or title displayed at the top of the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
			},
			{
				displayName: 'Options',
				name: 'pollOptions',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				required: true,
				default: { optionValues: [{ option: '' }, { option: '' }] },
				placeholder: 'Add Option',
				description: 'The choices voters can pick from (minimum 2)',
				displayOptions: { show: { resource: ['poll'], operation: ['createPoll'] } },
				options: [
					{
						displayName: 'Option',
						name: 'optionValues',
						values: [
							{
								displayName: 'Option Text',
								name: 'option',
								type: 'string',
								default: '',
								placeholder: 'e.g. Pizza',
							},
						],
					},
				],
			},
			// --- Vote / Unvote fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. iMessage;+;chat123456',
				description: 'The unique chat identifier containing the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			{
				displayName: 'Poll Message GUID',
				name: 'pollMessageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'The GUID of the poll message. Found in the output of "Create Poll" or "Get Messages".',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			{
				displayName: 'Option Identifier',
				name: 'optionIdentifier',
				type: 'string',
				required: true,
				default: '',
				description: 'The UUID of the poll option to vote on. Found in the poll message data.',
				displayOptions: { show: { resource: ['poll'], operation: ['vote', 'unvote'] } },
			},
			// --- Add Option fields ---
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. iMessage;+;chat123456',
				description: 'The unique chat identifier containing the poll',
				displayOptions: { show: { resource: ['poll'], operation: ['addOption'] } },
			},
			{
				displayName: 'Poll Message GUID',
				name: 'pollMessageGuid',
				type: 'string',
				required: true,
				default: '',
				description: 'The GUID of the poll message. Found in the output of "Create Poll" or "Get Messages".',
				displayOptions: { show: { resource: ['poll'], operation: ['addOption'] } },
			},
			{
				displayName: 'Option Text',
				name: 'optionText',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. Sushi',
				description: 'Text for the new poll option to add',
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
				placeholder: 'e.g. iMessage;-;+1234567890',
				hint: 'DM: iMessage;-;+phone or iMessage;-;email — Group: iMessage;+;chat123456',
				description: 'The unique chat identifier. Use the "List Chats" operation to find this value.',
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
					{ name: 'Check iMessage Availability', value: 'checkAvailability', action: 'Check i message availability', description: 'Check if a phone number or email can receive iMessages' },
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
				placeholder: '+1234567890 or user@example.com',
				description: 'The phone number (with country code) or email address to check for iMessage support',
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

		const normalizeChatGuid = (guid: string): string[] => {
			const parts = guid.split(';');
			if (parts.length === 3) {
				const addr = parts[2];
				const sep = parts[1];
				return [`iMessage;${sep};${addr}`, `any;${sep};${addr}`];
			}
			return [guid];
		};

		const enforceInboundFirstPolicy = async (chatGuid: string, itemIndex: number) => {
			const guids = normalizeChatGuid(chatGuid);
			const guidPlaceholders = guids.map((_, idx) => `:guid${idx}`).join(', ');
			const guidArgs: Record<string, string> = {};
			guids.forEach((g, idx) => { guidArgs[`guid${idx}`] = g; });

			const checkResponse = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
				method: 'POST' as IHttpRequestMethods,
				url: `${baseUrl}/api/v1/message/query`,
				body: {
					where: [
						{ statement: `chat.guid IN (${guidPlaceholders})`, args: guidArgs },
						{ statement: 'message.is_from_me = :fromMe', args: { fromMe: 0 } },
					],
					limit: 1,
					sort: 'DESC',
				},
				json: true,
			});

			const inboundMessages = (checkResponse as { data?: unknown[] }).data;
			if (!Array.isArray(inboundMessages) || inboundMessages.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'Inbound-first policy: this contact has not messaged your number yet. To prevent spam, messages can only be sent to contacts who have initiated a conversation first.',
					{ itemIndex },
				);
			}
		};

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: unknown;

				// ===== MESSAGE =====
				if (resource === 'message') {
				if (operation === 'sendMessage') {
					const chatGuid = this.getNodeParameter('chatGuid', i) as string;
					await enforceInboundFirstPolicy(chatGuid, i);
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
							method: additionalFields.method || 'private-api',
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
					await enforceInboundFirstPolicy(chatGuid, i);
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
						const unsendFields = this.getNodeParameter('unsendAdditionalFields', i, {}) as {
							unsendPartIndex?: number;
						};
						const partIndex = unsendFields.unsendPartIndex ?? 0;

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
						const editFields = this.getNodeParameter('editAdditionalFields', i, {}) as {
							editPartIndex?: number;
						};
						const partIndex = editFields.editPartIndex ?? 0;

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
						const reactFields = this.getNodeParameter('reactAdditionalFields', i, {}) as {
							partIndex?: number;
						};
						const partIndex = reactFields.partIndex ?? 0;

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
						const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
						const limit = returnAll ? 1000 : (this.getNodeParameter('limit', i, 50) as number);
						const additionalFields = this.getNodeParameter('searchAdditionalFields', i) as {
							chatGuid?: string;
							sort?: string;
						};

						const where: Array<{ statement: string; args: Record<string, unknown> }> = [
							{
								statement: 'message.text LIKE :text',
								args: { text: `%${query}%` },
							},
						];
						if (additionalFields.chatGuid) {
							const guids = normalizeChatGuid(additionalFields.chatGuid);
							const guidPlaceholders = guids.map((_, idx) => `:guid${idx}`).join(', ');
							const guidArgs: Record<string, string> = {};
							guids.forEach((g, idx) => { guidArgs[`guid${idx}`] = g; });
							where.push({ statement: `chat.guid IN (${guidPlaceholders})`, args: guidArgs });
						}

						const body: Record<string, unknown> = {
							where,
							limit,
							sort: additionalFields.sort ?? 'DESC',
						};

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
								json: msg as IDataObject,
								pairedItem: { item: i },
							});
						}
						continue;
					}
					responseData = messages;

				} else if (operation === 'getMessages') {
						const chatGuid = this.getNodeParameter('chatGuid', i) as string;
						const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
						const limit = returnAll ? 1000 : (this.getNodeParameter('limit', i, 50) as number);
						const additionalFields = this.getNodeParameter('getMessagesAdditionalFields', i) as {
							after?: string;
							before?: string;
							sort?: string;
						};

						const guids = normalizeChatGuid(chatGuid);
						const guidPlaceholders = guids.map((_, idx) => `:guid${idx}`).join(', ');
						const guidArgs: Record<string, string> = {};
						guids.forEach((g, idx) => { guidArgs[`guid${idx}`] = g; });

						const where: Array<{ statement: string; args: Record<string, unknown> }> = [
							{
								statement: `chat.guid IN (${guidPlaceholders})`,
								args: guidArgs,
							},
						];
						if (additionalFields.after) {
							const afterTime = new Date(additionalFields.after as string).getTime();
							if (!Number.isNaN(afterTime)) {
								where.push({ statement: 'message.date > :after', args: { after: afterTime } });
							}
						}
						if (additionalFields.before) {
							const beforeTime = new Date(additionalFields.before as string).getTime();
							if (!Number.isNaN(beforeTime)) {
								where.push({ statement: 'message.date < :before', args: { before: beforeTime } });
							}
						}

						const body: Record<string, unknown> = {
							where,
							limit,
							sort: additionalFields.sort ?? 'DESC',
							with: ['chat', 'handle', 'attachment'],
						};

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
								json: msg as IDataObject,
								pairedItem: { item: i },
							});
						}
						continue;
					}
					responseData = messages;
				}

			// ===== CHAT =====
				} else if (resource === 'chat') {
					if (operation === 'listChats') {
						const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
						const limit = returnAll ? 1000 : (this.getNodeParameter('limit', i, 50) as number);
						const additionalFields = this.getNodeParameter('listChatsAdditionalFields', i) as {
							withLastMessage?: boolean;
						};

						const withRelations = ['participants'];
						if (additionalFields.withLastMessage !== false) {
							withRelations.push('lastMessage');
						}

						const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
							method: 'POST' as IHttpRequestMethods,
							url: `${baseUrl}/api/v1/chat/query`,
							body: {
								limit,
								with: withRelations,
							},
							json: true,
						});

						const chats = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
						if (Array.isArray(chats)) {
							for (const chat of chats) {
								const participants = chat.participants as Array<Record<string, unknown>> | undefined;
								const isGroup = (chat.style as number) === 43;
								const participantAddresses = participants?.map((p) => p.address as string) ?? [];

							returnData.push({
								json: {
									...chat as IDataObject,
									displayName: (chat.displayName as string) || (isGroup ? 'Group Chat' : participantAddresses[0] ?? ''),
									isGroup,
									participantAddresses,
									participantCount: participantAddresses.length,
								},
								pairedItem: { item: i },
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
					await enforceInboundFirstPolicy(chatGuid, i);
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
									method: 'private-api',
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
							returnData.push({
								json: sched as IDataObject,
								pairedItem: { item: i },
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
						const pollTitle = this.getNodeParameter('pollTitle', i, '') as string;
						const pollOptionsData = this.getNodeParameter('pollOptions', i) as {
							optionValues?: Array<{ option: string }>;
						};
						const options = (pollOptionsData.optionValues ?? [])
							.map((o) => o.option.trim())
							.filter(Boolean);

						const body: Record<string, unknown> = {
							chatGuid,
							options,
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
					pairedItem: { item: i },
				});
				}
			} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}
		}

		return [returnData];
	}
}
