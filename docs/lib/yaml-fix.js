export function viteYamlFix() {
  return {
    name: 'vite-yaml-fix',
    transform(code, id) {
      if (id.endsWith('.mdx') || id.endsWith('.md')) {
        const frontmatterMatch = code.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          let frontmatter = frontmatterMatch[1];
          
          frontmatter = frontmatter.replace(
            /^description:\s*(.+)$/gm,
            (match, value) => {
              if (value.includes('[') || value.includes(']') || value.includes(':')) {
                if (!value.startsWith('"') && !value.startsWith("'")) {
                  return `description: "${value.replace(/"/g, '\\"')}"`;
                }
              }
              return match;
            }
          );
          
          return code.replace(
            /^---\n[\s\S]*?\n---/,
            `---\n${frontmatter}\n---`
          );
        }
      }
      return code;
    }
  };
}
