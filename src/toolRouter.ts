import { OpenAIToolDefinition } from './types';

export interface ToolRouterContext {
  model: string;
  messages: any[];
}

export class ToolRouter {

  static select(
    tools: OpenAIToolDefinition[],
    context: ToolRouterContext
  ): OpenAIToolDefinition[] {

    const prompt = this.getLastUserMessage(context.messages).toLowerCase();
    const model = context.model.toLowerCase();

    const isSmallModel =
      model.includes('1b') ||
      model.includes('2b') ||
      model.includes('3b') ||
      model.includes('tiny');

    const allowed = new Set<string>();

    // ---------------- FILE OPS ----------------
    if (prompt.includes('file') || prompt.includes('edit') || prompt.includes('modify')) {
      allowed.add('read_file');
      allowed.add('write_file');
      allowed.add('apply_patch');
    }

    // ---------------- DEBUG ----------------
    if (prompt.includes('error') || prompt.includes('bug') || prompt.includes('fix')) {
      allowed.add('read_file');
      allowed.add('search_code');
    }

    // ---------------- TERMINAL ----------------
    if (prompt.includes('run') || prompt.includes('execute') || prompt.includes('install')) {
      allowed.add('run_terminal');
    }

    // ---------------- SEARCH ----------------
    if (prompt.includes('search') || prompt.includes('find') || prompt.includes('lookup')) {
      allowed.add('web_search');
      allowed.add('search_code');
    }

    if (allowed.size === 0) return [];

    const maxTools = isSmallModel ? 3 : 6;

    return tools
      .filter(tool => {
        const name = tool.function?.name;   // ✅ FIX HERE
        return name ? allowed.has(name) : false;
      })
      .slice(0, maxTools);
  }

  static getLastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        return messages[i]?.content ?? '';
      }
    }
    return '';
  }
}