import path from 'path';
import fs from 'fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import {defineConfig} from 'vite';

const spaceui = path.resolve(__dirname, '../../../spaceui/packages');
const hasSpaceui = fs.existsSync(spaceui);

export default defineConfig(() => ({
	plugins: [react(), tailwindcss()],

	resolve: {
		dedupe: ['react', 'react-dom'],
		alias: [
			{
				find: /^react$/,
				replacement: path.resolve(
					__dirname,
					'./node_modules/react/index.js'
				)
			},
			{
				find: /^react\/jsx-runtime$/,
				replacement: path.resolve(
					__dirname,
					'./node_modules/react/jsx-runtime.js'
				)
			},
			{
				find: /^react\/jsx-dev-runtime$/,
				replacement: path.resolve(
					__dirname,
					'./node_modules/react/jsx-dev-runtime.js'
				)
			},
			{
				find: /^react-dom$/,
				replacement: path.resolve(
					__dirname,
					'./node_modules/react-dom/index.js'
				)
			},
			{
				find: /^react-dom\/client$/,
				replacement: path.resolve(
					__dirname,
					'./node_modules/react-dom/client.js'
				)
			},
			{
				find: 'openapi-fetch',
				replacement: path.resolve(
					__dirname,
					'../../packages/interface/node_modules/openapi-fetch/dist/index.mjs'
				)
			},
			// SpaceUI — resolve to source for HMR when available locally
			...(hasSpaceui
				? [
						{
							find: /^@spacedrive\/primitives$/,
							replacement: `${spaceui}/primitives/src/index.ts`,
						},
					]
				: []),
			{
				find: '@sd/interface',
				replacement: path.resolve(
					__dirname,
					'../../packages/interface/src'
				)
			},
			{
				find: '@sd/ts-client',
				replacement: path.resolve(
					__dirname,
					'../../packages/ts-client/src'
				)
			}
		]
	},

	optimizeDeps: {
		exclude: ['@spacedrive/primitives']
	},

	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		fs: {
			allow: [
				path.resolve(__dirname, '../../..'),
				...(hasSpaceui ? [spaceui] : []),
			]
		},
		watch: {
			ignored: ['**/src-tauri/**']
		}
	},
	envPrefix: ['VITE_', 'TAURI_ENV_*'],
	build: {
		target: ['es2021', 'chrome100', 'safari13'],
		minify: !process.env.TAURI_ENV_DEBUG ? ('esbuild' as const) : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG
	}
}));
