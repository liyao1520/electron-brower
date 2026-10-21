import { readFileSync } from 'node:fs'

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

console.log(`Building ${version}.`)
