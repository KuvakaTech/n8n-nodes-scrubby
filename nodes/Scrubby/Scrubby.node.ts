import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { deepResultRows, quickResultRows, scrubbyRequest, toEmails } from './GenericFunctions';

const POLL_INTERVAL_MS = 10_000;

export class Scrubby implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scrubby',
		name: 'scrubby',
		icon: { light: 'file:scrubby.svg', dark: 'file:scrubby.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Verify email addresses and check deliverability with Scrubby',
		defaults: {
			name: 'Scrubby',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'scrubbyApi',
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
					{ name: 'Bulk Verification', value: 'bulk' },
					{ name: 'Email', value: 'email' },
				],
				default: 'email',
			},

			// ----- Email -----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Verify',
						value: 'verify',
						description: 'Verify one email address',
						action: 'Verify an email address',
					},
				],
				default: 'verify',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@example.com',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['email'], operation: ['verify'] } },
				description: 'The email address to verify',
			},

			// ----- Bulk -----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['bulk'] } },
				options: [
					{
						name: 'Get Results',
						value: 'getResults',
						description: 'Fetch the results of a verification job, one item per email',
						action: 'Get verification results',
					},
					{
						name: 'Start',
						value: 'start',
						description: 'Start verifying a list of emails and get a job identifier',
						action: 'Start a bulk verification',
					},
				],
				default: 'start',
			},
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				required: true,
				// Resolved once for all input items, so a whole list becomes a single job.
				default: '={{ $input.all().map((item) => item.json.email).join(",") }}',
				displayOptions: { show: { resource: ['bulk'], operation: ['start'] } },
				description:
					'Comma- or newline-separated list of emails, or an expression returning an array. The node runs once for all input items; by default it collects the "email" field of every input item.',
			},
			{
				displayName: 'Job Identifier',
				name: 'identifier',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['bulk'], operation: ['getResults'] } },
				description: 'The identifier returned by Start, or by Verify with the Deep type',
			},

			// ----- Shared -----
			{
				displayName: 'Verification Type',
				name: 'verificationType',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['email', 'bulk'],
						operation: ['verify', 'start', 'getResults'],
					},
				},
				options: [
					{
						name: 'Quick',
						value: 'quick',
						description: 'Fast check, costs 1 credit per email',
					},
					{
						name: 'Deep',
						value: 'deep',
						description:
							'Thorough check, costs more credits. Results arrive in stages over about 72 hours.',
					},
				],
				default: 'quick',
				description:
					'Deep verification always returns a job identifier. Collect its results later with Bulk Verification → Get Results (Deep).',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: { resource: ['bulk'], operation: ['getResults'], verificationType: ['quick'] },
				},
				description: 'Whether to keep checking until the job is complete, up to the timeout',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				typeOptions: { minValue: 10, maxValue: 600 },
				default: 120,
				displayOptions: {
					show: {
						resource: ['bulk'],
						operation: ['getResults'],
						verificationType: ['quick'],
						waitForCompletion: [true],
					},
				},
				description: 'How long to wait before returning the results found so far',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		// Starting a job runs once for the whole input so a list becomes one job, not one job per item.
		if (resource === 'bulk' && operation === 'start') {
			try {
				const type = this.getNodeParameter('verificationType', 0) as string;
				const emails = toEmails(this.getNodeParameter('emails', 0));
				if (!emails.length) {
					throw new NodeOperationError(this.getNode(), 'Provide at least one email address');
				}
				const response = await scrubbyRequest.call(
					this,
					type === 'deep' ? '/validate_bulk_emails/deep' : '/validate_bulk_emails',
					{ email: emails },
				);
				returnData.push({
					json: response,
					pairedItem: items.map((_, item) => ({ item })),
				});
			} catch (error) {
				if (!this.continueOnFail()) throw new NodeOperationError(this.getNode(), error as Error);
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: items.map((_, item) => ({ item })),
				});
			}
			return [returnData];
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const type = this.getNodeParameter('verificationType', i) as string;
				let rows: IDataObject[];

				if (resource === 'email') {
					const email = (this.getNodeParameter('email', i) as string).trim().toLowerCase();
					// The API has no single-email deep endpoint, so deep is a bulk job of one address.
					rows =
						type === 'deep'
							? [await scrubbyRequest.call(this, '/validate_bulk_emails/deep', { email: [email] })]
							: [await scrubbyRequest.call(this, '/validate_email', { email })];
				} else {
					const identifier = (this.getNodeParameter('identifier', i) as string).trim();
					const endpoint = type === 'deep' ? '/fetch_bulk_results/deep' : '/fetch_bulk_results';
					const toRows = type === 'deep' ? deepResultRows : quickResultRows;

					let data = await scrubbyRequest.call(this, endpoint, { identifier });
					if (type === 'quick' && (this.getNodeParameter('waitForCompletion', i) as boolean)) {
						const deadline = Date.now() + (this.getNodeParameter('timeout', i) as number) * 1000;
						while (data.status !== 'completed' && Date.now() + POLL_INTERVAL_MS < deadline) {
							await sleep(POLL_INTERVAL_MS);
							data = await scrubbyRequest.call(this, endpoint, { identifier });
						}
					}
					rows = toRows(data);
				}

				for (const json of rows) {
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Returns an existing NodeApiError / NodeOperationError as is, adding the item index.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
