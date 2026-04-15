#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const setTimeoutPromise = promisify(setTimeout);

// =============================
// Config
// =============================
const REPO = process.env.REPO || 'monetarium/monetarium-explorer';
const MILESTONE = process.env.MILESTONE || 'v1';

const args = process.argv.slice(2);

const fileIndex = args.indexOf('--file');
const fileArg = fileIndex !== -1 ? args[fileIndex + 1] : null;
if (fileIndex !== -1 && (!fileArg || fileArg.startsWith('--'))) {
  throw new Error('--file requires a value');
}
const TASKS_FILE = fileArg || 'tasks.json';

const DRY_RUN = args.includes('--dry-run');
const RESUME = args.includes('--resume');
const AUTO_CONFIRM = args.includes('-y') || args.includes('--yes');

const STATE_FILE = '.create_issues_state.json';
const LOG_FILE = 'create_issues.log';

// =============================
// Logging
// =============================
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
let logClosed = false;
const closeLog = () => {
  if (!logClosed) {
    logClosed = true;
    logStream.end();
  }
};
process.on('exit', () => closeLog());
process.on('beforeExit', () => closeLog());
process.on('SIGINT', () => {
  closeLog();
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error(err);
  closeLog();
  process.exit(1);
});

const log = (...args) => {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(msg);
  logStream.write(msg + '\n');
};
const error = (...args) => {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.error(msg);
  logStream.write(msg + '\n');
};

// =============================
// Rate-limit aware runner
// =============================
const ghRetry = async (argsOpts, max = 5) => {
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const { stdout } = await execFileAsync('gh', argsOpts);
      return stdout.trim();
    } catch (e) {
      const out = (e.stderr || e.stdout || e.message).toString();

      if (
        /rate limit|secondary rate|abuse|502|503|timeout|ECONNRESET/i.test(out)
      ) {
        const wait = attempt * 5 + Math.random();
        error(`[Rate limit] waiting ${wait.toFixed(1)}s...`);
        await setTimeoutPromise(wait * 1000);
      } else {
        throw new Error(`gh failed:\n${out}`);
      }
    }
  }
  throw new Error('Max retries exceeded');
};

// =============================
// Load + Validate (FP)
// =============================
const loadTasks = () => {
  if (!fs.existsSync(TASKS_FILE)) {
    throw new Error(`Tasks file not found: ${TASKS_FILE}`);
  }
  return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')).tasks;
};

const validateTasks = (tasks) => {
  const errors = [];
  const ids = new Set();

  tasks.forEach((t, i) => {
    if (!t.id) errors.push(`Task[${i}] missing id`);
    if (ids.has(t.id)) errors.push(`Duplicate id: ${t.id}`);
    ids.add(t.id);

    if (!t.title) errors.push(`Task[${i}] missing title`);

    if (!['parent', 'sub-issue', 'issue'].includes(t.type)) {
      errors.push(`Invalid type: ${t.type}`);
    }

    if (t.type === 'sub-issue' && !t.parent) {
      errors.push(`Sub-issue '${t.title}' missing parent`);
    }
  });

  const idMap = Object.fromEntries(tasks.map((t) => [t.id, t]));

  tasks.forEach((t) => {
    if (t.parent && !idMap[t.parent]) {
      errors.push(`Parent not found for '${t.title}': ${t.parent}`);
    } else if (t.type === 'sub-issue') {
      const parent = idMap[t.parent];
      if (parent && parent.type !== 'parent') {
        errors.push(`Parent of '${t.title}' must be type 'parent'`);
      }
    }
  });

  if (errors.length) throw new Error(errors.join('\n'));
};

// =============================
// State (resume)
// =============================
const loadState = () => {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
};

