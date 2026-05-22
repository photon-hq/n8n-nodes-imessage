#!/usr/bin/env node
/** Local dev with public webhook URL (ngrok preferred, cloudflared fallback). */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const N8N_PORT = process.env.N8N_PORT || '5678';
const TUNNEL_TARGET = `http://127.0.0.1:${N8N_PORT}`;
const TUNNEL_MODE = (process.env.TUNNEL || 'auto').toLowerCase();
const CLOUDFLARE_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TUNNEL_TIMEOUT_MS = 90_000;
const NGROK_API = 'http://127.0.0.1:4040/api/tunnels';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const children = [];
let shuttingDown = false;
let tunnelKind = 'unknown';

function findBin(name) {
	const checked = spawnSync('which', [name], { encoding: 'utf8' });
	const bin = checked.stdout?.trim();
	if (bin && fs.existsSync(bin)) return bin;
	return null;
}

function portInUse(port) {
	const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
	return Boolean(r.stdout?.trim());
}

function killPort(port) {
	const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
	for (const pid of (r.stdout || '').trim().split('\n').filter(Boolean)) {
		try {
			process.kill(Number(pid), 'SIGTERM');
		} catch {
			// ignore
		}
	}
}

function track(child) {
	children.push(child);
	return child;
}

function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null && !child.killed) {
			try {
				child.kill('SIGTERM');
			} catch {
				// ignore
			}
		}
	}
	setTimeout(() => process.exit(code), 300);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitForN8nLocal() {
	const url = `http://127.0.0.1:${N8N_PORT}/healthz`;
	const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
			if (res.ok) return;
		} catch {
			// keep waiting
		}
		await sleep(1500);
	}
	throw new Error(`n8n did not become ready on port ${N8N_PORT} within ${TUNNEL_TIMEOUT_MS / 1000}s`);
}

/** n8n returns JSON/HTML; dead trycloudflare tunnels return empty 404. */
async function verifyTunnelForwards(publicUrl) {
	const res = await fetch(`${publicUrl}/healthz`, { signal: AbortSignal.timeout(12_000) });
	const body = await res.text();
	if (!res.ok || !body.includes('"status"')) {
		throw new Error(
			`Tunnel at ${publicUrl} is not reaching n8n (HTTP ${res.status}, body length ${body.length}).`,
		);
	}
}

function startCloudflared(bin) {
	console.log(`${CYAN}▸${RESET} Starting cloudflared tunnel → ${TUNNEL_TARGET}`);
	tunnelKind = 'cloudflared';
	const proc = track(
		spawn(bin, ['tunnel', '--url', TUNNEL_TARGET], {
			stdio: ['ignore', 'pipe', 'pipe'],
		}),
	);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		};
		const onData = (chunk) => {
			const match = chunk.toString().match(CLOUDFLARE_URL_RE);
			if (match) finish(resolve, { proc, publicUrl: match[0].replace(/\/+$/, '') });
		};
		proc.stdout.on('data', onData);
		proc.stderr.on('data', onData);
		proc.on('error', (err) => finish(reject, err));
		proc.on('exit', (code) => {
			if (!settled) {
				finish(reject, new Error(`cloudflared exited before publishing a URL (code ${code ?? 'unknown'})`));
			}
		});
		const timer = setTimeout(() => {
			finish(reject, new Error(`Timed out waiting for trycloudflare.com URL`));
		}, TUNNEL_TIMEOUT_MS);
	});
}

async function readNgrokPublicUrl() {
	const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(5000) });
	const data = await res.json();
	const tunnels = data.tunnels ?? [];
	const https =
		tunnels.find((t) => t.public_url?.startsWith('https://')) ??
		tunnels.find((t) => t.public_url?.startsWith('http://'));
	if (!https?.public_url) {
		throw new Error('ngrok API returned no public URL');
	}
	return https.public_url.replace(/\/+$/, '');
}

function startNgrok(bin) {
	console.log(`${CYAN}▸${RESET} Starting ngrok tunnel → localhost:${N8N_PORT}`);
	tunnelKind = 'ngrok';
	const proc = track(
		spawn(bin, ['http', N8N_PORT, '--log=stdout', '--log-format=json'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		}),
	);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		};
		const poll = async () => {
			while (!settled) {
				try {
					const publicUrl = await readNgrokPublicUrl();
					finish(resolve, { proc, publicUrl });
					return;
				} catch {
					await sleep(500);
				}
			}
		};
		void poll();
		proc.on('error', (err) => finish(reject, err));
		proc.on('exit', (code) => {
			if (!settled) {
				finish(reject, new Error(`ngrok exited before publishing a URL (code ${code ?? 'unknown'})`));
			}
		});
		const timer = setTimeout(() => {
			finish(reject, new Error('Timed out waiting for ngrok public URL'));
		}, TUNNEL_TIMEOUT_MS);
	});
}

