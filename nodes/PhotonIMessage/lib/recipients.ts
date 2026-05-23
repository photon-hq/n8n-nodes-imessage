import { ApplicationError } from 'n8n-workflow';

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmailAddress(address: string): boolean {
	const value = address.trim();
	if (!value.includes('@')) return false;
	return EMAIL_ADDRESS.test(value);
}

export function findEmailRecipients(recipients: string[]): string[] {
	return recipients.map((r) => r.trim()).filter(looksLikeEmailAddress);
}

export function appleIdEmailErrorMessage(emails: string[]): string {
	const list = emails.map((e) => `"${e}"`).join(', ');
	const examples = 'Use a phone number in E.164 format (e.g. +15551234567).';
	if (emails.length === 1) {
		return `Apple ID email addresses are not supported (${list}). ${examples}`;
	}
	return `Apple ID email addresses are not supported: ${list}. ${examples}`;
}

export function assertPhoneRecipients(recipients: string[]): void {
	const emails = findEmailRecipients(recipients);
	if (emails.length > 0) {
		throw new ApplicationError(appleIdEmailErrorMessage(emails));
	}
}
