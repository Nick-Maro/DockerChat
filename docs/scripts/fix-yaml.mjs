import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixYamlInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  
  if (frontmatterMatch) {
    let frontmatter = frontmatterMatch[1];
    let modified = false;
    
    const newFrontmatter = frontmatter.replace(
      /^description:\s*(.+)$/gm,
      (match, value) => {
        if ((value.includes('[') || value.includes(']') || value.includes(':')) 
            && !value.startsWith('"') && !value.startsWith("'")) {
          modified = true;
          return `description: "${value.replace(/"/g, '\\"')}"`;
        }
        return match;
      }
    );
    
    if (modified) {
      const newContent = content.replace(
        /^---\n[\s\S]*?\n---/,
        `---\n${newFrontmatter}\n---`
      );
      
      // Create backup
      fs.writeFileSync(filePath + '.backup', content);
      fs.writeFileSync(filePath, newContent);
      console.log(`Fixed YAML in: ${filePath}`);
      return true;
    }
  }
  return false;
}

function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let fixedCount = 0;
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      fixedCount += processDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      if (fixYamlInFile(fullPath)) {
        fixedCount++;
      }
    }
  }
  
  return fixedCount;
}

const contentDir = path.join(__dirname, '..', 'content');
const fixedCount = processDirectory(contentDir);

console.log(`Fixed ${fixedCount} files. Backups created with .backup extension.`);
console.log('You can now run the build. To restore files, run: find . -name "*.backup" -exec sh -c \'mv "$1" "${1%.backup}"\' _ {} \\;');
