# WhatsApp Group Message Daily Recap

## Overview

An automated system that generates daily LLM-powered summaries of WhatsApp group messages and posts them back into the group(s). Built for high-volume college groups (500+ messages/day). Uses a persistent Node.js service for WhatsApp connectivity, n8n for orchestration/scheduling, and OpenRouter for LLM summarization. Includes a human-in-the-loop approval step before posting.

---

## Requirements

### Functional Requirements

1. **Message Collection** — Continuously receive and store WhatsApp messages from configured group(s) in a local database.
2. **Daily Summarization** — At a configurable time, generate a structured summary of all messages since the last summary using an LLM.
3. **Approval Flow** — Before posting, send the generated summary for human review via email. Support approve/reject actions.
4. **Rejection & Regeneration** — On rejection, accept feedback from the reviewer and regenerate the summary with the feedback incorporated into the prompt.
5. **Post Summary** — On approval, post the summary back into the WhatsApp group.
6. **Multiple Groups** — Support configurable list of groups, each summarized independently.
7. **Manual Trigger** — Allow manually triggering a summary outside the scheduled time (via n8n).
8. **Configurable Schedule** — Summary generation time should be configurable (e.g., midnight, 8 AM, 11 PM).
9. **Text Messages Only** — Process text messages only (no images, voice notes, documents, polls) for v1.

### Non-Functional Requirements

1. **Lightweight** — The persistent WhatsApp service should use minimal resources (~50MB RAM, no browser).
2. **Resilient** — Auto-reconnect on WhatsApp disconnections. Retry failed LLM calls.
3. **Observable** — Health check endpoint, error logging to file, n8n error notifications.
4. **Deployable on Proxmox** — Runs as a Docker container inside a Proxmox VM or LXC.
5. **Cheap** — Use free/cheap LLM models via OpenRouter. Optimize token usage for high-volume groups.

---

## Design Decisions

### Architecture

Two-component system: a persistent Node.js service + n8n workflows.

```
┌──────────────────────────────────────────┐
│  Proxmox LXC / Docker Container         │
│                                          │
│  Node.js Service (Baileys)               │
│  • Persistent WhatsApp WebSocket conn    │
│  • Stores messages in SQLite             │
│  • Aggregates, formats, builds LLM       │
│    prompts (GET /api/summary-input)      │
│  • HTTP API for sending messages         │
│  • Auto-reconnects on disconnect         │
│  • QR code auth via terminal logs        │
└──────────────────────────────────────────┘
          ▲              │
          │ HTTP         │ HTTP
          │              ▼
┌──────────────────────────────────────────┐
│  n8n Workflow (ultra-lean)               │
│  • Cron trigger (configurable time)      │
│  • Fetches ready-made prompts from       │
│    Node.js service (single call)         │
│  • Forwards prompts to OpenRouter        │
│  • Sends approval email with summary     │
│  • On approve: posts to WhatsApp group   │
│  • On reject: regenerates with feedback  │
└──────────────────────────────────────────┘
```

**Why this split?**
- Node.js service stays small and focused — just WhatsApp connectivity + storage.
- n8n handles all orchestration logic (scheduling, LLM calls, approval flow, error notifications) — easy to tweak prompts, timing, and flow via n8n's visual UI without code changes.
- Separation of concerns: WhatsApp layer knows nothing about LLMs or summaries.

### WhatsApp Library: Baileys

- **Chosen over wwebjs.dev** — Baileys uses a direct WebSocket connection to WhatsApp servers, no headless browser (Puppeteer/Chrome) needed. Much lighter on resources.
- **Chosen over whatsapp-mcp** — Avoids Go dependency, two-language complexity (Go + Python), and MCP overhead. Single Node.js process is simpler.
- **Trade-off**: Both Baileys and wwebjs.dev are unofficial libraries and can break if WhatsApp changes their protocol. Baileys is more actively maintained currently.
- **Note**: A persistent connection is required because WhatsApp doesn't offer a "fetch historical messages" API. Messages are delivered in real-time via WebSocket and must be stored locally as they arrive.

### LLM Provider: OpenRouter

