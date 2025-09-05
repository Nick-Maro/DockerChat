export function remarkFixYamlFrontmatter() {
  return (tree, file) => {
    if (file.value && typeof file.value === 'string') {
      const frontmatterMatch = file.value.match(/^---\n([\s\S]*?)\n---/);
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
        
        file.value = file.value.replace(
          /^---\n[\s\S]*?\n---/,
          `---\n${frontmatter}\n---`
        );
      }
    }
  };
}
