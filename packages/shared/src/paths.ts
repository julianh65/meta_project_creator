import path from "node:path";

export interface AppPaths {
  rootPath: string;
  dataDir: string;
  dbPath: string;
  projectsDir: string;
  workerPromptDir: string;
}

export function createAppPaths(rootPath = process.env.STARTUP_OS_ROOT ?? process.cwd()): AppPaths {
  const absoluteRoot = path.resolve(rootPath);

  return {
    rootPath: absoluteRoot,
    dataDir: path.join(absoluteRoot, "data"),
    dbPath: process.env.STARTUP_OS_DB_PATH
      ? path.resolve(process.env.STARTUP_OS_DB_PATH)
      : path.join(absoluteRoot, "data", "app.db"),
    projectsDir: process.env.STARTUP_OS_PROJECTS_DIR
      ? path.resolve(process.env.STARTUP_OS_PROJECTS_DIR)
      : path.join(absoluteRoot, "projects"),
    workerPromptDir: path.join(absoluteRoot, "data", "worker-prompts")
  };
}
