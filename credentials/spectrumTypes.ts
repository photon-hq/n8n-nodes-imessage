/**
 * Shapes shared between the Spectrum REST helpers (`spectrumProvision.ts`,
 * `imessageLines.ts`). Kept in a single file so any future change to Spectrum's
 * envelope or `/imessage/` payload only has to be applied once.
 */

/**
 * Standard wrapper Spectrum returns from its dashboard / runtime REST APIs.
 * Most endpoints respond with `{ succeed: true, data: T }`; a few legacy paths
 * still return `T` directly, so helpers unwrap defensively.
 */
export interface SpectrumEnvelope<T> {
	succeed?: boolean;
	data: T;
}

/** Response body of `GET /projects/{id}/imessage/`. */
export interface IMessageInfoData {
	type: 'shared' | 'dedicated';
}
