import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export interface GroupConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AppConfig {
  whatsapp: {
    sessionDataPath: string;
  };
  groups: GroupConfig[];
  summary: {
    defaultModel: string;
    fallbackModel: string;
    tokenStrategy: 'single-pass' | 'hierarchical';
    chunkSize: number;
    promptTemplatePath: string;
  };
  server: {
    port: number;
    logLevel: string;
    logFile: string;
    dataDir: string;
  };
}

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config.yaml');

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath || process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = YAML.parse(raw);

  return {
    whatsapp: {
      sessionDataPath: parsed.whatsapp?.session_data_path || './session',
    },
    groups: (parsed.groups || []).map((g: any) => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled !== false,
    })),
    summary: {
      defaultModel: parsed.summary?.default_model || 'google/gemini-flash-1.5',
      fallbackModel: parsed.summary?.fallback_model || 'openai/gpt-4o-mini',
      tokenStrategy: parsed.summary?.token_strategy || 'single-pass',
      chunkSize: parsed.summary?.chunk_size || 100,
      promptTemplatePath: parsed.summary?.prompt_template_path || './prompts/summary.txt',
    },
    server: {
      port: parsed.server?.port || 3000,
      logLevel: parsed.server?.log_level || 'info',
      logFile: parsed.server?.log_file || './logs/app.log',
      dataDir: parsed.server?.data_dir || './data',
    },
  };
}
