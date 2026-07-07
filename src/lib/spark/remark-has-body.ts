// @sync context=vite remark-has-body.ts sha=767ddc363b4080ca5f818709fff19a416c5bfc8f
export default function remarkHasBody() {
	return tree => {
		const hasBody = tree.children.some(n => n.type !== 'yaml');
		tree.children.unshift({
			type: 'mdxjsEsm',
			value: '',
			data: {
				estree: {
					type: 'Program',
					sourceType: 'module',
					body: [
						{
							type: 'ExportNamedDeclaration',
							specifiers: [],
							declaration: {
								type: 'VariableDeclaration',
								kind: 'const',
								declarations: [
									{
										type: 'VariableDeclarator',
										id: { type: 'Identifier', name: 'hasBody' },
										init: { type: 'Literal', value: hasBody, raw: String(hasBody) },
									},
								],
							},
						},
					],
				},
			},
		});
	};
}