- OpenAI-compatible API from [OpenRouter](https://openrouter.ai/).
- Allows experimenting with different models (GPT-4o-mini, Gemini Flash, Llama, Mistral, etc.) without changing code — just swap the model ID.
- Preference for cheap/free models that work reasonably well.
- Model selection is configurable per group if needed.

### Token Strategy

- With 500+ messages/day, raw message content can be 35-50K tokens (including sender names, timestamps).
- Support both approaches, configurable:
  - **Single-pass**: Send all messages to a large-context model (e.g., Gemini Flash — cheap, 1M context window).
  - **Hierarchical summarization**: Chunk messages by time window → summarize each chunk → merge chunk summaries into final summary. Works with smaller-context models and is cheaper.
- Start with single-pass (simpler), switch to hierarchical if cost/quality is an issue.

### Message Storage: SQLite

- Lightweight, file-based, no separate database server needed.
- Stores all incoming messages with: sender, timestamp, group ID, message text, message ID.
- Data directory is persisted outside the app (Docker volume or a dedicated path on the LXC) so data survives restarts.
- Indexed by group ID + timestamp for efficient range queries.

### QR Code Authentication

- QR code displayed in terminal / Docker logs on first run.
- User scans with WhatsApp mobile app to authenticate.
- Session persists across restarts (stored in Docker volume).
- Re-authentication may be needed every ~20 days (WhatsApp policy).

### Summary Format

```
📊 *Daily Recap — [Group Name]* (May 29, 2026)

📌 *Key Discussions:*
• Exam schedule for CS301 confirmed for June 5
  — @Rahul, @Priya, @Amit
• Debate about mess food quality and alternatives
  — @Sanjay, @Neha, @Vikram, @Pooja

⚠️ *Announcements:*
• Prof. Sharma cancelled tomorrow's lecture
  — @Rahul
• Hostel maintenance scheduled for Saturday
  — @Admin, @Priya

✅ *Action Items:*
• Submit ML assignment by Friday on Moodle
  — @Amit, @Rahul
• Register for hackathon before June 1
  — @Neha, @Sanjay

🔗 *Links Shared:*
• https://example.com/cs301-notes — CS301 study material
  — @Priya
• https://forms.google.com/hackathon — Hackathon registration
  — @Neha

💬 523 messages from 45 participants
Most active: @Rahul (68), @Priya (52), @Amit (41)
```

**Key points:**
- Each item lists the 3-4 main contributors to that discussion/announcement.
- WhatsApp formatting (*bold*, _italic_) used for readability.
- Stats at the bottom (message count, participant count, most active).

### Approval Flow

1. n8n generates the summary via OpenRouter.
2. n8n sends an **approval email** containing the full summary text + approve/reject links.
3. **Approve**: n8n posts the summary to the WhatsApp group via the Node.js service.
4. **Reject**: User provides text feedback (what to change). n8n re-runs the LLM with the original messages + feedback appended to the prompt. New summary goes through approval again.
5. Implemented using n8n's native **Wait** node + webhook pattern.

### Group JID Discovery

You don't need to know group JIDs upfront. After first WhatsApp connection:

1. The service auto-discovers all groups you're a member of and stores them in the `groups` table.
2. Call `GET /api/groups` to see all groups with their JIDs and names.
3. Copy the desired JID(s) into `config.yaml` under the `groups` section.
4. Only groups listed in config with `enabled: true` will be summarized.

### Configuration: YAML Config File

All configuration in a single YAML file (`config.yaml`), mounted into the container or placed alongside the app.

```yaml
whatsapp:
  session_data_path: "./session"   # path for session persistence

# Get group JIDs by calling GET /api/groups after first connection
groups:
  - id: "120363XXXXX@g.us"         # WhatsApp group JID (from /api/groups)
    name: "BITS CS 2024"
    enabled: true
  - id: "120363YYYYY@g.us"
    name: "BITS General"
    enabled: true

summary:
  default_model: "google/gemini-flash-1.5"  # OpenRouter model ID
  fallback_model: "openai/gpt-4o-mini"
  token_strategy: "single-pass"             # "single-pass" or "hierarchical"
  chunk_size: 100                           # messages per chunk (for hierarchical)
  prompt_template_path: "./prompts/summary.txt"

server:
  port: 3000
  log_level: "info"
  log_file: "./logs/app.log"
```

n8n-specific config (schedule time, approval email, OpenRouter API key) lives in n8n workflow variables/credentials.

---

## Implementation Details

### Tech Stack

| Component        | Technology                     |
| ---------------- | ------------------------------ |
| WhatsApp client  | Baileys (Node.js)              |
| Message storage  | SQLite (via better-sqlite3)    |
| HTTP API         | Express.js                     |
| Orchestration    | n8n (existing instance)        |
| LLM API          | OpenRouter (OpenAI-compatible) |
| Deployment       | Docker (on Proxmox VM/LXC)     |
| Language         | Node.js / TypeScript           |
| Config format    | YAML                           |

### Node.js Service — HTTP API

#### `GET /api/groups`
List all groups the WhatsApp account is a member of. Used during initial setup to discover group JIDs.

**Response:**
```json
[
  {
    "id": "120363XXXXX@g.us",
    "name": "BITS CS 2024",
    "participantCount": 87,
    "messageCount": 4521,
    "enabled": true
  },
  {
    "id": "120363YYYYY@g.us",
    "name": "BITS General",
    "participantCount": 245,
    "messageCount": 12030,
    "enabled": false
  }
]
```

#### `GET /api/messages`
Fetch stored messages for a group within a time range. Low-level endpoint for debugging or custom queries.

**Query params:**
- `groupId` (required) — WhatsApp group JID
- `since` (required) — ISO 8601 timestamp (e.g., `2026-05-29T00:00:00Z`)
- `until` (optional) — ISO 8601 timestamp, defaults to now

**Response:**
```json
{
  "groupId": "120363XXXXX@g.us",
  "groupName": "BITS CS 2024",
  "messageCount": 523,
  "participants": 45,
  "messages": [
    {
      "id": "msg_abc123",
      "sender": "919876543210@s.whatsapp.net",
      "senderName": "Rahul",
      "timestamp": "2026-05-29T08:15:30Z",
      "text": "Has anyone seen the exam schedule?"
    }
  ]
}
```

#### `GET /api/summary-input`
**Primary endpoint for n8n.** Returns today's messages from all enabled groups, already aggregated, formatted, and assembled into complete LLM prompts — ready to forward directly to OpenRouter.

**Query params:**
- `since` (optional) — ISO 8601 timestamp, defaults to start of today (midnight)
- `until` (optional) — ISO 8601 timestamp, defaults to now

**Response:**
```json
{
  "generatedAt": "2026-05-30T23:00:00Z",
  "groups": [
    {
      "groupId": "120363XXXXX@g.us",
      "groupName": "BITS CS 2024",
      "date": "2026-05-30",
      "messageCount": 523,
      "participantCount": 45,
      "topParticipants": [
        { "name": "Rahul", "count": 68 },
        { "name": "Priya", "count": 52 },
        { "name": "Amit", "count": 41 }
      ],
      "llmPrompt": "You are a WhatsApp group chat summarizer...\n\nMESSAGES:\n[08:15] Rahul: Has anyone seen the exam schedule?\n[08:16] Priya: Yes, it's on June 5...",
      "model": "google/gemini-flash-1.5"
    }
  ]
}
```

**What the Node.js service does internally for this endpoint:**
1. Queries SQLite for messages from all enabled groups within the time range.
2. Groups messages by group.
3. Computes per-group stats (message count, participant count, top participants).
4. Formats messages into a clean chronological text (`[HH:MM] SenderName: message`).
5. Loads the prompt template from `prompts/summary.txt` and injects the formatted messages + metadata.
6. Returns the complete prompt per group, ready for n8n to forward to OpenRouter with zero processing.

#### `POST /api/send`
Send a text message to a WhatsApp group.

**Body:**
```json
{
  "groupId": "120363XXXXX@g.us",
  "message": "📊 *Daily Recap — BITS CS 2024* ..."
}
```

#### `GET /api/health`
Health check endpoint. Returns connection status, uptime, last message received timestamp.

```json
{
  "status": "connected",
  "uptime": "2d 5h 30m",
  "lastMessageAt": "2026-05-30T14:22:10Z",
  "groups": 2,
  "totalMessages": 12847
}
```

### SQLite Schema

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,              -- WhatsApp message ID
  group_id TEXT NOT NULL,           -- group JID
  sender_id TEXT NOT NULL,          -- sender JID
  sender_name TEXT,                 -- push name / contact name
  timestamp INTEGER NOT NULL,       -- Unix timestamp (ms)
  text TEXT,                        -- message body
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_messages_group_time ON messages(group_id, timestamp);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,              -- group JID
  name TEXT,                        -- group name
  last_message_at INTEGER           -- last message timestamp
);

