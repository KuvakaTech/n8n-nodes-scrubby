import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

// Scrubby allows 60 requests per 60 seconds per API key and answers 429 beyond that.
const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_WAIT_MS = 20_000;

const DEEP_STAGES = ['24', '48', '72'] as const;

function errorMessage(body: unknown, status: number): string {
	if (body && typeof body === 'object') {
		const data = body as IDataObject;
		if (data.detail) return String(data.detail);
		// Field errors look like {"email": ["Enter a valid email address."]}
		const parts = Object.entries(data).map(
			([key, value]) => `${key}: ${([] as unknown[]).concat(value).join('; ')}`,
		);
		if (parts.length) return parts.join(' | ');
	}
	return `Scrubby returned HTTP ${status}`;
}

export async function scrubbyRequest(
	this: IExecuteFunctions,
	endpoint: string,
	body: IDataObject,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('scrubbyApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.scrubby.io').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: `${baseUrl}${endpoint}`,
		body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	for (let attempt = 0; ; attempt++) {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'scrubbyApi',
			options,
		);
		const status = Number(response.statusCode);

		if (status === 429 && attempt < RATE_LIMIT_RETRIES) {
			await sleep(RATE_LIMIT_WAIT_MS);
			continue;
		}
		if (status >= 400) {
			const message = status === 401 ? 'Invalid Scrubby API key' : errorMessage(response.body, status);
			throw new NodeApiError(this.getNode(), (response.body ?? {}) as JsonObject, {
				message,
				httpCode: String(status),
			});
		}
		return response.body as IDataObject;
	}
}

/** Accepts an array, or text with commas / semicolons / whitespace between addresses. */
export function toEmails(input: unknown): string[] {
	const emails = ([] as unknown[])
		.concat(input ?? [])
		.flatMap((value) => String(value).split(/[,;\s]+/))
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
	return [...new Set(emails)];
}

type Verdict = { result?: string; status?: string; quick_status?: string };

function jobFields(data: IDataObject): IDataObject {
	return {
		identifier: data.identifier,
		job_status: data.status,
		is_complete: data.status === 'completed',
	};
}

/** The API returns {"a@b.com": {result, status, quick_status}}; n8n handles one item per email better. */
export function quickResultRows(data: IDataObject): IDataObject[] {
	const results = (data.results ?? {}) as Record<string, Verdict>;
	const rows = Object.entries(results).map(([email, verdict]) => ({
		...jobFields(data),
		email,
		...verdict,
	}));
	return rows.length ? rows : [jobFields(data)];
}

/**
 * Deep results come as three maps (one per stage, "pending" until that stage lands). Flatten them to
 * one row per email, with the latest finished stage as the headline result / status.
 */
export function deepResultRows(data: IDataObject): IDataObject[] {
	const stage = (name: string) => (data[`results_${name}`] ?? {}) as Record<string, Verdict>;
	const emails = Object.keys({ ...stage('24'), ...stage('48'), ...stage('72') });

	const rows = emails.map((email) => {
		const row: IDataObject = { ...jobFields(data), email };
		let latest: Verdict = { result: 'pending', status: 'pending', quick_status: 'pending' };
		for (const name of DEEP_STAGES) {
			const verdict = stage(name)[email] ?? latest;
			row[`result_${name}`] = verdict.result;
			row[`status_${name}`] = verdict.status;
			if (String(verdict.result).toLowerCase() !== 'pending') latest = verdict;
		}
		return { ...row, ...latest };
	});
	return rows.length ? rows : [jobFields(data)];
}
