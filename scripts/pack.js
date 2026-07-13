const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');
const { join } = require('path');

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const bundleName = `figma-motion-export-pag-${version}`;
const distDir = join(root, 'dist');
const outDir = join(distDir, bundleName);
const zipPath = join(distDir, `${bundleName}.zip`);

const copyFiles = ['manifest.json', 'ui.html', 'code.js', 'LICENSE'];

for (const file of copyFiles) {
  const source = join(root, file);
  if (!existsSync(source)) {
    console.error(`Missing required file: ${file}. Run "npm run build" first.`);
    process.exit(1);
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of copyFiles) {
  cpSync(join(root, file), join(outDir, file));
}

const readme = `Figma Motion to PAG (Beta) v${version}

Install:
1. Unzip this archive if needed.
2. Open Figma Desktop.
3. Go to Plugins → Development → Import plugin from manifest…
4. Select manifest.json in this folder.

Source: https://github.com/0x1306a94/figma-motion-export-pag
`;

writeFileSync(join(outDir, 'README.txt'), readme, 'utf8');

rmSync(zipPath, { force: true });
execSync(`zip -rq "${zipPath}" "${bundleName}"`, { cwd: distDir, stdio: 'inherit' });

console.log(`Packed directory: dist/${bundleName}/`);
console.log(`Packed archive: dist/${bundleName}.zip`);
