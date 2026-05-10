import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'add-model',
  description: '向 provider 的已保存模型列表添加模型',
  argumentHint: '[provider-number] [model-id]',
  supportsNonInteractive: false,
  load: () => import('./add-model.js'),
} satisfies Command
