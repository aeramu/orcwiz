export function getUniqueProjectPaths(tasks: { project_path: string }[]): string[] {
  const paths = tasks.map(t => t.project_path).filter(p => p && p.trim() !== '');
  return Array.from(new Set(paths)).sort();
}
