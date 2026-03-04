const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ]
});

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const CHANNEL_ID      = process.env.CHANNEL_ID;       // channel to post polls in
const RESET_HOUR      = parseInt(process.env.RESET_HOUR  ?? '9');   // 24h UTC
const RESET_MINUTE    = parseInt(process.env.RESET_MINUTE ?? '0');
// ──────────────────────────────────────────────────────────────────────────────

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
  { emoji: '🇫', name: 'Magisters\' Terrace' },
];

let currentPollMessageId = null;
let currentPollChannelId = null;

async function postDailyPoll() {
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error('Could not find channel. Check CHANNEL_ID.');
    return;
  }

  // Pin message showing results before deleting if there was a previous poll
  if (currentPollMessageId) {
    try {
      const old = await channel.messages.fetch(currentPollMessageId);
      const results = await buildResultsEmbed(old);
      await channel.send({ embeds: [results] });
      await old.delete();
    } catch (e) {
      // message may already be gone
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xF5A623)
    .setTitle('📅 What is today\'s Daily Heroic Dungeon?')
    .setDescription(
      DUNGEONS.map(d => `${d.emoji}  ${d.name}`).join('\n') +
      '\n\n*React with the dungeon you see from the quest NPC!\nOne vote per person — majority wins.*'
    )
    .setFooter({ text: 'Poll resets daily at server reset • Trolls will be outvoted 😄' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });

  // Add all reaction options
  for (const d of DUNGEONS) {
    await msg.react(d.emoji);
  }

  currentPollMessageId = msg.id;
  currentPollChannelId = channel.id;
  console.log(`[${new Date().toISOString()}] Daily poll posted.`);
}

async function buildResultsEmbed(message) {
  const votes = [];
  for (const d of DUNGEONS) {
    const reaction = message.reactions.cache.get(d.emoji);
    // Subtract 1 to exclude the bot's own reaction
    const count = reaction ? reaction.count - 1 : 0;
    if (count > 0) votes.push({ name: d.name, emoji: d.emoji, count });
  }

  votes.sort((a, b) => b.count - a.count);

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

function scheduleNextPoll() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(RESET_HOUR, RESET_MINUTE, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const msUntil = next - now;
  const hh = Math.floor(msUntil / 3600000);
  const mm = Math.floor((msUntil % 3600000) / 60000);
  console.log(`Next poll in ${hh}h ${mm}m (at ${next.toUTCString()})`);

  setTimeout(async () => {
    await postDailyPoll();
    // Then repeat every 24 hours
    setInterval(postDailyPoll, 24 * 60 * 60 * 1000);
  }, msUntil);
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  scheduleNextPoll();

  // If you want an immediate poll on first startup, uncomment:
  // await postDailyPoll();
});

client.login(DISCORD_TOKEN);
