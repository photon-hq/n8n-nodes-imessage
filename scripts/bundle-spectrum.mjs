#!/usr/bin/env node
// Post-build step: re-bundle each n8n node entry from TypeScript source with
// `spectrum-ts` (an ESM-only SDK) inlined. n8n community-node lint forbids the
// `dependencies` field and restricts `peerDependencies` to a hard-coded
// allow-list, so any third-party SDK we use has to ship inside the artifact.
//
// `spectrumClient.ts` hides its dynamic imports behind `eval(...)` so neither
// tsc nor esbuild's static analyzer pulls `spectrum-ts` into the dev build.
// This bundler swaps those eval strings back into real `import()` calls so
// esbuild can resolve and inline both module specifiers.

import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = join(root, 'dist');

const entryPoints = [
	{
		src: join(root, 'nodes', 'PhotonIMessage', 'PhotonIMessage.node.ts'),
		out: join(dist, 'nodes', 'PhotonIMessage', 'PhotonIMessage.node.js'),
	},
	{
		src: join(root, 'nodes', 'PhotonIMessage', 'PhotonIMessageTrigger.node.ts'),
		out: join(dist, 'nodes', 'PhotonIMessage', 'PhotonIMessageTrigger.node.js'),
	},
	{
		src: join(root, 'nodes', 'PhotonIMessage', 'PhotonIMessageTyping.node.ts'),
		out: join(dist, 'nodes', 'PhotonIMessage', 'PhotonIMessageTyping.node.js'),
	},
];

/**
 * Rewrites spectrumClient.ts eval markers into static imports for esbuild.
 * Both rewrites must match or the build fails.
 */
const spectrumImportPlugin = {
	name: 'spectrum-import-rewrite',
	setup(buildApi) {
		buildApi.onLoad({ filter: /spectrumClient\.ts$/ }, async (args) => {
			const original = await readFile(args.path, 'utf8');
			let rewroteRoot = false;
			let rewroteImessage = false;
			const rewritten = original
				.replace(/\(0,\s*eval\)\('import\("spectrum-ts"\)'\)/, () => {
					rewroteRoot = true;
					return 'import("spectrum-ts")';
				})
				.replace(
					/\(0,\s*eval\)\(\s*'import\("spectrum-ts\/providers\/imessage"\)',?\s*\)/,
					() => {
						rewroteImessage = true;
						return 'import("spectrum-ts/providers/imessage")';
					},
				);
			if (!rewroteRoot || !rewroteImessage) {
				throw new Error(
					`bundle-spectrum: partial rewrite of spectrumClient.ts (root=${rewroteRoot}, imessage=${rewroteImessage}). ` +
						'Both eval markers must match — update the regexes in scripts/bundle-spectrum.mjs to track upstream changes.',
				);
			}
			return { contents: rewritten, loader: 'ts' };
		});
	},
};

async function bundle({ src, out }) {
	await build({
		entryPoints: [src],
		bundle: true,
		platform: 'node',
		target: 'node20',
		format: 'cjs',
		outfile: out,
		external: ['n8n-workflow', 'n8n-core'],
		mainFields: ['module', 'main'],
		conditions: ['import', 'node', 'default'],
		sourcemap: false,
		logLevel: 'warning',
		legalComments: 'eof',
		banner: {
			js: 'var __photonImportMetaUrl = require("url").pathToFileURL(__filename).href;',
		},
		plugins: [spectrumImportPlugin],
	});
	await patchImportMetaUrl(out);
}

/** esbuild CJS output sets `import_meta = {}` for @photon-ai/imessage-kit — breaks createRequire. */
async function patchImportMetaUrl(outfile) {
	const broken = 'import_meta = {}';
	const fixed = 'import_meta = { url: __photonImportMetaUrl }';
	let code = await readFile(outfile, 'utf8');
	if (!code.includes(broken)) {
		if (code.includes('createRequire)(import_meta.url)')) {
			throw new Error(
				`bundle-spectrum: ${outfile} uses import_meta.url but has no "${broken}" — update patchImportMetaUrl`,
			);
		}
		return;
	}
	code = code.replaceAll(broken, fixed);
	await writeFile(outfile, code);
}

for (const ep of entryPoints) {
	await bundle(ep);
	console.log(`bundled ${ep.out.replace(root + '/', '')}`);
}
console.log('spectrum-ts inlined into node files.');
