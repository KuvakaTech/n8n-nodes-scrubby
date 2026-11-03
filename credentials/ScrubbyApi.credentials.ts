import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ScrubbyApi implements ICredentialType {
	name = 'scrubbyApi';

	displayName = 'Scrubby API';

	icon = 'file:../nodes/Scrubby/scrubby.svg' as const;

	documentationUrl = 'https://github.com/KuvakaTech/n8n-nodes-scrubby#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Scrubby API key, found in your Scrubby account',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.scrubby.io',
			description: 'Only change this to point at a different Scrubby environment',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Api-Key {{$credentials.apiKey}}',
			},
		},
	};

	// Free call: spends no credits.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/auth/details/',
			method: 'GET',
		},
	};
}
