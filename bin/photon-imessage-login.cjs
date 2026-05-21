#!/usr/bin/env node
// `npx n8n-nodes-imessage login` — browser device-flow that prints a
// (projectId, projectSecret) pair to paste into the n8n credential.
// See README "Credentials" for the in-n8n alternative.

'use strict';

const path = require('node:path');
const readline = require('node:readline');

function resolveDeviceAuthModule() {
	const compiled = path.join(
		__dirname,
		'..',
		'dist',
		'nodes',
		'PhotonIMessage',
		'lib',
		'deviceAuth.js',
	);
	try {
		require.resolve(compiled);
		return compiled;
	} catch {
		throw new Error(
			'Cannot find dist/nodes/PhotonIMessage/lib/deviceAuth.js. Run `npm run build` first.',
		);
	}
}

function parseArgs(argv) {
	const args = { _: [] };
	const readValue = (flag, i) => {
		const v = argv[i + 1];
		if (!v || v.startsWith('-')) {
			throw new Error(`Missing value for ${flag}`);
		}
		return v;
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') args.help = true;
		else if (a === '--no-browser') args.noBrowser = true;
		else if (a === '--json') args.json = true;
		else if (a === '--api-host') args.apiHost = readValue('--api-host', i), i++;
		else if (a === '--client-id') args.clientId = readValue('--client-id', i), i++;
		else if (a === '--project') args.project = readValue('--project', i), i++;
		else if (a.startsWith('--api-host=')) args.apiHost = a.slice('--api-host='.length);
		else if (a.startsWith('--client-id=')) args.clientId = a.slice('--client-id='.length);
		else if (a.startsWith('--project=')) args.project = a.slice('--project='.length);
		else args._.push(a);
	}
	return args;
}

function prompt(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function tryOpen(url) {
	const { spawn } = require('node:child_process');
	const platform = process.platform;
	const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
	return new Promise((resolve) => {
		let settled = false;
		const finish = (ok) => {
			if (!settled) {
				settled = true;
				resolve(ok);
			}
		};
		try {
			const child = spawn(cmd, [url], {
				stdio: 'ignore',
				detached: true,
				shell: platform === 'win32',
			});
			// spawn() can fail asynchronously (e.g. ENOENT when `open`/`xdg-open`
			// is missing). A sync try/catch never sees those — listen for 'error'.
			// Use a short delay before resolving true so the I/O error event has
			// time to fire; nextTick always wins the race and makes the listener
			// dead code.
			child.once('error', () => finish(false));
			child.unref();
			setTimeout(() => finish(true), 50);
		} catch {
			finish(false);
		}
	});
}

async function pollUntilApproved({ da, apiHost, clientId, deviceCode, interval, expiresIn }) {
	let intervalSec = Math.max(1, interval);
	const deadline = Date.now() + expiresIn * 1000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, intervalSec * 1000));
		const result = await da.pollDeviceToken({ dashboardHost: apiHost, clientId, deviceCode });
		if (result.ok) return result.token;
		if (result.status === 429) {
			intervalSec += 10;
			continue;
		}
		switch (result.error) {
			case 'authorization_pending':
				continue;
			case 'slow_down':
				intervalSec += 5;
				continue;
			case 'access_denied':
				throw new Error('User denied the login request.');
			case 'expired_token':
				throw new Error('Device code expired before approval.');
			default:
				throw new Error(
					`Device flow failed: ${result.error}${result.description ? ` — ${result.description}` : ''}`,
				);
		}
	}
	throw new Error('Device code expired before approval.');
}

function help() {
	console.log(`Usage: n8n-nodes-imessage login [options]

Browser-based login for the n8n iMessage (Photon) credential. Produces a
projectId + projectSecret pair you paste into n8n once.

Options:
  --api-host <url>     Spectrum dashboard host (default https://app.photon.codes)
  --client-id <id>     OAuth client id (default photon-cli)
  --project <id>       Skip the project picker; use this project id
  --no-browser         Don't auto-open the browser; print the URL instead
  --json               Emit JSON instead of a human banner
  -h, --help           Show this help

Environment:
  PHOTON_API_HOST, PHOTON_CLIENT_ID, PHOTON_PROJECT_ID

WARNING: This regenerates the project secret. Any other system using the old
secret will stop working until you update it there too.
`);
}

