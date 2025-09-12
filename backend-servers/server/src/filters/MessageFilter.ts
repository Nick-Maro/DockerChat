import { readdir, readFile, exists } from 'node:fs/promises';
import { join } from 'node:path';
import { printDebug, DebugLevel } from '../../utils/utils';

interface FilterPattern {
    pattern: RegExp;
    replacement: string;
    category: string;
}

export class MessageFilter {
    private patterns: FilterPattern[] = [];
    private loaded = false;

    public async loadLDNOOBWLists(dirPath: string = './filters'): Promise<void> {
        try {
            printDebug(`[FILTER] Loading from directory: ${dirPath}`, DebugLevel.LOG);
            
            const files = await readdir(dirPath);
            const txtFiles = files.filter(f => !f.includes('.') || f.endsWith('.txt'));
            
            printDebug(`[FILTER] Found ${txtFiles.length} txt files: ${txtFiles.join(', ')}`, DebugLevel.LOG);
            
            for (const file of txtFiles) {
                const filePath = join(dirPath, file);
                const content = await readFile(filePath, 'utf8');
                const category = file.replace('.txt', '');
                
                const words = content
                    .split(/\r?\n/)
                    .map(w => w.trim())
                    .filter(w => w.length > 0);
                
                printDebug(`[FILTER] Loading ${words.length} words from ${file}`, DebugLevel.LOG);
                
                for (const word of words) {
                    this.patterns.push({
                        pattern: new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'gi'),
                        replacement: '*'.repeat(word.length),
                        category
                    });
                }
            }
            
            printDebug(`[FILTER] Loaded ${this.patterns.length} total patterns`, DebugLevel.LOG);
            this.loaded = true;
            
        } catch (error) {
            printDebug(`[FILTER] Error loading word lists: ${error}`, DebugLevel.ERROR);
        }
    }

    public async loadPatternsFromFile(filePath: string = './filters/custom-filters.json'): Promise<void> {
        try {
            printDebug(`[FILTER] Loading custom patterns from: ${filePath}`, DebugLevel.LOG);
            
            const fileExists = await exists(filePath);
            if (!fileExists) {
                printDebug(`[FILTER] Custom patterns file not found: ${filePath}`, DebugLevel.WARN);
                return;
            }
            
            const content = await readFile(filePath, 'utf8');
            const customPatterns = JSON.parse(content);
            
            if (Array.isArray(customPatterns)) {
                for (const p of customPatterns) {
                    if (p.pattern && p.replacement && p.category) {
                        this.patterns.push({
                            pattern: new RegExp(p.pattern, p.flags || 'gi'),
                            replacement: p.replacement,
                            category: p.category
                        });
                    }
                }
                printDebug(`[FILTER] Loaded ${customPatterns.length} custom patterns`, DebugLevel.LOG);
            }
        } catch (error) {
            printDebug(`[FILTER] Error loading custom patterns: ${error}`, DebugLevel.ERROR);
        }
    }

    public filterMessage(message: string): string {
        if (!this.loaded || this.patterns.length === 0) {
            printDebug(`[FILTER] No patterns loaded, returning original message`, DebugLevel.LOG);
            return message;
        }
        
        let filtered = message;
        let replacements = 0;
        
        for (const p of this.patterns) {
            const before = filtered;
            filtered = filtered.replace(p.pattern, p.replacement);
            if (before !== filtered) {
                replacements++;
            }
        }
        
        if (replacements > 0) {
            printDebug(`[FILTER] Made ${replacements} replacements in message`, DebugLevel.LOG);
        }
        
        return filtered;
    }

    public containsFilteredContent(message: string): boolean {
        if (!this.loaded || this.patterns.length === 0) {
            return false;
        }
        
        const hasFiltered = this.patterns.some(p => p.pattern.test(message));
        if (hasFiltered) {
            printDebug(`[FILTER] Detected filtered content in message`, DebugLevel.LOG);
        }
        
        return hasFiltered;
    }

    public addPattern(pattern: FilterPattern): void {
        this.patterns.push(pattern);
        printDebug(`[FILTER] Added pattern for category: ${pattern.category}`, DebugLevel.LOG);
    }

    public removePatternsByCategory(category: string): void {
        const before = this.patterns.length;
        this.patterns = this.patterns.filter(p => p.category !== category);
        const removed = before - this.patterns.length;
        printDebug(`[FILTER] Removed ${removed} patterns for category: ${category}`, DebugLevel.LOG);
    }

    public getPatternCount(): number {
        return this.patterns.length;
    }

    private escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}