const saveState = (state) => {
  if (DRY_RUN) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

// =============================
// GitHub Service (OOP)
// =============================
class GitHubService {
  constructor() {
    this.issueTypes = {};
  }

  async init() {
    this.issueTypes = await this.loadIssueTypes();
  }

  async loadIssueTypes() {
    const org = REPO.split('/')[0];
    try {
      const raw = await ghRetry(['api', `/orgs/${org}/issue-types`]);
      const data = JSON.parse(raw);

      const map = {};
      data.forEach((t) => (map[t.name] = t.node_id));

      log(`Loaded issue types: ${Object.keys(map).join(', ')}`);
      return map;
    } catch {
      log('(No issue types)');
      return {};
    }
  }

  async createIssue(task) {
    if (DRY_RUN) {
      const hash = [...task.id].reduce(
        (acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0,
        7,
      );
      const fake = (hash % 900000) + 100000;
      log(`[DRY] ${task.title} → #${fake}`);
      return fake;
    }

    const commandArgs = [
      'issue',
      'create',
      '--repo',
      REPO,
      '--title',
      task.title,
      '--body',
      task.description || '',
      '--milestone',
      MILESTONE,
    ];

    (task.labels || ['enhancement']).forEach((l) => {
      commandArgs.push('--label', l);
    });

    if (task.assignee) {
      commandArgs.push('--assignee', task.assignee);
    }

    const out = await ghRetry(commandArgs);
    const numMatch = out.match(/(\d+)$/);
    if (!numMatch || !numMatch[1]) {
      throw new Error(`Failed to parse issue number from output:\n${out}`);
    }
    const num = Number(numMatch[1]);

    log(`✅ ${task.title} → #${num}`);
    return num;
  }

  async getMeta(num) {
    if (DRY_RUN) return { node_id: `node_${num}`, db_id: num };
    const raw = await ghRetry(['api', `/repos/${REPO}/issues/${num}`]);
    const json = JSON.parse(raw);
    return { node_id: json.node_id, db_id: json.id };
  }

  async setIssueType(nodeId, type) {
    if (DRY_RUN) {
      process.stdout.write(`[DRY type: ${type}] `);
      return;
    }

    const typeId = this.issueTypes[type];
    if (!typeId) {
      process.stdout.write(`(unknown type: ${type}) `);
      return;
    }

    const query = `
      mutation {
        updateIssue(input: {
          id: "${nodeId}",
          issueTypeId: "${typeId}"
        }) { issue { number } }
      }
    `.replace(/\n/g, ' ');

    try {
      await ghRetry(['api', 'graphql', '-f', `query=${query}`]);
      process.stdout.write(`(type: ${type}) `);
    } catch {
      process.stdout.write('(type failed) ');
    }
  }

  async link(parentNum, childDbId, childNum) {
    if (DRY_RUN) {
      process.stdout.write('[DRY linked] ');
      return;
    }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await ghRetry([
          'api',
          '--method',
          'POST',
          `/repos/${REPO}/issues/${parentNum}/sub_issues`,
          '--field',
          `sub_issue_id=${childDbId}`,
        ]);
        process.stdout.write('(linked) ');
        success = true;
        break;
      } catch {
        await setTimeoutPromise(1000);
      }
    }

    if (!success) {
      process.stdout.write('(native link failed, trying comment...) ');
      if (childNum) {
        try {
          await ghRetry([
            'issue',
            'comment',
            parentNum.toString(),
            '--repo',
            REPO,
            '--body',
            `Linked child task: #${childNum}`,
          ]);
          process.stdout.write('(fallback comment posted) ');
        } catch {
          process.stdout.write('(fallback comment failed) ');
          throw new Error('Both native linking and fallback commenting failed');
        }
      } else {
        throw new Error('Sub-issue link failed after 3 attempts');
      }
    }
  }
}

// =============================
// Execution
// =============================
const confirm = () => {
  return new Promise((resolve) => {
    if (DRY_RUN || AUTO_CONFIRM) {
      return resolve();
    }

    log(`⚠️ Creating issues in ${REPO}`);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Type 'yes' to continue: ", (input) => {
      rl.close();
      if (input.trim() !== 'yes') process.exit(1);
      resolve();
    });
  });
};

