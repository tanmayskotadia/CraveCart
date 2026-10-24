import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/identity/**/*.test.ts'],fileParallelism:false,testTimeout:30_000,hookTimeout:120_000,env:{NODE_ENV:'test',LOG_LEVEL:'silent'}}});
