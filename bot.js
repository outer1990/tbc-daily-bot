const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID    = process.env.CHANNEL_ID;
const RESET_HOUR    = parseInt(process.env.RESET_HOUR   ?? '15');
const RESET_MINUTE  = parseInt(process.env.RESET_MINUTE ?? '0');

const DUNGEONS = [
  { emoji: '1️⃣', name: 'The Mechanar' },
  { emoji: '2️⃣', name: 'The Botanica' },
  { emoji: '3️⃣', name: 'The Arcatraz' },
  { emoji: '4️⃣', name: 'Blood Furnace' },
  { emoji: '5️⃣', name: 'The Shattered Halls' },
  { emoji: '6️⃣', name: 'The Slave Pens' },
  { emoji: '7️⃣', name: 'The Underbog' },
  { emoji: '8️⃣', name: 'The Steamvault' },
  { emoji: '9️⃣', name: 'Hellfire Ramparts' },
  { emoji: '🔟', name: 'Mana-Tombs' },
  { emoji: '🇦', name: 'Auchenai Crypts' },
  { emoji: '🇧', name: 'Sethekk Halls' },
  { emoji: '🇨', name: 'Shadow Labyrinth' },
  { emoji: '🇩', name: 'Old Hillsbrad Foothills' },
  { emoji: '🇪', name: 'The Black Morass' },
  { emoji: '🇫', name: "Magisters' Terrace" },
];

let currentPollMessageId  = null;
let leaderMessageId       = null;

// ── Update the live leader board message ──────────────────────────────────────
async function updateLeader(channel) {
  if (!currentPollMessageId) return;

  let pollMsg;
  try {
    pollMsg = await channel.messages.fetch(currentPollMessageId);
  } catch { return; }

  const votes = [];
  for (const d of DUNGEONS) {
    const reaction = pollMsg.reactions.cache.get(d.emoji);
    const count = reaction ? reaction.count - 1 : 0;
    votes.push({ ...d, count });
  }
  votes.sort((a, b) => b.count - a.count);

  const top = votes[0];
  const hasVotes = top.count > 0;

  const embed = new EmbedBuilder()
    .setColor(hasVotes ? 0x5865F2 : 0x99AAB5)
    .setTitle('🏆 Current Leader')
    .setDescription(
      hasVotes
        ? `## ${top.emoji}  ${top.name}\n**${top.count} vote${top.count !== 1 ? 's' : ''}** so far\n\n*React to the poll above to cast your vote!*`
        : '*No votes yet — be the first to react to the poll above!*'
    )
    .setFooter({ text: 'Updates as votes come in • Resets at daily reset' })
    .setTimestamp();

  try {
    if (leaderMessageId) {
      const leaderMsg = await channel.messages.fetch(leaderMessageId);
      await leaderMsg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      leaderMessageId = msg.id;
    }
  } catch {
    // If old leader message is gone, post a new one
    const msg = await channel.send({ embeds: [embed] });
    leaderMessageId = msg.id;
  }
}

// ── Post the daily poll ───────────────────────────────────────────────────────
async function postDailyPoll(channel) {
  if (!channel) {
    channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('Channel not found.'); return; }
  }

  // Post yesterday's results summary then delete old poll + leader
  if (currentPollMessageId) {
    try {
      const old = await channel.messages.fetch(currentPollMessageId);
      const results = buildResultsEmbed(await getVotes(old));
      await channel.send({ embeds: [results] });
      await old.delete();
    } catch { /* already gone */ }
  }
  if (leaderMessageId) {
    try {
      const old = await channel.messages.fetch(leaderMessageId);
      await old.delete();
    } catch { /* already gone */ }
    leaderMessageId = null;
  }

  // Post fresh poll
  const pollEmbed = new EmbedBuilder()
    .setColor(0xF5A623)
    .setTitle('📅 What is today\'s Daily Heroic Dungeon?')
    .setDescription(
      DUNGEONS.map(d => `${d.emoji}  ${d.name}`).join('\n') +
      '\n\n*React with the dungeon you see from the quest NPC!\nOne vote per person — majority wins.*'
    )
    .setFooter({ text: 'Poll resets daily at server reset • Trolls will be outvoted 😄' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [pollEmbed] });
  for (const d of DUNGEONS) await msg.react(d.emoji);
  currentPollMessageId = msg.id;

  // Post the initial leader message below the poll
  await updateLeader(channel);

  console.log(`[${new Date().toISOString()}] Daily poll posted.`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getVotes(message) {
  const votes = [];
  for (const d of DUNGEONS) {
    const reaction = message.reactions.cache.get(d.emoji);
    const count = reaction ? reaction.count - 1 : 0;
    if (count > 0) votes.push({ ...d, count });
  }
  return votes.sort((a, b) => b.count - a.count);
}

function buildResultsEmbed(votes) {
  const winner = votes[0];
  const lines = votes.map((v, i) =>
    `${i === 0 ? '🏆' : `${i + 1}.`} ${v.emoji} **${v.name}** — ${v.count} vote${v.count !== 1 ? 's' : ''}`
  );
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ Yesterday\'s Daily Heroic Results')
    .setDescription(
      votes.length
        ? `**Winner: ${winner.name}**\n\n` + lines.join('\n')
        : '*No votes were recorded.*'
    )
    .setTimestamp();
}

// ── React events → update leader ─────────────────────────────────────────────
async function handleReactionChange(reaction, user) {
  if (user.bot) return;
  if (reaction.message.id !== currentPollMessageId) return;
  const channel = reaction.message.channel;
  // Small delay so the count updates first
  setTimeout(() => updateLeader(channel), 1000);
}

client.on('messageReactionAdd',    (r, u) => handleReactionChange(r, u));
client.on('messageReactionRemove', (r, u) => handleReactionChange(r, u));

// ── Schedule ──────────────────────────────────────────────────────────────────
function scheduleNextPoll() {
  const now  = new Date();
  const next = new Date();
  next.setUTCHours(RESET_HOUR, RESET_MINUTE, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const msUntil = next - now;
  const hh = Math.floor(msUntil / 3600000);
  const mm = Math.floor((msUntil % 3600000) / 60000);
  console.log(`Next poll in ${hh}h ${mm}m (at ${next.toUTCString()})`);

  setTimeout(async () => {
    await postDailyPoll();
    setInterval(postDailyPoll, 24 * 60 * 60 * 1000);
  }, msUntil);
}

// ── Slash commands ────────────────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('testpoll')
      .setDescription('Post a test daily heroic poll right now (admin only)')
      .toJSON()
  ];
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'testpoll') {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: '❌ Only admins can use this command.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: '✅ Posting a test poll now!', ephemeral: true });
    await postDailyPoll(interaction.channel);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  scheduleNextPoll();
});

client.login(DISCORD_TOKEN);
