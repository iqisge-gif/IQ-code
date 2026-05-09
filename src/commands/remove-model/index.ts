import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'remove-model',
  description: 'Remove a model from a provider saved model list',
  argumentHint: '[provider-number] [model-id]',
  supportsNonInteractive: false,
  load: () => import('./remove-model'),
} satisfies Command
