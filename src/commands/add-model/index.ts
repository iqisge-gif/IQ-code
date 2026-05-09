import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'add-model',
  description: 'Add a model to a provider saved model list',
  argumentHint: '[provider-number] [model-id]',
  supportsNonInteractive: false,
  load: () => import('./add-model.js'),
} satisfies Command
