import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'remove-model',
  description: '从 provider 的已保存模型列表移除模型',
  argumentHint: '[provider-number] [model-id]',
  supportsNonInteractive: false,
  load: () => import('./remove-model'),
} satisfies Command
