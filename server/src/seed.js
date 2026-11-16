// Dev helper: creates a demo agent and demo players. Safe to re-run.
import { db } from './db.js';
import { hashPassword, newApiKey } from './auth.js';
import { adminAdjustAgent, deposit } from './wallet.js';

let agent = db.prepare('SELECT * FROM agents WHERE username = ?').get('demo_agent');
let apiKey = null;
if (!agent) {
  const k = newApiKey();
  apiKey = k.key;
  agent = db.prepare(`INSERT INTO agents (username, pass_hash, display_name, api_key_hash, api_key_prefix, created_at)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *`).get('demo_agent', hashPassword('agent123'), 'Demo Agent', k.hash, k.prefix, Date.now());
  adminAdjustAgent({ agentId: agent.id, amount: 1_000_000, direction: 'credit', note: 'seed', reference: 'seed-agent' });
}
for (const [u, credits] of [['player1', 50_000], ['player2', 50_000]]) {
  let p = db.prepare('SELECT * FROM players WHERE username = ?').get(u);
  if (!p) {
    p = db.prepare('INSERT INTO players (agent_id, username, pass_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(agent.id, u, hashPassword('player123'), u === 'player1' ? 'Captain Lin' : 'Neptune', Date.now());
    deposit({ agentId: agent.id, playerId: p.id, amount: credits, reference: `seed-${u}`, note: 'seed', actorKind: 'admin' });
  }
}
console.log('Seeded: agent demo_agent / agent123' + (apiKey ? `  (API key: ${apiKey})` : ''));
console.log('        players player1, player2 / player123');
