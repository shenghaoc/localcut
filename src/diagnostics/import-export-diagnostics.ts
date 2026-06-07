import type { DiagnosticSeverity } from './types';

export type ImportFailureCode =
  | 'import.corrupt_media'
  | 'import.unsupported_container'
  | 'import.unsupported_codec'
  | 'import.descriptor_mismatch'
  | 'import.permission_denied'
  | 'import.user_canceled'
  | 'import.read_error'
  | 'import.unknown';

export type ExportFailureCode =
  | 'export.prepare_failed'
  | 'export.decode_failed'
  | 'export.render_failed'
  | 'export.encode_failed'
  | 'export.mux_failed'
  | 'export.write_failed'
  | 'export.device_lost'
  | 'export.permission_lost'
  | 'export.canceled'
  | 'export.unknown';

export type PermissionLossCode =
  | 'permission.source_lost'
  | 'permission.output_lost';

export interface ImportFailureDiagnostic {
  readonly code: ImportFailureCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly sourceAlias?: string;
  readonly recoveryHint: string;
}

export interface ExportFailureDiagnostic {
  readonly code: ExportFailureCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly recoveryHint: string;
  readonly settingsPreserved: boolean;
}

export interface PermissionLossDiagnostic {
  readonly code: PermissionLossCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly affectedSourceAlias?: string;
  readonly recoveryHint: string;
}

export function classifyImportError(errorMessage: string): ImportFailureDiagnostic {
  const lower = errorMessage.toLowerCase();

  if (lower.includes('permission') || lower.includes('not allowed')) {
    return {
      code: 'import.permission_denied',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Grant file access permission and try again.',
    };
  }
  if (lower.includes('abort') || lower.includes('cancel')) {
    return {
      code: 'import.user_canceled',
      severity: 'info',
      message: 'Import was canceled by the user.',
      recoveryHint: 'Re-import the file when ready.',
    };
  }
  if (lower.includes('unsupported') && lower.includes('codec')) {
    return {
      code: 'import.unsupported_codec',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Transcode the file to H.264/VP9/AV1 and import again.',
    };
  }
  if (lower.includes('unsupported') || lower.includes('not recognized') || lower.includes('unknown format')) {
    return {
      code: 'import.unsupported_container',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Convert to MP4, WebM, or MOV container and import again.',
    };
  }
  if (lower.includes('corrupt') || lower.includes('invalid') || lower.includes('parse') || lower.includes('malformed')) {
    return {
      code: 'import.corrupt_media',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'The file may be damaged. Try re-downloading or re-encoding it.',
    };
  }
  if (lower.includes('read') || lower.includes('io error') || lower.includes('network')) {
    return {
      code: 'import.read_error',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Check the file is accessible and try again.',
    };
  }
  return {
    code: 'import.unknown',
    severity: 'error',
    message: errorMessage,
    recoveryHint: 'Check the diagnostics panel for details and try again.',
  };
}

export function classifyExportError(errorMessage: string): ExportFailureDiagnostic {
  const lower = errorMessage.toLowerCase();

  if (lower.includes('device lost') || lower.includes('device_lost')) {
    return {
      code: 'export.device_lost',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'GPU device was lost during export. Reload the app and retry.',
      settingsPreserved: true,
    };
  }
  if (lower.includes('permission') || lower.includes('not allowed')) {
    return {
      code: 'export.permission_lost',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Output file permission was lost. Choose a new output location and retry.',
      settingsPreserved: true,
    };
  }
  if (lower.includes('encode')) {
    return {
      code: 'export.encode_failed',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'The encoder encountered an error. Try a different codec or lower resolution.',
      settingsPreserved: true,
    };
  }
  if (lower.includes('decode')) {
    return {
      code: 'export.decode_failed',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'A source could not be decoded during export. Check source health in diagnostics.',
      settingsPreserved: true,
    };
  }
  if (lower.includes('mux') || lower.includes('container')) {
    return {
      code: 'export.mux_failed',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Container muxing failed. Try a different container format.',
      settingsPreserved: true,
    };
  }
  if (lower.includes('write') || lower.includes('disk') || lower.includes('quota')) {
    return {
      code: 'export.write_failed',
      severity: 'error',
      message: errorMessage,
      recoveryHint: 'Could not write the output file. Check disk space and permissions.',
      settingsPreserved: true,
    };
  }
  return {
    code: 'export.unknown',
    severity: 'error',
    message: errorMessage,
    recoveryHint: 'Export failed. Settings are preserved for retry.',
    settingsPreserved: true,
  };
}
