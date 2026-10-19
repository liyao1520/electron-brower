import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const channel = process.env.UPDATE_CHANNEL
if (!['latest', 'alpha', 'beta', 'rc'].includes(channel)) {
  throw new Error('Missing or unsupported UPDATE_CHANNEL.')
}
if (!process.env.RUNNER_TEMP || !process.env.GITHUB_OUTPUT) {
  throw new Error('RUNNER_TEMP and GITHUB_OUTPUT are required.')
}

const files = readdirSync('dist')
const installers = files.filter((file) => file.endsWith('-setup.exe'))
if (installers.length !== 1) {
  throw new Error('Expected exactly one Windows NSIS installer.')
}
const assets = [installers[0], `${installers[0]}.blockmap`, `${channel}.yml`]
for (const file of assets) {
  if (!existsSync(join('dist', file))) {
    throw new Error(`Missing release asset: ${file}`)
  }
}

const destination = join(process.env.RUNNER_TEMP, 'release-assets')
mkdirSync(destination, { recursive: true })
for (const file of assets) {
  copyFileSync(join('dist', file), join(destination, file))
}
appendFileSync(process.env.GITHUB_OUTPUT, `path=${destination}\n`)
console.log(`Collected ${assets.join(', ')}`)
