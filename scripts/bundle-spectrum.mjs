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
import { readFile, rm } from 'node:fs/promises';
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
 */
const spectrumImportPlugin = {
	name: 'spectrum-import-rewrite',
	setup(buildApi) {
		buildApi.onLoad({ filter: /spectrumClient\.ts$/ }, async (args) => {
			const original = await readFile(args.path, 'utf8');
			const rewritten = original
				.replace(
					/\(0,\s*eval\)\('import\("spectrum-ts"\)'\)/,
					'import("spectrum-ts")',
				)
				.replace(
					/\(0,\s*eval\)\(\s*'import\("spectrum-ts\/providers\/imessage"\)',?\s*\)/,
					'import("spectrum-ts/providers/imessage")',
				);
			if (rewritten === original) {
				throw new Error(
					'bundle-spectrum: failed to rewrite spectrumClient.ts — eval markers did not match. Update the regexes in scripts/bundle-spectrum.mjs.',
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
		legalComments: 'none',
		plugins: [spectrumImportPlugin],
	});
	await rm(out + '.map', { force: true });
}

for (const ep of entryPoints) {
	await bundle(ep);
	console.log(`bundled ${ep.out.replace(root + '/', '')}`);
}
console.log('spectrum-ts inlined into node files.');