CREATE TABLE summary_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  summary_text TEXT,
  messages_from INTEGER,            -- start timestamp
  messages_to INTEGER,              -- end timestamp
  message_count INTEGER,
  model_used TEXT,
  status TEXT,                      -- 'approved', 'rejected', 'pending'
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### Node.js Service — Core Modules

```
src/
├── index.ts                # Entry point — start Baileys + Express
├── whatsapp/
│   ├── client.ts           # Baileys connection, auth, reconnect logic
│   └── message-handler.ts  # Process incoming messages, store in SQLite
├── db/
│   ├── sqlite.ts           # Database initialization, migrations
│   └── queries.ts          # Message CRUD, group queries
├── api/
│   ├── routes.ts           # Express routes (/messages, /send, /health, /groups, /summary-input)
│   └── middleware.ts       # Request logging, error handling
├── summary/
│   ├── aggregator.ts       # Fetch + group messages, compute stats, top participants
│   └── prompt-builder.ts   # Load prompt template, inject formatted messages + metadata
├── config/
│   └── loader.ts           # YAML config loader + validation
└── utils/
    └── logger.ts           # Structured logging (file + stdout)
```

### n8n Workflow

**Workflow: "WhatsApp Daily Summary"**

n8n is intentionally kept ultra-lean — all message aggregation, formatting, and prompt building happens in the Node.js service. n8n just orchestrates the flow.

