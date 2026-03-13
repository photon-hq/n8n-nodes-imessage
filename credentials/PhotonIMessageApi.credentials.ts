import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PhotonIMessageApi implements ICredentialType {
	name = 'photonIMessageApi';
	displayName = 'iMessage by Photon API';
	icon = { light: 'file:../nodes/PhotonIMessage/Dark.svg', dark: 'file:../nodes/PhotonIMessage/Dark.svg' } as const;
	documentationUrl = 'https://github.com/photon-hq/advanced-imessage-kit';
	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: '',
			placeholder: 'https://example.imsgd.photon.codes',
			description: 'Base URL of your Photon iMessage server (e.g. https://abc123.imsgd.photon.codes). No trailing slash.',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'API key for authenticating with the Photon server',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.serverUrl}}',
			url: '/api/v1/server/info',
			method: 'GET',
		},
	};
}
