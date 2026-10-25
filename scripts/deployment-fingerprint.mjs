import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Deployment inputs only: excludes credentials, local data, generated output and operator evidence.
export async function deploymentFingerprint(root = process.cwd()) {
  const files = [],
    ignored = new Set(['node_modules', 'dist', '__pycache__']);
  async function walk(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (
        ignored.has(item.name) ||
        item.name.endsWith('.tsbuildinfo') ||
        item.name.startsWith('.env')
      )
        continue;
      if (item.isSymbolicLink())
        throw new Error('Deployment source must not contain symbolic links');
      const child = join(path, item.name);
      if (item.isDirectory()) await walk(child);
      else files.push(child);
    }
  }
  for (const name of ['apps', 'packages', 'services', 'contracts', 'design', 'scripts', 'infra']) {
    try {
      await walk(join(root, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const name of [
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    'tsconfig.build.json',
    '.nvmrc',
    'render.yaml',
  ])
    files.push(join(root, name));
  const hash = createHash('sha256').update('cravecart-deployment-v1\0');
  for (const file of files.sort()) {
    const path = relative(root, file).replaceAll('\\', '/');
    const raw = await readFile(file);
    const normalized =
      /\.(?:ts|tsx|js|mjs|json|css|html|md|yml|yaml|svg|py|txt|sh)$/.test(path) || path === '.nvmrc'
        ? Buffer.from(raw.toString('utf8').replaceAll('\r\n', '\n'))
        : raw;
    hash.update(path + '\0' + normalized.length + '\0');
    hash.update(normalized);
  }
  return hash.digest('hex');
}
