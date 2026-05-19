import type { SpectrumCredentials } from './types';

type SpectrumModule = typeof import('spectrum-ts');

export interface ImessageProviderModule {
	imessage: {
		config: (opts?: unknown) => unknown;
		effect: {
			message: Record<string, string>;
		};
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

// Wrapped in `new Function` so the CJS compile target does not downgrade
// `import()` to `require()`. `spectrum-ts` is ESM-only.
const dynImport = new Function('p', 'return import(p)') as (
	p: string,
) => Promise<unknown>;

export async function loadSpectrum(): Promise<SpectrumModule> {
	if (cachedSpectrum) return cachedSpectrum;
	cachedSpectrum = (await dynImport('spectrum-ts')) as SpectrumModule;
	return cachedSpectrum;
}

export async function loadImessageProvider(): Promise<ImessageProviderModule> {
	if (cachedImessage) return cachedImessage;
	cachedImessage = (await dynImport(
		'spectrum-ts/providers/imessage',
	)) as ImessageProviderModule;
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
