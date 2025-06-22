export enum SandboxType {
  NONE = "none",
  MACOS_SEATBELT = "macos.seatbelt",
  LINUX_LANDLOCK = "linux.landlock",
}

export interface ExecInput {
  cmd: Array<string>;
  workdir?: string;
  timeoutInMillis?: number;
  additionalWritableRoots?: Array<string>;
  runInBackground?: boolean;
}

/**
 * Result of executing a command. Caller is responsible for checking `code` to
 * determine whether the command was successful.
 */
export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Value to use with the `metadata` field of a `ResponseItem` whose type is
 * `function_call_output`.
 */
export type ExecOutputMetadata = {
  exit_code: number;
  duration_seconds: number;
};
