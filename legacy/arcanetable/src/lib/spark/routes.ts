// @sync context=vite routes.ts sha=5bb3e2a02ca351258af2b1d5e7b30230b9540b55
// version 0.1
import { createMemo, createResource, lazy, ResourceSource } from 'solid-js';
import { ImportGlobFunction } from 'vite';

interface Opts<T> {
	sort?: string;
	filter?(record: T): boolean;
	transform?(record: unknown): T;
}

export interface Record {
	metadata: {
		path: string;
		filename: string;
		hasBody: boolean;
		name: string; // filename without extension (stable UID seed)
	};
}

export function getRecordFromImport(path: string, mod: { frontmatter: any, hasBody: boolean }) {
	const filename = path.split('/').pop()!;
	return {
		...mod.frontmatter,
		metadata: {
			hasBody: mod.hasBody,
			path,
			filename,
			name: filename.replace(/\.\w+$/, ''),
		},
	};
}

async function loadRecordsFromGlob<T>(glob: ReturnType<ImportGlobFunction>) {
	return Promise.all(
		Object.entries(glob).map(async ([path, loader]) => {
			const record = await loader();
			return getRecordFromImport(path, record);
		}),
	);
}

export async function getRecordsFromGlob<T>(glob, opts?: Opts<T>) {
	const records = await loadRecordsFromGlob(glob);
	const transformed = transformRecords(records, opts);
	const filtered = filterRecords(transformed, opts);
	return sortRecords(filtered, opts);
}

function filterRecords<T>(records: T[], opts?: Opts<T>) {
	if (!records) return [];
	if (!opts?.filter) return records;

	return records.filter(opts.filter);
}

function transformRecords<T, U>(records: U[], opts?: Opts<T>) {
	if (!records) return [];
	if (!opts?.transform) return records;

	return records.map(opts.transform);
}

function sortRecords<T extends Record<string, unknown>>(records: T[], opts?: Opts<T>) {
	if (!records) return [];
	if (!opts?.sort) return records;

	const sortSpec = parseSort(opts.sort);
	return records.sort((a, b) => {
		for (const { field, direction } of sortSpec) {
			const aVal = a[field];
			const bVal = b[field];
			if (aVal === bVal) continue;
			const cmp = aVal > bVal ? 1 : -1;
			return direction === 'asc' ? cmp : -cmp;
		}
		return 0;
	});
}

export function createRecordsFromGlob<T>(glob: ReturnType<ImportGlobFunction>, opts?: Opts<T>) {
	const [allRecords] = createResource(
		() => glob,
		g => loadRecordsFromGlob(g),
	);

	const allRecordsWithContent = createMemo(() => {
		const records = allRecords();
		if (!records) return [];
		return records.map(r => ({
			...r,
			Content: glob[r.metadata.path] ? lazy(glob[r.metadata.path]) : undefined,
		}));
	});

	const records = createMemo(() => {
		const records = allRecordsWithContent();
		if (!records) return [];
		const transformed = transformRecords(records, opts);
		const filtered = filterRecords(transformed, opts);
		return sortRecords(filtered, opts);
	});

	return [records] as const;
}

export function createRecordFromLoader(path: ResourceSource<string>, loader) {
	const [page] = createResource(path, async path => getRecordFromImport(path, await loader()));

	const record = createMemo(() => {
		const record = page();
		if (!record) return null;

		return {
			...record,
			Content: lazy(loader),
		};
	});

	return [record] as const;
}

export interface SortSpec {
	field: string;
	direction: 'asc' | 'desc';
}

function parseSort(sortStr: string): SortSpec[] {
	return sortStr.split(',').map(part => {
		const trimmed = part.trim();
		if (trimmed.startsWith('-')) {
			return { field: trimmed.slice(1), direction: 'desc' };
		}
		return { field: trimmed, direction: 'asc' };
	});
}
