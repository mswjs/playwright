import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  format: 'esm',
  outDir: './build',
  clean: true,
  dts: true,
})
