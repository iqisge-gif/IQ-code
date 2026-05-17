const IS_TERMUX = Boolean(
  process.env.TERMUX_VERSION ||
    process.env.PREFIX?.includes('/com.termux/') ||
    process.env.HOME?.startsWith('/data/data/com.termux/'),
)

const TERMUX_TMP_DIR = IS_TERMUX
  ? process.env.TMPDIR || process.env.TEMP || process.env.HOME
  : undefined

export function isTermux(): boolean {
  return IS_TERMUX
}

export function getTermuxTmpDir(): string | undefined {
  return TERMUX_TMP_DIR
}
