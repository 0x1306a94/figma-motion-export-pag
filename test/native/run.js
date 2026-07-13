const { mkdirSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')
const outputDirectory = join(root, 'dist', 'test-native')
const verifierPath = join(outputDirectory, 'verify')
const fixturePath = join(outputDirectory, 'solid.pag')
mkdirSync(outputDirectory, { recursive: true })

run('npx', ['tsx', join(__dirname, 'write-fixture.ts'), fixturePath])
run('c++', [
  '-std=c++17',
  '-arch',
  'arm64',
  '-I',
  join(root, 'libpag', 'include'),
  join(__dirname, 'verify.cpp'),
  join(root, 'build_libpag', 'libpag.a'),
  join(root, 'build_libpag', 'tgfx', 'tgfx.a'),
  join(root, 'build_libpag', 'CMakeFiles', 'pag-vendor.dir', 'arm64', 'libpag-vendor.a'),
  '-framework',
  'ApplicationServices',
  '-framework',
  'QuartzCore',
  '-framework',
  'Cocoa',
  '-framework',
  'Foundation',
  '-framework',
  'VideoToolbox',
  '-framework',
  'CoreMedia',
  '-framework',
  'OpenGL',
  '-liconv',
  '-lcompression',
  '-o',
  verifierPath,
])
run(verifierPath, [fixturePath])

function run(command, arguments) {
  const result = spawnSync(command, arguments, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
