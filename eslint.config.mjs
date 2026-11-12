import { config } from '@n8n/node-cli/eslint';

export default [
	...config,
	{
		files: ['package.json'],
		rules: {
			'n8n-nodes-base/community-package-json-license-not-default': 'off',
		},
	},
];
