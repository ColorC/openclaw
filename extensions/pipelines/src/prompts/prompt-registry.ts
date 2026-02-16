/**
 * Prompt 模板注册表
 *
 * 从 .md 文件加载 prompt 模板，支持 {{variable}} 插值。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatMessage } from "../llm/types.js";

// ============================================================================
// PromptRegistry
// ============================================================================

export class PromptRegistry {
  private cache = new Map<string, string>();
  private templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir =
      templatesDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");
  }

  /** Load a raw template by path (e.g., 'decomposition/decompose') */
  getTemplate(templatePath: string): string {
    const cached = this.cache.get(templatePath);
    if (cached) return cached;

    const filePath = path.join(this.templatesDir, `${templatePath}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt template not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    this.cache.set(templatePath, content);
    return content;
  }

  /** Load + interpolate {{variable}} placeholders */
  render(templatePath: string, variables: Record<string, string> = {}): string {
    let template = this.getTemplate(templatePath);
    for (const [key, value] of Object.entries(variables)) {
      template = template.replaceAll(`{{${key}}}`, value);
    }
    return template;
  }

  /**
   * Build ChatMessage[] from a template:
   * - Template content → system message
   * - userContent → user message
   */
  buildMessages(
    templatePath: string,
    variables: Record<string, string>,
    userContent: string,
  ): ChatMessage[] {
    const systemPrompt = this.render(templatePath, variables);
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];
  }

  /** Clear the template cache */
  clearCache(): void {
    this.cache.clear();
  }
}
