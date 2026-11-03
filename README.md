# n8n-nodes-scrubby

This is an n8n community node. It lets you use [Scrubby](https://scrubby.io) in your n8n workflows.

Scrubby verifies email addresses and checks their deliverability, one at a time or in bulk, with a quick check or a deeper one.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and install the package `n8n-nodes-scrubby`.

## Operations

| Resource | Operation | Verification type | Credits |
|---|---|---|---|
| Email | **Verify** | Quick | 1 |
| Email | **Verify** | Deep | 3 |
| Bulk Verification | **Start** | Quick | 1 per email |
| Bulk Verification | **Start** | Deep | 3 per email |
| Bulk Verification | **Get Results** | Quick | 0 |
| Bulk Verification | **Get Results** | Deep | 0 |

- **Quick** verification of a single email answers immediately.
- Everything else is asynchronous: the start operation returns a job `identifier`, and **Get Results** collects the answer.
- **Deep** verification is thorough and arrives in stages over about 72 hours. The API has no single-email deep endpoint, so **Email → Verify (Deep)** starts a deep job for one address.

## Credentials

You need a Scrubby account and its API key.

1. Sign in to Scrubby and copy your API key.
2. In n8n, create a **Scrubby API** credential and paste the key into **API Key**.
3. Leave **Base URL** at `https://api.scrubby.io` unless you were told to use another environment.

n8n tests the credential with a free account lookup, which spends no credits. Requests are sent as `Authorization: Api-Key <key>`.

## Compatibility

Built with `@n8n/node-cli` 0.55 against the community node API version 1. It needs an n8n version that supports community nodes.

## Usage

**Verify one email.** Add the node, choose **Email → Verify**, and map an email into **Email**. The node runs once per input item and returns `email`, `status`, `result`, `quick_status`, `credits_used` and `remaining_credits`.

**Verify a list.**
1. **Bulk Verification → Start.** By default it collects the `email` field of every input item and runs **once**, so a whole list becomes a single job. It returns an `identifier`.
2. Wait, then use **Bulk Verification → Get Results** with that `identifier`. It returns **one item per email** with `email`, `result`, `status`, `quick_status`, plus `identifier`, `job_status` and `is_complete` so you can filter with an IF node.
3. For Quick jobs, turn on **Wait for Completion** to keep checking (every 10 seconds) up to a timeout, instead of adding a Wait node.

**Deep results** have the columns `result_24`, `result_48` and `result_72` (`pending` until that stage arrives). `result` and `status` hold the latest finished stage. Use a Wait node (or a scheduled workflow) to come back later.

**Limits.** Scrubby allows 60 requests per 60 seconds per API key. The node waits and retries when it is rate limited. Enable **Continue On Fail** to get an `error` item instead of stopping the workflow.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Scrubby](https://scrubby.io)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
