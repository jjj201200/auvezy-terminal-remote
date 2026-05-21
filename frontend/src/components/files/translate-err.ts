/**
 * 错误码 → i18n 文案。
 *
 * Why: FileBrowserSheet 与 TextPreview 都要把后端 ErrorCode 翻译为用户文案,
 * 之前两份重复 switch 各自维护,极易漂移(漏一个 case 就退化成 errorUnknown)。
 */

import { ErrorCode } from 'auvezy-terminal-remote-shared';
import type { useT } from '../../i18n/i18n-context.js';

type T = ReturnType<typeof useT>;

export function translateFileErr(t: T, code: string | undefined): string {
  switch (code) {
    case ErrorCode.PATH_NOT_FOUND: return t('files.errorPathNotFound');
    case ErrorCode.PATH_FORBIDDEN: return t('files.errorPathForbidden');
    case ErrorCode.FILE_BINARY: return t('files.errorFileBinary');
    case ErrorCode.AUTH_RATE_LIMITED: return t('files.errorRateLimited');
    default: return t('files.errorUnknown');
  }
}
