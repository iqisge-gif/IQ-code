import * as React from 'react'
import { Box, Text } from '../../ink.js'

type Props = {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

export function NewInstallWizard(props: Props): React.ReactNode {
  void props.onInstalled
  void props.onCancel
  void props.onError
  return (
    <Box flexDirection="column">
      <Text>Assistant install wizard is unavailable in this build.</Text>
      <Text dimColor>Default dir: {props.defaultDir}</Text>
    </Box>
  )
}

export async function computeDefaultInstallDir(): Promise<string> {
  return '.assistant'
}
