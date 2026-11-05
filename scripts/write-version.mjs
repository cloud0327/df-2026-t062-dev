import { writeFile } from 'node:fs/promises'

const sha = process.env.GITHUB_SHA ?? 'local'
await writeFile('dist/version.json', JSON.stringify({ sha }) + '\n')
