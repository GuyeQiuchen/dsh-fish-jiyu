/**
 * 宿主适配层：本包唯一 import `@deepseek-ai/*` 的地方。
 *
 * 为什么只许这一处：宿主包只在「物理住在 profile 里」时才解析得到
 * （2026-11-26 那次 link: 安装事故的根因）。把入口收敛到这一个文件后：
 *   - 换宿主要改的只有这里；
 *   - 边界测试可以扫「除本文件外不许出现 @deepseek-ai」；
 *   - 加载失败时错在这一处，报错指向明确。
 *
 * 只做转出，不加逻辑。
 */
import z from '@deepseek-ai/schemastery'
import {
  CompactionEngine,
  ManualCompactionError,
  CompactionId,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
import { CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import { assertNever, deepFreeze } from '@deepseek-ai/dsh-util-values'

export {
  z,
  CompactionEngine,
  ManualCompactionError,
  CompactionId,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createUserMessage,
  errorChain,
  assertNever,
  deepFreeze,
}
