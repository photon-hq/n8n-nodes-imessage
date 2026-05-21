import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { AllowlistEntry, SpectrumCredentials } from './types';

const ALLOWLIST_KEY = 'photonSpectrumAllowlist';

interface AllowlistStore {
	[address: string]: AllowlistEntry;
}

function normalize(address: string): string {
	return address.trim().toLowerCase();
}

// Cross-execution allowlist of senders. Stored in the workflow's `global`
// static data so the Trigger and Action nodes share it within a workflow.
function loadStore(
	ctx: IExecuteFunctions | IWebhookFunctions,
): AllowlistStore {
	const staticData = ctx.getWorkflowStaticData('global') as Record<string, unknown>;
	const raw = staticData[ALLOWLIST_KEY];
	if (raw && typeof raw === 'object') return raw as AllowlistStore;
	const fresh: AllowlistStore = {};
	staticData[ALLOWLIST_KEY] = fresh;
	return fresh;
}

function seedPreApproved(store: AllowlistStore, preApproved: string): void {
	if (!preApproved) return;
	const now = Date.now();
	for (const raw of preApproved.split(',')) {
		const addr = normalize(raw);
		if (!addr) continue;
		if (!store[addr]) {
			store[addr] = { address: addr, firstSeen: now, lastSeen: now };
		}
	}
}

// Records an inbound sender so subsequent outbound to that address is allowed.
export function recordInbound(
	ctx: IWebhookFunctions,
	senderAddress: string,
): void {
	if (!senderAddress) return;
	const store = loadStore(ctx);
	const addr = normalize(senderAddress);
	const now = Date.now();
	const existing = store[addr];
	store[addr] = {
		address: addr,
		firstSeen: existing?.firstSeen ?? now,
		lastSeen: now,
	};
}

// Throws a clear NodeOperationError when strict mode is on and any recipient
// has not messaged the project yet.
export function enforceInboundFirst(
	ctx: IExecuteFunctions,
	creds: SpectrumCredentials,
	recipients: string[],
	itemIndex: number,
): void {
	const store = loadStore(ctx);
	seedPreApproved(store, creds.preApproved ?? '');

	const blocked: string[] = [];
	for (const raw of recipients) {
		const addr = normalize(raw);
		if (!addr) continue;
		if (!store[addr]) blocked.push(raw);
	}

	if (blocked.length === 0) return;

	throw new NodeOperationError(
		ctx.getNode(),
		`Inbound-first policy: ${blocked.join(', ')} has not messaged your project yet.`,
		{
			itemIndex,
			description:
				'To prevent Apple from flagging your line, this node only sends to recipients ' +
				'who have written to you first. Add the address to "Pre-Approved Recipients" on ' +
				'the credential to bypass, or set Inbound-First Policy to Off (read the iMessage ' +
				'Deliverability docs first).',
		},
	);
}
