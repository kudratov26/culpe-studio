// The `sbx run -d opencode` spec used to create an agent's sandbox.

export function opencodeSandboxSpec(
  name: string,
  dir: string,
  size: { cpus: number | null; memoryGb: number | null },
  envFile: string | null,
): { file: string; args: string[] } {
  const { cpus, memoryGb } = size;
  return {
    file: "sbx",
    args: [
      "run",
      "-d",
      "--name",
      name,
      ...(cpus ? ["--cpus", String(cpus)] : []),
      ...(memoryGb ? ["--memory", `${Math.round(memoryGb * 1024)}m`] : []),
      ...(envFile ? ["--env-file", envFile] : []),
      "-e",
      "BROWSER=/usr/local/bin/xdg-open",
      "opencode",
      dir,
    ],
  };
}
