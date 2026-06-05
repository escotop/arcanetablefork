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
