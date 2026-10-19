import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并条件类名并处理 Tailwind 冲突，让调用方可覆盖组件默认样式。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
