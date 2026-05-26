/** Dashboard project row (subset of fields we use for picking). */
export interface DashboardProject {
	id: string;
	name?: string;
	spectrum?: boolean;
}

const N8N_PROJECT_PREFIX = /^n8n\b/i;

/**
 * Picks an existing n8n-owned Photon project to reuse, or returns null to
 * signal the caller should create a fresh one.
 *
 * Rules (in order):
 *   1. If `projectId` was explicitly provided (pasted by user OR stored from a
 *      prior successful connect), use it when it exists in the project list.
 *   2. If any project is named like `n8n*` (our own past creations), reuse the
 *      newest one. We never reuse unrelated projects (e.g. "codex (...)") —
 *      sharing a project with another tool would also share the Spectrum line
 *      pool and webhook list, which is surprising and unsafe.
 *   3. Otherwise return null. The caller is expected to create a new project.
 */
export function pickExistingProject(
	projects: DashboardProject[],
	opts: {
		/** Project ID already stored on the credential or pasted by the user. */
		projectId?: string;
		/** Optional name from the form (e.g. "n8n iMessage") for name matching. */
		preferredName?: string;
	},
): string | null {
	const wantedId = (opts.projectId ?? '').trim();
	if (wantedId) {
		const found = projects.find((p) => p.id === wantedId);
		if (found) return found.id;
		// Stale id after dashboard delete — fall through to heuristics.
	}

	const preferredName = (opts.preferredName ?? '').trim();
	const n8nProjects = projects.filter((p) => {
		const name = (p.name ?? '').trim();
		if (!name) return false;
		if (N8N_PROJECT_PREFIX.test(name)) return true;
		return preferredName.length > 0 && name === preferredName;
	});
	if (n8nProjects.length >= 1) {
		// Prefer the most recently created n8n project. Dashboard list comes in
		// creation order; pick the last to favour the freshest one.
		return n8nProjects[n8nProjects.length - 1].id;
	}

	return null;
}

export function formatProjectList(projects: DashboardProject[]): string {
	return projects
		.map((p) => `${p.id}${p.name ? ` (${p.name})` : ''}`)
		.join(', ');
}

export function projectResolutionError(
	projects: DashboardProject[],
	opts: { createIfNone: boolean },
): string {
	if (projects.length === 0) {
		if (opts.createIfNone) {
			return '';
		}
		return (
			'No Photon projects on this account. Create one at https://app.photon.codes ' +
			'(or enable "Create project if none exists" below), then Save again.'
		);
	}
	return (
		`Could not pick a single Photon project. Found: ${formatProjectList(projects)}. ` +
		'Paste the Project ID when using manual credentials, or rename one project to start with "n8n".'
	);
}
