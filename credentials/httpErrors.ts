/** True when an HTTP helper error indicates invalid project credentials. */
export function isAuthError(err: unknown): boolean {
	const status =
		(err as { httpCode?: number; statusCode?: number }).httpCode ??
		(err as { statusCode?: number }).statusCode;
	return status === 401 || status === 403;
}
