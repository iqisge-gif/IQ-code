import * as React from 'react'
import { Box, Text } from '../ink.js'
import type { AssistantSession } from './sessionDiscovery.js'

type Props = {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}

export function AssistantSessionChooser(props: Props): React.ReactNode {
  void props.sessions
  void props.onSelect
  void props.onCancel
  return (
    <Box flexDirection="column">
      <Text>Assistant session chooser is unavailable in this build.</Text>
    </Box>
  )
}
