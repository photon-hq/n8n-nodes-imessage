import type {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class PhotonIMessageTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Photon iMessage Trigger',
		name: 'photonIMessageTrigger',
		icon: 'file:photon-imessage.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=New iMessage received',
		description: 'Triggers when a new iMessage is received on the Photon server',
		defaults: {
			name: 'Photon iMessage Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'photonIMessageApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Chat GUID',
				name: 'chatGuid',
				type: 'string',
				default: '',
				placeholder: 'iMessage;-;+1234567890',
				description: 'Only trigger for messages in this chat (leave blank for all chats)',
			},
			{
				displayName: 'Include Sent Messages',
				name: 'includeSent',
				type: 'boolean',
				default: false,
				description: 'Whether to include messages you sent (isFromMe = true)',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('photonIMessageApi');
		const baseUrl = (credentials.serverUrl as string).replace(/\/+$/, '');
		const chatGuid = this.getNodeParameter('chatGuid') as string;
		const includeSent = this.getNodeParameter('includeSent') as boolean;

		const staticData = this.getWorkflowStaticData('node') as { lastChecked?: number };

		if (!staticData.lastChecked) {
			staticData.lastChecked = Date.now();
			return null;
		}

		const body: Record<string, unknown> = {
			after: staticData.lastChecked,
			sort: 'ASC',
			limit: 100,
		};
		if (chatGuid) {
			body.chatGuid = chatGuid;
		}

		const response = await this.helpers.httpRequestWithAuthentication.call(this, 'photonIMessageApi', {
			method: 'POST' as IHttpRequestMethods,
			url: `${baseUrl}/api/v1/message/query`,
			body,
			json: true,
		});

		const rawMessages = (response as { data?: Array<Record<string, unknown>> }).data ?? response;
		if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
			return null;
		}

		let messages = rawMessages;
		if (!includeSent) {
			messages = messages.filter((msg) => !msg.isFromMe);
		}

		const newestDate = rawMessages.reduce((max, msg) => {
			const d = msg.dateCreated as number | undefined;
			return d && d > max ? d : max;
		}, staticData.lastChecked);
		staticData.lastChecked = newestDate;

		if (messages.length === 0) {
			return null;
		}

		const returnData: INodeExecutionData[] = messages.map((msg) => {
			const handle = msg.handle as Record<string, unknown> | undefined;
			const chats = msg.chats as Array<Record<string, unknown>> | undefined;
			const attachments = msg.attachments as unknown[] | undefined;

			return {
				json: {
					id: msg.guid,
					guid: msg.guid,
					text: msg.text,
					sender: handle?.address ?? null,
					chatGuid: chats?.[0]?.guid ?? null,
					dateCreated: msg.dateCreated,
					isFromMe: msg.isFromMe,
					hasAttachments: Array.isArray(attachments) && attachments.length > 0,
				},
			};
		});

		return [returnData];
	}
}
