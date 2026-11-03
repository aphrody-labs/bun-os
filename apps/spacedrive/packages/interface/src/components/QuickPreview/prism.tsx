// @ts-ignore - stylesheet URL import
import prismCss from './prism-m3.css?url';

export const languageMapping = Object.entries({
	applescript: ['scpt', 'scptd'],
	sh: ['zsh', 'fish'],
	c: ['h'],
	cpp: ['hpp'],
	js: ['mjs'],
	crystal: ['cr'],
	cs: ['csx'],
	makefile: ['make'],
	nim: ['nims'],
	objc: ['m', 'mm'],
	ocaml: ['ml', 'mli', 'mll', 'mly'],
	perl: ['pl'],
	php: ['php', 'php1', 'php2', 'php3', 'php4', 'php5', 'php6', 'phps', 'phpt', 'phtml'],
	powershell: ['ps1', 'psd1', 'psm1'],
	rust: ['rs']
}).reduce<Map<string, string>>((mapping, [id, exts]) => {
	for (const ext of exts) mapping.set(ext, id);
	return mapping;
}, new Map());

// The sheet binds every token to an M3 role, so it follows the active scheme (light or dark) by itself.
export function WithPrismTheme() {
	return <link rel="stylesheet" href={prismCss} />;
}
