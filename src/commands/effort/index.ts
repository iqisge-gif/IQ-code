import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

export default {
  type: 'local-jsx',
  name: 'effort',
  description: '设置模型使用时的推理强度',
  argumentHint: '[low|medium|high|max|token节省最大智商|auto]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./effort.js'),
} satisfies Command
