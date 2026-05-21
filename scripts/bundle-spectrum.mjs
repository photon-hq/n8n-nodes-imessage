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
import { readFile } from 'node:fs/promises';
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
];

/**
 * esbuild plugin that rewrites `spectrumClient.ts` so the bundler sees the
 * spectrum-ts imports as static ESM dynamic imports. Without this, the eval
 * strings remain as runtime lookups and spectrum-ts is never inlined.
 *
 * Each rewrite is tracked independently — a partial match (e.g. only the
 * `spectrum-ts` import substituted but not its `providers/imessage` subpath)
 * would otherwise pass the loose `rewritten !== original` check and ship a
 * broken artifact with one live `eval()` call esbuild can never reach.
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
		// Preserve `/*! … */` legal comments at end-of-file so any
		// attribution / license notices from bundled-in dependencies survive
		// the post-build. spectrum-ts and its transitive deps are MIT today,
		// but `eof` is the conservative choice if any future dep drops in an
		// Apache-2 NOTICE or similar attribution requirement.
		legalComments: 'eof',
		plugins: [spectrumImportPlugin],
	});
}

for (const ep of entryPoints) {
	await bundle(ep);
	console.log(`bundled ${ep.out.replace(root + '/', '')}`);
}
console.log('spectrum-ts inlined into node files.');