// =============================
// Main
// =============================
(async () => {
  let errors = 0;
  let parentsCreated = 0,
    parentsSkipped = 0;
  let childrenCreated = 0,
    childrenSkipped = 0;
  let standaloneCreated = 0,
    standaloneSkipped = 0;

  try {
    if (DRY_RUN) {
      log('🧪 DRY RUN MODE — No changes will be made to GitHub\n');
    }

    log(`--- Loading ${TASKS_FILE} ---`);
    const tasks = loadTasks();
    validateTasks(tasks);

    log('✅ Validation passed');

    await confirm();

    const github = new GitHubService();
    await github.init();

    const state = RESUME ? loadState() : {};
    const issueMap = new Map();

    // Map existing state to ID for proper resume linking (fallback to title for old states)
    let stateMigrated = false;
    for (const t of tasks) {
      if (state[t.id]) {
        issueMap.set(t.id, state[t.id]);
      } else if (state[t.title]) {
        error(`\n⚠️ Possible ID change detected for legacy state "${t.title}"`);
        const num = state[t.title];
        issueMap.set(t.id, num);
        if (!state[t.id]) {
          state[t.id] = num;
        }
        delete state[t.title];
        stateMigrated = true;
      }
    }
    if (stateMigrated) saveState(state);

    // Parents
    for (const t of tasks.filter((t) => t.type === 'parent')) {
      if (issueMap.has(t.id)) {
        log(`⏭️ Skip ${t.title}`);
        parentsSkipped++;
        continue;
      }

      try {
        const num = await github.createIssue(t);
        if (!num) continue;

        issueMap.set(t.id, num);
        state[t.id] = num;
        saveState(state);

        const meta = await github.getMeta(num);
        await github.setIssueType(meta.node_id, t.issue_type || 'Feature');
        parentsCreated++;
      } catch (e) {
        error(`\n❌ Failed to process parent '${t.title}': ${e.message}`);
        errors++;
      }
    }

    // Children and Standalone
    for (const t of tasks.filter((t) => t.type !== 'parent')) {
      if (issueMap.has(t.id)) {
        log(`⏭️ Skip ${t.title}`);
        if (t.type === 'sub-issue') childrenSkipped++;
        else standaloneSkipped++;
        continue;
      }

      try {
        let body = t.description || '';
        const parentNum = issueMap.get(t.parent);

        if (t.type === 'sub-issue' && !parentNum) {
          error(`\n❌ Parent not resolved for '${t.title}'`);
          errors++;
          continue;
        }

        if (t.type === 'sub-issue') {
          body += `\n\nPart of #${parentNum}`;
        }

        const num = await github.createIssue({ ...t, description: body });
        if (!num) continue;

        issueMap.set(t.id, num);
        state[t.id] = num;
        saveState(state);

        const meta = await github.getMeta(num);
        await github.setIssueType(meta.node_id, t.issue_type || 'Task');

        if (t.type === 'sub-issue') {
          await github.link(parentNum, meta.db_id, num);
          childrenCreated++;
        } else {
          standaloneCreated++;
        }
      } catch (e) {
        error(`\n❌ Failed to process '${t.title}': ${e.message}`);
        errors++;
      }
    }

    log(`
════════════════════════════════════════════════
${DRY_RUN ? '  🧪 DRY RUN MODE — No changes will be made to GitHub\n' : ''}  ✅ Done! Summary for [${REPO}] @ milestone [${MILESTONE}]
────────────────────────────────────────────────
  Parent issues created : ${parentsCreated}  (skipped: ${parentsSkipped})
  Sub-issues created    : ${childrenCreated}  (skipped: ${childrenSkipped})
  Standalone issues     : ${standaloneCreated}  (skipped: ${standaloneSkipped})
════════════════════════════════════════════════
`);

    if (errors === 0 && !DRY_RUN && fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      log('  State file cleaned up.');
    } else if (errors > 0) {
      log(
        `\n⚠️ Finished with ${errors} error(s). State file preserved so you can safely retry with --resume argument.`,
      );
    }
  } catch (e) {
    error('\n❌ Fatal Error:');
    error(e.message);
    process.exit(1);
  }
})();