async function startTunnel() {
	const ngrokBin = findBin('ngrok');
	const cloudflaredBin = findBin('cloudflared');
	const preferNgrok = TUNNEL_MODE === 'ngrok' || TUNNEL_MODE === 'auto';
	const preferCloudflared = TUNNEL_MODE === 'cloudflared';

	if (preferNgrok && ngrokBin) {
		try {
			return await startNgrok(ngrokBin);
		} catch (err) {
			if (TUNNEL_MODE === 'ngrok' || !cloudflaredBin) throw err;
			console.warn(`${YELLOW}!${RESET} ngrok failed (${(err instanceof Error ? err.message : err) || err}), trying cloudflared…`);
		}
	}

	if ((preferCloudflared || TUNNEL_MODE === 'auto') && cloudflaredBin) {
		return await startCloudflared(cloudflaredBin);
	}

	if (TUNNEL_MODE === 'ngrok') {
		console.error(`${YELLOW}ngrok not found.${RESET} Install: brew install ngrok`);
	} else {
		console.error(`${YELLOW}No tunnel tool found.${RESET} Install ngrok (recommended): brew install ngrok`);
	}
	process.exit(1);
}

async function main() {
	const n8nNodeBin = path.join(ROOT, 'node_modules', '.bin', 'n8n-node');
	if (!fs.existsSync(n8nNodeBin)) {
		console.error(`${YELLOW}Missing node_modules.${RESET} Run \`npm install\` first.`);
		process.exit(1);
	}

	if (portInUse(N8N_PORT)) {
		console.warn(`${YELLOW}!${RESET} Port ${N8N_PORT} is in use — stopping existing listener(s).`);
		killPort(N8N_PORT);
		await sleep(1500);
		if (portInUse(N8N_PORT)) {
			console.error(`${YELLOW}Port ${N8N_PORT} is still in use.${RESET} Stop the other n8n process and retry.`);
			process.exit(1);
		}
	}

	let tunnelResult;
	try {
		tunnelResult = await startTunnel();
	} catch (err) {
		console.error(`${YELLOW}Tunnel failed:${RESET} ${(err instanceof Error ? err.message : err) || err}`);
		shutdown(1);
		return;
	}

	const { proc: tunnelProc, publicUrl } = tunnelResult;

	console.log('');
	console.log(`${GREEN}Public webhook base URL${RESET} (${tunnelKind})`);
	console.log(`  ${publicUrl}`);
	console.log(`${DIM}Editor (local only): http://localhost:${N8N_PORT}${RESET}`);
	console.log('');
	console.warn(
		`${YELLOW}!${RESET} After n8n starts, click **Test this trigger** (or toggle workflow Active). ` +
			'If you restart this script, re-test so Spectrum gets the new URL.',
	);
	console.log('');

	console.log(`${CYAN}▸${RESET} Starting n8n-node dev…`);
	const dev = track(
		spawn(n8nNodeBin, ['dev'], {
			cwd: ROOT,
			env: {
				...process.env,
				WEBHOOK_URL: publicUrl,
				N8N_PORT,
			},
			stdio: 'inherit',
		}),
	);

	try {
		await waitForN8nLocal();
		await verifyTunnelForwards(publicUrl);
		console.log(`${GREEN}✓${RESET} Tunnel verified — ${publicUrl} reaches n8n`);
	} catch (err) {
		console.error(
			`${YELLOW}Tunnel verification failed:${RESET} ${(err instanceof Error ? err.message : err) || err}`,
		);
		if (tunnelKind === 'cloudflared') {
			console.error(
				`${YELLOW}Tip:${RESET} trycloudflare is unreliable on some networks. Run: TUNNEL=ngrok npm run dev:tunnel`,
			);
		}
		shutdown(1);
		return;
	}

	const healthTimer = setInterval(async () => {
		if (shuttingDown) return;
		try {
			await verifyTunnelForwards(publicUrl);
		} catch {
			console.warn(
				`${YELLOW}!${RESET} Tunnel stopped forwarding to n8n (${publicUrl}). ` +
					'Restart npm run dev:tunnel and click Test this trigger again.',
			);
		}
	}, 120_000);
	healthTimer.unref();

	dev.on('exit', (code, signal) => {
		clearInterval(healthTimer);
		if (shuttingDown) return;
		if (signal) shutdown(1);
		else shutdown(code ?? 0);
	});

	tunnelProc.on('exit', (code) => {
		if (shuttingDown) return;
		console.warn(`${YELLOW}!${RESET} ${tunnelKind} exited (code ${code ?? 'unknown'})`);
		shutdown(code ?? 1);
	});
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

main().catch((err) => {
	console.error(err);
	shutdown(1);
});
