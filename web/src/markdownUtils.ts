export function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Code blocks: ```language ... ``` or ``` ... ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-xs text-gray-300 my-3 overflow-x-auto whitespace-pre select-all">${code.trim()}</pre>`;
  });
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
    return `<pre class="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-xs text-gray-300 my-3 overflow-x-auto whitespace-pre select-all">${code.trim()}</pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-gray-950 border border-gray-800 rounded px-1.5 py-0.5 font-mono text-xs text-indigo-300 font-medium">$1</code>');

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-100">$1</strong>');

  return html;
}
