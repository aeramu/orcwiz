export function getUniqueProjectPaths(tasks: { project_path: string }[]): string[] {
  const paths = tasks.map(t => t.project_path).filter(p => p && p.trim() !== '');
  return Array.from(new Set(paths)).sort();
}

export function getRelativePath(fullPath: string, rootPath: string): string {
  if (!fullPath || !rootPath) return '';
  if (fullPath === rootPath) return './';
  if (fullPath.startsWith(rootPath)) {
    let rel = fullPath.substring(rootPath.length);
    if (rel.startsWith('/')) {
      rel = rel.substring(1);
    }
    return './' + rel;
  }
  return fullPath;
}

