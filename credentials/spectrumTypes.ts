/** Spectrum REST envelope — most endpoints return `{ succeed, data }`. */
export interface SpectrumEnvelope<T> {
	succeed?: boolean;
	data: T;
}

/** Response body of `GET /projects/{id}/imessage/`. */
export interface IMessageInfoData {
	type: 'shared' | 'dedicated';
}
