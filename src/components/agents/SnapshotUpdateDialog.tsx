import * as React from 'react'
import { Box, Text } from '../../ink.js'

type Props = {
  agentType: string
  scope: string
  snapshotTimestamp: string
  onComplete: (value: 'merge' | 'keep' | 'replace') => void
  onCancel: () => void
}

export function SnapshotUpdateDialog(props: Props): React.ReactNode {
  void props.agentType
  void props.scope
  void props.snapshotTimestamp
  return (
    <Box flexDirection="column">
      <Text>Snapshot update dialog is unavailable in this build.</Text>
      <Text dimColor>Using keep by default.</Text>
    </Box>
  )
}
