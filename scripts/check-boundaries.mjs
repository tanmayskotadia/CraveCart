import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

let failures = 0;
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!['dist', 'node_modules'].includes(entry.name)) await scan(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const source = await readFile(full, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) {
      const imported = match[1];
      if (
        /services[\\/]/.test(imported) ||
        /@cravecart\/(auth|restaurant|rider|admin|realtime|utils)(?:\/|$)/.test(imported)
      ) {
        console.error(`Cross-service source import: ${full} -> ${imported}`);
        failures++;
      }
    }
  }
}
for (const path of ['packages', 'services', 'apps']) await scan(path);
if (failures) process.exit(1);
console.log('Service ownership import boundaries passed.');
