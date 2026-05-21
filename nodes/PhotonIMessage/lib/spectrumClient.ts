import type { SpectrumCredentials } from './types';

type SpectrumModule = typeof import('spectrum-ts');

export interface ImessageProviderModule {
	imessage: {
		config: (opts?: unknown) => unknown;
		effect: {
			message: Record<string, string>;
		};
		tapbacks: Record<string, string>;
		(app: unknown): {
			user: (id: string) => Promise<{ id: string }>;
			space: (...args: unknown[]) => Promise<unknown>;
			messages: AsyncIterable<unknown>;
		};
	};
	effect: (content: unknown, effectValue: string) => unknown;
	background: (input: unknown, opts?: { mimeType?: string }) => unknown;
}

let cachedSpectrum: SpectrumModule | undefined;
let cachedImessage: ImessageProviderModule | undefined;

// `spectrum-ts` is ESM-only. We hide the imports behind `eval` for two reasons:
//   1. tsc with `module: "commonjs"` would down-level `import('x')` into a
//      `require('x')` that fails on an ESM-only module at runtime.
//   2. esbuild's bundler (scripts/bundle-spectrum.mjs) substitutes these eval
//      strings with statically-resolved chunks before publishing, so the
//      published artifact has `spectrum-ts` inlined — no runtime dependency.
// The marker comments below are read by the bundler.
async function importSpectrum(): Promise<SpectrumModule> {
	// SPECTRUM_TS_IMPORT
	return (await (0, eval)('import("spectrum-ts")')) as SpectrumModule;
}

async function importImessage(): Promise<ImessageProviderModule> {
	// SPECTRUM_TS_IMESSAGE_IMPORT
	return (await (0, eval)(
		'import("spectrum-ts/providers/imessage")',
	)) as ImessageProviderModule;
}

export async function loadSpectrum(): Promise<SpectrumModule> {
	if (cachedSpectrum) return cachedSpectrum;
	cachedSpectrum = await importSpectrum();
	return cachedSpectrum;
}

export async function loadImessageProvider(): Promise<ImessageProviderModule> {
	if (cachedImessage) return cachedImessage;
	cachedImessage = await importImessage();
	return cachedImessage;
}

export interface SpectrumSession {
	app: Awaited<ReturnType<SpectrumModule['Spectrum']>>;
	imessage: ImessageProviderModule['imessage'];
	effect: ImessageProviderModule['effect'];
	background: ImessageProviderModule['background'];
	sp: SpectrumModule;
	stop: () => Promise<void>;
}

export async function openSpectrum(
	credentials: SpectrumCredentials,
): Promise<SpectrumSession> {
	const sp = await loadSpectrum();
	const im = await loadImessageProvider();

	const app = await sp.Spectrum({
		projectId: credentials.projectId,
		projectSecret: credentials.projectSecret,
		providers: [im.imessage.config() as Parameters<typeof sp.Spectrum>[0]['providers'][number]],
	});

	return {
		app,
		imessage: im.imessage,
		effect: im.effect,
		background: im.background,
		sp,
		stop: () => app.stop(),
	};
}

export async function withSpectrum<T>(
	credentials: SpectrumCredentials,
	fn: (session: SpectrumSession) => Promise<T>,
): Promise<T> {
	const session = await openSpectrum(credentials);
	try {
		return await fn(session);
	} finally {
		await session.stop().catch(() => undefined);
	}
}
