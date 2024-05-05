import path from 'node:path';
import { execaNode } from 'execa';
import { testSuite, expect } from 'manten';
import { createFixture } from 'fs-fixture';
import {
	tsxCjsPath,
	tsxCjsApiPath,
	tsxEsmPath,
	tsxEsmApiPath,
	tsxEsmApiCjsPath,
	type NodeApis,
} from '../utils/tsx.js';

const tsFiles = {
	'file.ts': `
	import { foo } from './foo'
	export const message = foo as string
	`,
	'foo.ts': `
	import { bar } from './bar.js'
	export const foo = \`foo \${bar}\` as string
	`,
	'bar.ts': 'export type A = 1; export { bar } from "pkg"',
	'node_modules/pkg': {
		'package.json': JSON.stringify({
			name: 'pkg',
			type: 'module',
			exports: './index.js',
		}),
		'index.js': 'export const bar = "bar"',
	},
};

export default testSuite(({ describe }, node: NodeApis) => {
	describe('API', ({ describe }) => {
		describe('CommonJS', ({ test }) => {
			test('cli', async ({ onTestFinish }) => {
				const fixture = await createFixture({
					'index.ts': 'import { message } from \'./file\';\n\nconsole.log(message, new Error().stack);',
					...tsFiles,
				});
				onTestFinish(async () => await fixture.rm());

				const { stdout } = await execaNode(path.join(fixture.path, 'index.ts'), {
					nodePath: node.path,
					nodeOptions: ['--require', tsxCjsPath],
				});
				expect(stdout).toContain('foo bar');
				expect(stdout).toContain('index.ts:3:22');
			});

			test('register / unregister', async ({ onTestFinish }) => {
				const fixture = await createFixture({
					'register.cjs': `
					const { register } = require(${JSON.stringify(tsxCjsApiPath)});
					try {
						require('./file');
					} catch {
						console.log('Fails as expected');
					}

					const unregister = register();

					const loaded = require('./file');
					console.log(loaded.message);

					// Remove from cache
					const loadedPath = require.resolve('./file');
					delete require.cache[loadedPath];

					unregister();

					try {
						require('./file');
					} catch {
						console.log('Unregistered');
					}
					`,
					...tsFiles,
				});
				onTestFinish(async () => await fixture.rm());

				const { stdout } = await execaNode(path.join(fixture.path, 'register.cjs'), [], {
					nodePath: node.path,
					nodeOptions: [],
				});

				expect(stdout).toBe('Fails as expected\nfoo bar\nUnregistered');
			});

			describe('tsx.require()', ({ test }) => {
				test('loads', async ({ onTestFinish }) => {
					const fixture = await createFixture({
						'require.cjs': `
						const path = require('node:path');
						const tsx = require(${JSON.stringify(tsxCjsApiPath)});
						try {
							require('./file');
						} catch {
							console.log('Fails as expected');
						}

						const loaded = tsx.require('./file', __filename);
						console.log(loaded.message);

						// Remove from cache
						const loadedPath = tsx.require.resolve('./file', __filename);
						console.log(loadedPath.split(path.sep).pop());
						delete require.cache[loadedPath];

						try {
							require('./file');
						} catch {
							console.log('Unpolluted global require');
						}
						`,
						...tsFiles,
					});
					onTestFinish(async () => await fixture.rm());

					const { stdout } = await execaNode(path.join(fixture.path, 'require.cjs'), [], {
						nodePath: node.path,
						nodeOptions: [],
					});

					expect(stdout).toBe('Fails as expected\nfoo bar\nfile.ts\nUnpolluted global require');
				});

				test('catchable', async ({ onTestFinish }) => {
					const fixture = await createFixture({
						'require.cjs': `
						const tsx = require(${JSON.stringify(tsxCjsApiPath)});
						try { tsx.require('./file', __filename); } catch {}
						`,
						'file.ts': 'if',
					});
					onTestFinish(async () => await fixture.rm());

					const { all } = await execaNode(path.join(fixture.path, 'require.cjs'), [], {
						nodePath: node.path,
						nodeOptions: [],
						all: true,
					});
					expect(all).toBe('');
				});
			});
		});

		describe('module', ({ describe, test }) => {
			test('cli', async ({ onTestFinish }) => {
				const fixture = await createFixture({
					'package.json': JSON.stringify({ type: 'module' }),
					'index.ts': 'import { message } from \'./file\';\n\nconsole.log(message, new Error().stack);',
					...tsFiles,
				});
				onTestFinish(async () => await fixture.rm());

				const { stdout } = await execaNode(path.join(fixture.path, 'index.ts'), {
					nodePath: node.path,
					nodeOptions: [node.supports.moduleRegister ? '--import' : '--loader', tsxEsmPath],
				});
				expect(stdout).toContain('foo bar');
				expect(stdout).toContain('index.ts:3:22');
			});

			if (node.supports.moduleRegister) {
				test('module.register', async ({ onTestFinish }) => {
					const fixture = await createFixture({
						'package.json': JSON.stringify({ type: 'module' }),
						'module-register.mjs': `
						import { register } from 'node:module';

						await import('./file.ts').catch((error) => {
							console.log('Fails as expected');
						});

						register(${JSON.stringify(tsxEsmPath)}, {
							parentURL: import.meta.url,
							data: true,
						})

						const { message } = await import('./file.ts?nocache')
						console.log(message)
						`,
						...tsFiles,
					});
					onTestFinish(async () => await fixture.rm());

					const { stdout } = await execaNode(path.join(fixture.path, 'module-register.mjs'), [], {
						nodePath: node.path,
						nodeOptions: [],
					});

					expect(stdout).toBe('Fails as expected\nfoo bar');
				});

				describe('register / unregister', ({ test }) => {
					test('register / unregister', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'register.mjs': `
							import { register } from ${JSON.stringify(tsxEsmApiPath)};
							try {
								await import('./file.ts?1');
							} catch {
								console.log('Fails as expected 1');
							}
	
							const unregister = register();
	
							const { message } = await import('./file?2');
							console.log(message);
	
							await unregister();
	
							try {
								await import('./file.ts?3');
							} catch {
								console.log('Fails as expected 2');
							}
							`,
							...tsFiles,
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'register.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('Fails as expected 1\nfoo bar\nFails as expected 2');
					});

					test('import from an absolute path', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'register.mjs': `
							import path from 'node:path';
							import { fileURLToPath } from 'node:url';

							import { register } from ${JSON.stringify(tsxEsmApiPath)};	
							const unregister = register();

							const __dirname = path.dirname(fileURLToPath(new URL(import.meta.url)));
							const moduleAbsolutePath = path.join(__dirname, './file.ts');	
							const { message } = await import(moduleAbsolutePath);
							console.log(message);
	
							await unregister();
							`,
							...tsFiles,
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'register.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('foo bar');
					});

					test('onImport', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'register.mjs': `
							import { register } from ${JSON.stringify(tsxEsmApiPath)};

							const unregister = register({
								onImport(file) {
									console.log(file.split('/').pop());
								},
							});
	
							await import('./file');
							`,
							...tsFiles,
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'register.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('file.ts\nfoo.ts\nbar.ts\nindex.js');
					});
				});

				// add CJS test
				describe('tsImport()', ({ test }) => {
					test('module', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'import.mjs': `
							import { tsImport } from ${JSON.stringify(tsxEsmApiPath)};
	
							await import('./file.ts').catch((error) => {
								console.log('Fails as expected 1');
							});
	
							const { message } = await tsImport('./file.ts', import.meta.url);
							console.log(message);
	
							const { message: message2 } = await tsImport('./file.ts?with-query', import.meta.url);
							console.log(message2);
	
							// Global not polluted
							await import('./file.ts?nocache').catch((error) => {
								console.log('Fails as expected 2');
							});
							`,
							...tsFiles,
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'import.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('Fails as expected 1\nfoo bar\nfoo bar\nFails as expected 2');
					});

					test('commonjs', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'import.cjs': `
							const { tsImport } = require(${JSON.stringify(tsxEsmApiCjsPath)});
	
							(async () => {
								await import('./file.ts').catch((error) => {
									console.log('Fails as expected 1');
								});
		
								const { message } = await tsImport('./file.ts', __filename);
								console.log(message);
		
								const { message: message2 } = await tsImport('./file.ts?with-query', __filename);
								console.log(message2);
		
								// Global not polluted
								await import('./file.ts?nocache').catch((error) => {
									console.log('Fails as expected 2');
								});
							})();
							`,
							...tsFiles,
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'import.cjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('Fails as expected 1\nfoo bar\nfoo bar\nFails as expected 2');
					});

					test('namespace allows async nested calls', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'import.mjs': `
							import { tsImport } from ${JSON.stringify(tsxEsmApiPath)};
							tsImport('./file.ts', import.meta.url);
							import('./file.ts').catch(() => console.log('Fails as expected'))
							`,
							'file.ts': 'import(\'./foo.ts\')',
							'foo.ts': 'console.log(\'foo\' as string)',
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'import.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('Fails as expected\nfoo');
					});

					test('onImport', async ({ onTestFinish }) => {
						const fixture = await createFixture({
							'package.json': JSON.stringify({ type: 'module' }),
							'import.mjs': `
							import { tsImport } from ${JSON.stringify(tsxEsmApiPath)};
							tsImport('./file.ts', {
								parentURL: import.meta.url,
								onImport(file) {
									console.log(file.split('/').pop());
								},
							});
							`,
							'file.ts': 'import(\'./foo.ts\')',
							'foo.ts': 'console.log(\'foo\' as string)',
						});
						onTestFinish(async () => await fixture.rm());

						const { stdout } = await execaNode(path.join(fixture.path, 'import.mjs'), [], {
							nodePath: node.path,
							nodeOptions: [],
						});
						expect(stdout).toBe('file.ts\nfoo.ts\nfoo');
					});
				});
			}
		});
	});
});
