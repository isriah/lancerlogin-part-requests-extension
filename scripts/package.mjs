// Zips dist for students, with the version in the name: release/robotics-part-requests-<version>.zip. Run through `npm run package`.
// The zip format is written here so packaging needs no extra dependency and behaves the same on every computer.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

// A package must never carry a test build's permissions.
const refuse = message => { console.error(`Not packaging: ${message}`); process.exit(1); };
if (manifest.version !== pkg.version) refuse(`manifest version ${manifest.version} does not match package.json ${pkg.version}.`);
if (JSON.stringify(manifest.optional_host_permissions) !== '["https://*/*"]') refuse('optional_host_permissions must be exactly https://*/*.');
if (manifest.host_permissions) refuse('host_permissions must be absent.');
if (/localhost|http:/.test(JSON.stringify(manifest))) refuse('the manifest mentions http or localhost.');

const files = readdirSync(dist, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
const locals = [], centrals = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative(dist, file).replaceAll('\\', '/'));
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const shared = Buffer.alloc(26);
  shared.writeUInt16LE(20, 0); shared.writeUInt16LE(0x0800, 2); shared.writeUInt16LE(8, 4);
  shared.writeUInt16LE(0, 6); shared.writeUInt16LE(0x21, 8); // A fixed date keeps two builds of the same files identical.
  shared.writeUInt32LE(crc32(data), 10); shared.writeUInt32LE(packed.length, 14); shared.writeUInt32LE(data.length, 18);
  shared.writeUInt16LE(name.length, 22); shared.writeUInt16LE(0, 24);
  const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), shared, name, packed]);
  const tail = Buffer.alloc(14); tail.writeUInt32LE(offset, 10);
  centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), shared, tail, name]));
  locals.push(local);
  offset += local.length;
}
const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);

mkdirSync(join(root, 'release'), { recursive: true });
const output = join(root, 'release', `robotics-part-requests-${pkg.version}.zip`);
writeFileSync(output, Buffer.concat([...locals, directory, end]));
console.log(`Packaged ${files.length} files into release/robotics-part-requests-${pkg.version}.zip`);
