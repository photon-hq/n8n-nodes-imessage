import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { ApplicationError, NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { getSpectrumCredentials } from './lib/credentials';
import { getProjectLineOptions, resolveLinePhone } from './lib/lines';
import { isDeliverabilityError, throwDeliverabilityError } from './lib/outboundErrors';
import { assertPhoneRecipients } from './lib/recipients';
import { withSpectrum, type SpectrumSession } from './lib/spectrumClient';

const OPERATION_LABELS: Record<string, string> = {
	startTyping: 'Start Typing',
	stopTyping: 'Stop Typing',
};

interface ResolvedSpace {
	id: string;
	phone?: string;
	startTyping: () => Promise<void>;
	stopTyping: () => Promise<void>;
}

function splitAddresses(raw: string): string[] {
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function withLineMeta(result: IDataObject, space: ResolvedSpace): IDataObject {
	const linePhone = space.phone && space.phone !== 'shared' ? space.phone : undefined;
	return linePhone ? { ...result, linePhone } : result;
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
	assertPhoneRecipients(recipients);
	const users = await Promise.all(recipients.map((r) => im.user(r)));
	const args: unknown[] = [...users];
	if (fromPhone) args.push({ phone: fromPhone });
	return (await im.space(...args)) as ResolvedSpace;
}

export class PhotonIMessageTyping implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'iMessage Typing Indicator by Photon',
		name: 'photonIMessageTyping',
		icon: 'file:Dark.svg',
		group: ['output'],
		version: 1,
		subtitle: `={{ (${JSON.stringify(OPERATION_LABELS)})[$parameter.operation] || 'Typing Indicator' }}`,
		description: 'Start or stop the typing indicator in a thread',
		defaults: { name: 'Typing Indicator' },
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
				displayName: 'Action',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Start Typing', value: 'startTyping', action: 'Start typing' },
					{ name: 'Stop Typing', value: 'stopTyping', action: 'Stop typing' },
				],
				default: 'startTyping',
			},
			{
				displayName: 'Send From Line Name or ID',
				name: 'sendFromLine',
				type: 'options',
				noDataExpression: false,
				typeOptions: {
					loadOptionsMethod: 'getProjectLines',
				},
				default: '={{ $json.linePhone || $credentials.primaryLineNumber }}',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: {
					show: {
						'/credentials.photonSpectrumApi.lineMode': ['dedicated'],
					},
				},
			},
			{
				displayName: 'Thread With',
				name: 'recipients',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15551234567',
				description:
					'Phone number in E.164 format (+15551234567). Apple ID emails are not supported.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getProjectLines(this: ILoadOptionsFunctions) {
				return getProjectLineOptions(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await getSpectrumCredentials(this);

		await withSpectrum(credentials, async (session) => {
			for (let i = 0; i < items.length; i++) {
				try {
					const operation = this.getNodeParameter('operation', i) as 'startTyping' | 'stopTyping';
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
	operation: 'startTyping' | 'stopTyping',
	i: number,
): Promise<IDataObject> {
	const im = session.imessage(session.app);
	const recipients = splitAddresses(ctx.getNodeParameter('recipients', i, '') as string);
	const fromPhone = await resolveLinePhone(ctx, i, operation);
	const space = await resolveSpace(im, recipients, fromPhone);

	if (operation === 'startTyping') {
		await space.startTyping();
	} else {
		await space.stopTyping();
	}

	return withLineMeta(
		{
			success: true,
			spaceId: space.id,
			typing: operation === 'startTyping' ? 'start' : 'stop',
		},
		space,
	);
}