- **n8n version**: 2.21.7
- **Importable workflow**: `n8n/whatsapp-daily-summary.json` (gitignored — contains environment-specific config)

```
┌─────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────┐
│  Cron   │───▶│ HTTP Request  │───▶│ Loop over    │───▶│ HTTP Request │
│ Trigger │    │ GET /api/     │    │ each group   │    │ OpenRouter   │
└─────────┘    │ summary-input │    │              │    │ (forward     │
               └───────────────┘    └──────────────┘    │  llmPrompt)  │
                                                        └──────┬───────┘
                                                               │
                                    ┌──────────────┐    ┌──────▼───────┐
                                    │ HTTP Request  │◀──│  Wait Node   │
                                    │ POST /send    │   │ (Approval    │
                                    │ (to group)    │   │  via email)  │
                                    └──────────────┘    └──────────────┘
                                           │                   │
                                     [Approved]           [Rejected]
                                                               │
                                                        ┌──────▼───────┐
                                                        │ Regenerate   │
                                                        │ with feedback│
                                                        │ → loop back  │
                                                        └──────────────┘
```

**Environment:**
- **n8n base URL**: `<your-n8n-base-url>`
- **WhatsApp service URL**: `<whatsapp-service-ip>:3000`
- **Schedule**: Daily at midnight (00:00) IST (`Asia/Kolkata`)
- **Approval email**: `<your-email>`

**Nodes:**
1. **Schedule Trigger** — Fires daily at 00:00 IST. Workflow can also be triggered manually via n8n UI.
2. **HTTP Request (Fetch Summary Input)** — `GET <whatsapp-service-url>/api/summary-input` — fetches pre-built LLM prompts for all enabled groups. Node.js handles all message aggregation, formatting, and prompt assembly.
3. **Split In Batches** — Iterates over each group in `{{ $json.groups }}`.
4. **HTTP Request (OpenRouter)** — `POST https://openrouter.ai/api/v1/chat/completions` — Forwards the `llmPrompt` as the user message content. Uses the `model` field from the response. Request body:
   ```json
   {
     "model": "{{ $json.model }}",
     "messages": [
       { "role": "user", "content": "{{ $json.llmPrompt }}" }
     ]
   }
   ```
   Auth: Bearer token from n8n OpenRouter credential. Response contains the summary in `choices[0].message.content`.
5. **Send Email (Approval)** — Sends email to the configured approval address with the generated summary in the body, plus two links:
   - ✅ Approve: `<n8n-base-url>/webhook/<execution-id>/approve`
   - ❌ Reject (opens a form to provide feedback)
6. **Wait Node** — Pauses execution until the approve/reject webhook is hit.
7. **IF Node (Check Decision)** — Routes to approve or reject branch.
8. **On Approve → HTTP Request (Send)** — `POST <whatsapp-service-url>/api/send` with `{ "groupId": "...", "message": "<summary>" }`.
9. **On Reject → Code Node (Append Feedback)** — Appends the reviewer's feedback to the original `llmPrompt`: `"Previous summary was rejected. Feedback: <feedback>. Please regenerate."` Then loops back to step 4.

**n8n Credentials to configure:**
- **Header Auth (OpenRouter)** — Name: `OpenRouter`, Header Name: `Authorization`, Header Value: `Bearer <your-openrouter-api-key>`
- **SMTP** — For sending approval emails (configure in n8n Settings > Credentials)

