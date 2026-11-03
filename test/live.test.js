'use strict';

// Live tests: run the built node (run `npm run build` first) against the real API with a minimal
// fake n8n context. Needs SCRUBBY_API_KEY in .env or the environment; spends about 2 credits.
// SCRUBBY_TEST_DEEP_ID (optional) is an identifier from an earlier deep job.
const test = require('node:test');
const assert = require('node:assert/strict');

try {
	process.loadEnvFile('.env');
} catch {
	// no .env: the key must already be in the environment
}

const { Scrubby } = require('../dist/nodes/Scrubby/Scrubby.node.js');
const { toEmails } = require('../dist/nodes/Scrubby/GenericFunctions.js');

const baseUrl = process.env.SCRUBBY_BASE_URL || 'https://api.scrubby.io';

function run(params, { inputs = [{ json: {} }], apiKey = process.env.SCRUBBY_API_KEY, continueOnFail = false } = {}) {
	const context = {
		getInputData: () => inputs,
		getNodeParameter: (name, i, fallback) => {
			const value = typeof params[name] === 'function' ? params[name](i) : params[name];
			return value === undefined ? fallback : value;
		},
		getCredentials: async () => ({ apiKey, baseUrl }),
		getNode: () => ({
			id: 'test',
			name: 'Scrubby',
			type: 'n8n-nodes-scrubby.scrubby',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (_credential, options) => {
				const response = await fetch(options.url, {
					method: options.method,
					headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
					body: JSON.stringify(options.body),
				});
				return { statusCode: response.status, body: await response.json().catch(() => ({})) };
			},
		},
	};
	return new Scrubby().execute.call(context).then(([out]) => out.map((item) => item.json));
}

const base = { resource: 'email', operation: 'verify', verificationType: 'quick' };

test('toEmails splits, trims, lowercases and dedupes', () => {
	assert.deepEqual(toEmails(' A@x.com, b@x.com;a@x.com\nC@x.com '), ['a@x.com', 'b@x.com', 'c@x.com']);
	assert.deepEqual(toEmails(['A@x.com', 'a@x.com']), ['a@x.com']);
	assert.deepEqual(toEmails(undefined), []);
});

test('quick single verify returns the verdict', async () => {
	const [row] = await run({ ...base, email: ' Test@Gmail.com ' });
	assert.equal(row.email, 'test@gmail.com');
	assert.ok(row.status);
	assert.notEqual(row.remaining_credits, undefined);
});

test('invalid email surfaces the API message', async () => {
	await assert.rejects(run({ ...base, email: 'nope' }), /Enter a valid email address/);
});

test('invalid email with continueOnFail returns an error item', async () => {
	const [row] = await run({ ...base, email: 'nope' }, { continueOnFail: true });
	assert.match(row.error, /Enter a valid email address/);
});

test('a bad key is reported clearly', async () => {
	await assert.rejects(run({ ...base, email: 'a@b.com' }, { apiKey: 'wrong' }), /Invalid Scrubby API key/);
});

test('bulk start makes ONE job from all input items, then results come back one item per email', async () => {
	const inputs = [{ json: { email: 'test@gmail.com' } }, { json: { email: 'TEST@gmail.com' } }];
	const emails = inputs.map((i) => i.json.email).join(',');
	const started = await run(
		{ resource: 'bulk', operation: 'start', verificationType: 'quick', emails },
		{ inputs },
	);
	assert.equal(started.length, 1);
	assert.equal(started[0].status, 'processing');
	assert.equal(started[0].total, 1);

	const rows = await run({
		resource: 'bulk',
		operation: 'getResults',
		verificationType: 'quick',
		identifier: started[0].identifier,
		waitForCompletion: true,
		timeout: 10,
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0].email, 'test@gmail.com');
	assert.equal(rows[0].identifier, started[0].identifier);
	assert.equal(rows[0].is_complete, rows[0].job_status === 'completed');
});

test('empty bulk list is rejected without calling the API', async () => {
	await assert.rejects(
		run({ resource: 'bulk', operation: 'start', verificationType: 'quick', emails: ' , ' }),
		/at least one email/,
	);
});

test('unknown identifier is reported', async () => {
	await assert.rejects(
		run({ resource: 'bulk', operation: 'getResults', verificationType: 'quick', identifier: 'nope', waitForCompletion: false }),
		/No results found/,
	);
});

test('deep results are flattened into stage columns', { skip: !process.env.SCRUBBY_TEST_DEEP_ID }, async () => {
	const rows = await run({
		resource: 'bulk',
		operation: 'getResults',
		verificationType: 'deep',
		identifier: process.env.SCRUBBY_TEST_DEEP_ID,
	});
	assert.equal(rows.length, 1);
	for (const stage of ['24', '48', '72']) assert.notEqual(rows[0][`result_${stage}`], undefined);
	assert.notEqual(rows[0].result, undefined);
});
