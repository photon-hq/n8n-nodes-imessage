export function getSpectrumHeader(
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | undefined {
	const lower = name.toLowerCase();
	const direct = headers[lower] ?? headers[name];
	if (Array.isArray(direct)) return direct[0];
	return direct;
}
