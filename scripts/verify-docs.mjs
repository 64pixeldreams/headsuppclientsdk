import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSource = readFileSync(join(root, 'src/client.js'), 'utf8');

const returnIndex = clientSource.indexOf('return {');
if (returnIndex < 0) {
  console.error('verify-docs: could not find return block in src/client.js');
  process.exit(1);
}

const clientMethods = new Set(
  [
    ...clientSource.slice(returnIndex).matchAll(/\n    ([a-zA-Z][a-zA-Z0-9_]*):/g),
    ...clientSource.slice(returnIndex).matchAll(/\n    ([a-zA-Z][a-zA-Z0-9_]*),/g),
  ].map((match) => match[1]),
);

const allowedAliases = new Set(['headsup', 'operator', 'client']);
const phantomCalls = [];

function walkMarkdown(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walkMarkdown(fullPath);
      continue;
    }
    if (!entry.endsWith('.md')) continue;
    const text = readFileSync(fullPath, 'utf8');
    for (const match of text.matchAll(/\b(headsup|operator|client)\.([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g)) {
      const variable = match[1];
      const method = match[2];
      if (!allowedAliases.has(variable)) continue;
      if (clientMethods.has(method)) continue;
      phantomCalls.push({ file: fullPath.slice(root.length + 1).replace(/\\/g, '/'), method });
    }
  }
}

walkMarkdown(join(root, 'docs'));

if (phantomCalls.length) {
  console.error('verify-docs: docs reference SDK methods that do not exist on createHeadsUpClient:');
  for (const item of phantomCalls) {
    console.error(`  - ${item.file}: ${item.method}`);
  }
  console.error(`Known methods: ${[...clientMethods].sort().join(', ')}`);
  process.exit(1);
}

console.log(`verify-docs: ok (${clientMethods.size} client methods checked)`);
