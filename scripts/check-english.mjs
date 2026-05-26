#!/usr/bin/env node
/**
 * n8n verification: user-facing copy must be English only.
 * @see https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/#use-english-language-only
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const TARGET_DIRS = ['nodes', 'credentials'];
const EXTRA_FILES = ['README.md'];

/** Scripts outside Latin / common punctuation used in English UI copy. */
const NON_ENGLISH = /[\u0400-\u04FF\u0370-\u03FF\u0600-\u06FF\u0590-\u05FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0900-\u097F\u0E00-\u0E7F]/;

const USER_FACING_KEYS =
	/displayName|description|placeholder|notice|hint|subtitle|action|default:\s*['"`][^'"`]*[A-Za-z]/;

async function collectFiles(dir, acc = []) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(path, acc);
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			acc.push(path);
		}
	}
	return acc;
}

function extractStringLiterals(content) {
	const literals = [];
	const patterns = [
		/(?:displayName|description|placeholder|subtitle|default)\s*:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g,
		/(?:displayName|description|placeholder|subtitle|default)\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
		/(?:displayName|description|placeholder|subtitle|default)\s*:\s*`([^`\\]*(?:\\.[^`\\]*)*)`/g,
		/(?:NodeOperationError|ApplicationError)\([^,]+,\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g,
		/(?:NodeOperationError|ApplicationError)\([^,]+,\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
		/(?:throw new Error)\(\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g,
		/(?:throw new Error)\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
	];
	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			if (match[1]?.trim()) literals.push(match[1]);
		}
	}
	return literals;
}

function checkLiteral(file, literal, lineHint) {
	if (!/[A-Za-z]/.test(literal)) return null;
	if (NON_ENGLISH.test(literal)) {
		return `${relative(root, file)}:${lineHint}: non-English characters in "${literal.slice(0, 80)}${literal.length > 80 ? '…' : ''}"`;
	}
	return null;
}

async function checkFile(file) {
	const content = await readFile(file, 'utf8');
	const lines = content.split('\n');
	const issues = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!USER_FACING_KEYS.test(line) && !/NodeOperationError|ApplicationError|throw new Error/.test(line)) {
			continue;
		}
		for (const literal of extractStringLiterals(line)) {
			const issue = checkLiteral(file, literal, i + 1);
			if (issue) issues.push(issue);
		}
	}

	if (file.endsWith('README.md')) {
		for (const match of content.matchAll(/^[#>*\-\d.\s]*(.+)$/gm)) {
			const text = match[1]?.trim();
			if (!text || !/[A-Za-z]/.test(text)) continue;
			if (NON_ENGLISH.test(text)) {
				issues.push(`${relative(root, file)}: non-English characters in "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);
			}
		}
	}

	return issues;
}

async function main() {
	const files = [];
	for (const dir of TARGET_DIRS) {
		await collectFiles(join(root, dir), files);
	}
	for (const name of EXTRA_FILES) {
		files.push(join(root, name));
	}

	const issues = [];
	for (const file of files) {
		issues.push(...(await checkFile(file)));
	}

	if (issues.length > 0) {
		console.error('English-only verification failed:\n');
		for (const issue of issues) console.error(`  - ${issue}`);
		process.exit(1);
	}

	console.log(`English-only verification passed (${files.length} files).`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