async function run() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || (args._.length > 0 && args._[0] !== 'login')) {
		help();
		process.exit(args.help ? 0 : 1);
	}

	const apiHost = args.apiHost || process.env.PHOTON_API_HOST || 'https://app.photon.codes';
	const clientId = args.clientId || process.env.PHOTON_CLIENT_ID || 'photon-cli';
	const projectArg = args.project || process.env.PHOTON_PROJECT_ID;
	const wantsJson = !!args.json;
	const noBrowser = !!args.noBrowser;

	const modulePath = resolveDeviceAuthModule();
	const da = require(modulePath);

	if (!wantsJson) {
		console.log(`\n  Photon iMessage login → ${apiHost}\n`);
	}

	const code = await da.startDeviceFlow({ dashboardHost: apiHost, clientId });
	const verifyUrl = code.verification_uri_complete || code.verification_uri;

	if (!wantsJson) {
		console.log(`  Open this URL to approve:`);
		console.log(`    ${verifyUrl}`);
		console.log(`  Code: ${code.user_code}\n`);
		if (!noBrowser) {
			const opened = await tryOpen(verifyUrl);
			if (opened) console.log('  Opened browser. Waiting for approval...\n');
			else console.log('  Could not open browser automatically. Open the URL above.\n');
		}
	}

	const tok = await pollUntilApproved({
		da,
		apiHost,
		clientId,
		deviceCode: code.device_code,
		interval: code.interval,
		expiresIn: code.expires_in,
	});
	const bearer = tok.access_token;

	const session = await da.getSession(bearer, apiHost);
	if (!wantsJson) {
		const who = session?.user?.email || session?.user?.id || 'authenticated user';
		console.log(`  Approved as ${who}.\n`);
	}

	let projectId = projectArg;
	if (!projectId) {
		const projects = await da.listProjects(bearer, apiHost);
		if (wantsJson && projects.length === 0) {
			throw new Error('No projects on this account. Pass --project <id> or create one in the dashboard first.');
		}
		if (projects.length === 0) {
			console.log('  No projects yet. Create one at https://app.photon.codes and rerun.');
			process.exit(1);
		}
		if (projects.length === 1) {
			projectId = projects[0].id;
			if (!wantsJson) console.log(`  Using only project: ${projects[0].name || ''} (${projectId})\n`);
		} else if (wantsJson) {
			throw new Error(
				`Multiple projects on this account; pass --project <id> in --json mode. Available: ${projects
					.map((p) => `${p.id}${p.name ? `(${p.name})` : ''}`)
					.join(', ')}`,
			);
		} else {
			console.log('  Select a project:');
			projects.forEach((p, i) => {
				console.log(`    [${i + 1}] ${p.name || '(unnamed)'}  ${p.id}`);
			});
			const ans = await prompt('  Number: ');
			const idx = Number.parseInt(ans, 10);
			if (!Number.isFinite(idx) || idx < 1 || idx > projects.length) {
				throw new Error('Invalid selection');
			}
			projectId = projects[idx - 1].id;
		}
	}

	if (!wantsJson) {
		console.log(
			`\n  About to rotate the project secret for ${projectId}.\n  Any other system using the old secret will stop working.\n`,
		);
		const confirm = await prompt('  Continue? [y/N]: ');
		if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
			console.log('  Aborted. No changes made.');
			process.exit(0);
		}
	}

	const { projectSecret } = await da.regenerateProjectSecret(bearer, projectId, apiHost);

	if (wantsJson) {
		process.stdout.write(
			JSON.stringify({
				projectId,
				projectSecret,
				apiHost: 'https://spectrum.photon.codes',
				dashboardHost: apiHost,
				warning: 'projectSecret was rotated. Update any other systems using the old secret.',
			}) + '\n',
		);
		return;
	}

	console.log(`\n  ✓ Credentials ready. Paste into n8n:\n`);
	console.log(`    Project ID:     ${projectId}`);
	console.log(`    Project Secret: ${projectSecret}\n`);
	console.log(`  In n8n: Credentials → New → "iMessage by Photon (Spectrum) API"\n`);
}

run().catch((err) => {
	const message = err && err.message ? err.message : String(err);
	if (process.argv.includes('--json')) {
		process.stderr.write(JSON.stringify({ error: message }) + '\n');
	} else {
		console.error(`\n  ✗ ${message}\n`);
	}
	process.exit(1);
});
