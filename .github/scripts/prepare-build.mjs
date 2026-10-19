import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repository = process.env.GITHUB_REPOSITORY
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY must be owner/repository.')
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(
  version
)
if (!match) {
  throw new Error('Use x.y.z, x.y.z-alpha.n, x.y.z-beta.n or x.y.z-rc.n as the version.')
}
if (
  process.env.REQUIRE_RELEASE_TAG === 'true' &&
  (process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== `v${version}`)
) {
  throw new Error(`Release tag must be v${version}, matching package.json.`)
}

const [owner, repo] = repository.split('/')
const channel = match[4] || 'latest'
const tempDirectory = process.env.RUNNER_TEMP
if (!tempDirectory || !process.env.GITHUB_OUTPUT) {
  throw new Error('RUNNER_TEMP and GITHUB_OUTPUT are required.')
}
mkdirSync(tempDirectory, { recursive: true })
const configPath = join(tempDirectory, 'electron-builder-ci.json')
writeFileSync(
  configPath,
  JSON.stringify({
    extends: resolve('electron-builder.yml'),
    directories: { output: 'dist' },
    // Override the template URL; each installed CI build points to this repository.
    publish: [{ provider: 'github', owner, repo, channel }]
  })
)
appendFileSync(process.env.GITHUB_OUTPUT, `config-path=${configPath}\nchannel=${channel}\n`)
console.log(`Building ${version} for ${repository} (${channel} channel).`)
