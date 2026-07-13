import { writeFile } from 'node:fs/promises'
import { encodePagFile } from '../../src/export/pag/encode-file'
import { solidFixture } from '../fixtures'

async function main(): Promise<void> {
  await writeFile(process.argv[2], encodePagFile(solidFixture))
}

void main()
