import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { AppConfig } from '../config/loader.js';
import { getMessages, getParticipantCount, getTopParticipants } from '../db/queries.js';

interface SummaryGroupInput {
  groupId: string;
  groupName: string;
  date: string;
  messageCount: number;
  participantCount: number;
  topParticipants: Array<{ name: string; count: number }>;
  llmPrompt: string;
  model: string;
}

interface SummaryInputResponse {
  generatedAt: string;
  groups: SummaryGroupInput[];
}

export function buildSummaryInput(
  db: Database.Database,
  config: AppConfig,
  sinceParam?: string,
  untilParam?: string
): SummaryInputResponse {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const since = sinceParam ? new Date(sinceParam).getTime() : todayStart.getTime();
  const until = untilParam ? new Date(untilParam).getTime() : now.getTime();
  const dateStr = todayStart.toISOString().split('T')[0];

  const enabledGroups = config.groups.filter((g) => g.enabled);
  const promptTemplate = loadPromptTemplate(config.summary.promptTemplatePath);

  const groups: SummaryGroupInput[] = [];

  for (const group of enabledGroups) {
    const messages = getMessages(db, group.id, since, until);

    if (messages.length === 0) continue;

    const participantCount = getParticipantCount(db, group.id, since, until);
    const topParticipants = getTopParticipants(db, group.id, since, until, 5);

    const formattedMessages = messages
      .map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata',
        });
        const sender = m.sender_name || m.sender_id;
        return `[${time}] ${sender}: ${m.text}`;
      })
      .join('\n');

    const llmPrompt = promptTemplate
      .replace('{{groupName}}', group.name)
      .replace('{{date}}', dateStr)
      .replace('{{messageCount}}', String(messages.length))
      .replace('{{participantCount}}', String(participantCount))
      .replace('{{messages}}', formattedMessages);

    groups.push({
      groupId: group.id,
      groupName: group.name,
      date: dateStr,
      messageCount: messages.length,
      participantCount,
      topParticipants,
      llmPrompt,
      model: config.summary.defaultModel,
    });
  }

  return {
    generatedAt: now.toISOString(),
    groups,
  };
}

function loadPromptTemplate(templatePath: string): string {
  const resolved = path.resolve(templatePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Prompt template not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf-8');
}