**Setup instructions:**
1. Import `n8n/whatsapp-daily-summary.json` via n8n UI (Workflows > Import).
2. Create the OpenRouter Header Auth credential in n8n.
3. Configure SMTP credentials for email.
4. Update the WhatsApp service URL and approval email in the workflow nodes.
5. Activate the workflow.

### Deployment

Target environment: **Proxmox** (bare-metal hypervisor). Runs as a Docker container inside a Proxmox LXC.

**CI/CD Pipeline:**
- On git tag push (`v*`), GitHub Actions builds the Docker image and pushes to GitHub Container Registry (`ghcr.io`).
- On the Proxmox LXC, `docker pull` + `docker compose up -d` to deploy/update.

**Deployment steps:**

#### 1. Create a Proxmox LXC

In the Proxmox web UI:
- Create a new LXC container (Debian 12 / Ubuntu 22.04 template)
- 1 CPU, 512MB RAM, 8GB disk is sufficient
- Enable nesting (required for Docker): Options → Features → check `nesting`
- Note the IP address assigned

#### 2. Install Docker in the LXC

```bash
ssh root@<lxc-ip>
apt update && apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

#### 3. Set up the app directory

```bash
mkdir -p /opt/whatsapp-recap && cd /opt/whatsapp-recap

# Download docker-compose.yml and config
curl -O https://raw.githubusercontent.com/adityaprasoon/bits-whatsapp-ai-recap/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/adityaprasoon/bits-whatsapp-ai-recap/main/config.example.yaml
mkdir -p prompts
curl -o prompts/summary.txt https://raw.githubusercontent.com/adityaprasoon/bits-whatsapp-ai-recap/main/prompts/summary.txt
cp config.example.yaml config.yaml
# Edit config.yaml with your group JIDs (after first run)
```

#### 4. First run — scan QR code

```bash
docker compose up     # foreground, so you can see the QR code
# Scan the QR code with WhatsApp mobile app
# Once connected, Ctrl+C and restart in background
docker compose up -d
```

#### 5. Configure groups

```bash
# Discover your group JIDs
curl http://localhost:3000/api/groups

# Edit config.yaml, add groups
nano config.yaml

# Restart to pick up config changes
docker compose restart
```

#### 6. Updates

```bash
cd /opt/whatsapp-recap
docker compose pull
docker compose up -d
```

### Error Handling

| Scenario                    | Handling                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| WhatsApp disconnects        | Auto-reconnect with exponential backoff (Baileys built-in)            |
| QR code expires             | Log warning, health endpoint reports "auth_required"                  |
| LLM API call fails          | n8n retries up to 3 times with backoff                                |
| LLM returns bad summary     | Approval step catches it — reviewer rejects and provides feedback     |
| Node.js service crashes     | Docker `restart: unless-stopped` brings it back                       |
| SQLite corruption           | WAL mode for crash safety; periodic backups via Docker volume         |
| n8n workflow fails          | n8n error notifications via email/webhook                             |

### Security Considerations

- WhatsApp session data stored in a persistent volume / local directory — not committed to git.
- OpenRouter API key stored in n8n credentials — not in config file.
- Node.js HTTP API is local-only (not exposed to internet) — n8n and the service run on the same Proxmox network.
- No authentication on the HTTP API (since it's internal). If exposed, add API key auth.
- Config file (`config.yaml`) should be in `.gitignore`.

### LLM Prompt Template

Stored in `prompts/summary.txt`, referenced from config:

```
You are a WhatsApp group chat summarizer. Generate a structured daily recap of the following group chat messages.

Group: {{groupName}}
Date: {{date}}
Messages: {{messageCount}} from {{participantCount}} participants

FORMAT REQUIREMENTS:
- Use WhatsApp-compatible formatting (*bold* for headings)
- For each discussion topic, announcement, or action item, list the 3-4 main contributors
- Include a links section if any URLs were shared
- End with message/participant stats and top 3 most active members
- Keep the summary concise but comprehensive
- Use these exact section headers with emojis:
  📊 (title), 📌 (Key Discussions), ⚠️ (Announcements), ✅ (Action Items), 🔗 (Links Shared), 💬 (Stats)

MESSAGES:
{{messages}}
```

---

## Future Enhancements (v2+)

- Image caption inclusion in summaries
- Voice note transcription (Whisper API)
- Poll result summaries
- Weekly/monthly summary aggregation
- Web dashboard for viewing past summaries
- Sentiment analysis / mood tracking
- Topic-based filtering (e.g., "only academic discussions")
- Multi-language support
