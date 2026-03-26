const {
  Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, InteractionType
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Persistence ───────────────────────────────────────────────────────────────
const DATA_FILE = process.env.DATA_FILE ?? path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      pollChannelId:    null,
      requestChannelId: null,
      logChannelId:     null,
      pingRoles:        [],
      craftItems:       ['Nether Vortex'],
      requests:         [],
      pollMessageId:    null,
      leaderMessageId:  null,
    };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// ── Discord client ────────────────────────────────────────────────────────────
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

// ── Dungeons ──────────────────────────────────────────────────────────────────
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

// ── Poll helpers ──────────────────────────────────────────────────────────────
async function updateLeader(channel) {
  if (!data.pollMessageId) return;
  let pollMsg;
  try { pollMsg = await channel.messages.fetch(data.pollMessageId); } catch { return; }

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
    if (data.leaderMessageId) {
      const leaderMsg = await channel.messages.fetch(data.leaderMessageId);
      await leaderMsg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      data.leaderMessageId = msg.id;
      saveData(data);
    }
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    data.leaderMessageId = msg.id;
    saveData(data);
  }
}

async function postDailyPoll(channel) {
  if (!channel) {
    channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('Channel not found.'); return; }
  }

  if (data.pollMessageId) {
    try {
      const old = await channel.messages.fetch(data.pollMessageId);
      const results = buildResultsEmbed(await getVotes(old));
      await channel.send({ embeds: [results] });
      await old.delete();
    } catch { /* already gone */ }
  }
  if (data.leaderMessageId) {
    try {
      const old = await channel.messages.fetch(data.leaderMessageId);
      await old.delete();
    } catch { /* already gone */ }
    data.leaderMessageId = null;
  }

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
  data.pollMessageId = msg.id;
  saveData(data);

  await updateLeader(channel);
  console.log(`[${new Date().toISOString()}] Daily poll posted.`);
}

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

async function handleReactionChange(reaction, user) {
  if (user.bot) return;
  if (reaction.message.id !== data.pollMessageId) return;
  setTimeout(() => updateLeader(reaction.message.channel), 1000);
}

client.on('messageReactionAdd',    (r, u) => handleReactionChange(r, u));
client.on('messageReactionRemove', (r, u) => handleReactionChange(r, u));

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

// ── Post the persistent request form embed ────────────────────────────────────
async function postRequestEmbed(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('⚒️ Craft Request')
    .setDescription(
      '**Need something crafted? Submit a request below!**\n\n' +
      'Click the button to open the request form. Fill in:\n' +
      '• **Character Name** — your in-game name\n' +
      '• **What You\'re Crafting** — brief description (e.g. "Belt of Blasting")\n' +
      '• **Item Name** — the material/reagent you need\n' +
      '• **Quantity** — how many you need\n\n' +
      '*All requests are logged and sent to the officer channel.*'
    )
    .setFooter({ text: 'TBC Craft Requests • Use /requesthistory to view past requests' })
    .setTimestamp();

  const button = {
    type: 1,
    components: [{
      type: 2,
      style: 1,
      label: '📋 Submit a Request',
      custom_id: 'open_request_modal',
    }]
  };

  await channel.send({ embeds: [embed], components: [button] });
}

// ── Slash command definitions ─────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('testpoll')
      .setDescription('Post a test daily heroic poll right now (admin only)'),

    new SlashCommandBuilder()
      .setName('setrequestchannel')
      .setDescription('Set this channel as the craft request channel (admin only)'),

    new SlashCommandBuilder()
      .setName('setlogchannel')
      .setDescription('Set this channel as the private request log channel (admin only)'),

    new SlashCommandBuilder()
      .setName('addpingrole')
      .setDescription('Add a role to ping when a request is made (admin only)')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to ping').setRequired(true)),

    new SlashCommandBuilder()
      .setName('removepingrole')
      .setDescription('Remove a role from the ping list (admin only)')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to remove').setRequired(true)),

    new SlashCommandBuilder()
      .setName('listpingroles')
      .setDescription('List all roles currently set to be pinged on requests'),

    new SlashCommandBuilder()
      .setName('additem')
      .setDescription('Add an item to the craft request dropdown (admin only)')
      .addStringOption(opt =>
        opt.setName('item').setDescription('Item name to add').setRequired(true)),

    new SlashCommandBuilder()
      .setName('removeitem')
      .setDescription('Remove an item from the craft request dropdown (admin only)')
      .addStringOption(opt =>
        opt.setName('item').setDescription('Item name to remove').setRequired(true)
          .setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('listitems')
      .setDescription('List all items currently in the craft request dropdown'),

    new SlashCommandBuilder()
      .setName('requesthistory')
      .setDescription('Show recent craft request history (last 20)')
      .addStringOption(opt =>
        opt.setName('status')
          .setDescription('Filter by status')
          .addChoices(
            { name: 'All',      value: 'all'      },
            { name: 'Open',     value: 'open'     },
            { name: 'Accepted', value: 'accepted' },
            { name: 'Declined', value: 'declined' }
          )),

    new SlashCommandBuilder()
      .setName('userrequests')
      .setDescription('Show all craft requests from a specific user')
      .addUserOption(opt =>
        opt.setName('user').setDescription('Discord user to look up').setRequired(true)),

    new SlashCommandBuilder()
      .setName('closerequest')
      .setDescription('Manually mark a craft request as complete (admin only)')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Request ID to close').setRequired(true)),

  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

// ── Shared status icon helper ─────────────────────────────────────────────────
const statusIcon = (s) => s === 'accepted' ? '✅' : s === 'declined' ? '❌' : '🕐';

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Autocomplete ────────────────────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'removeitem') {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = data.craftItems
        .filter(i => i.toLowerCase().includes(focused))
        .slice(0, 25)
        .map(i => ({ name: i, value: i }));
      await interaction.respond(choices);
    }
    return;
  }

  // ── Button: open request modal ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'open_request_modal') {
    const itemList = data.craftItems.join(', ') || 'No items configured yet';

    const modal = new ModalBuilder()
      .setCustomId('craft_request_modal')
      .setTitle('⚒️ Craft Request');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('char_name')
          .setLabel('Character Name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Your in-game character name')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('crafting_desc')
          .setLabel('What Are You Crafting?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Belt of Blasting, Spellfire Robe...')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('item_name')
          .setLabel('Item Needed')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`Available: ${itemList}`)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('quantity')
          .setLabel('Quantity Needed')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 4')
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Button: Accept or Decline a request ─────────────────────────────────────
  if (interaction.isButton() && (
    interaction.customId.startsWith('accept_request_') ||
    interaction.customId.startsWith('decline_request_')
  )) {
    const isAdmin = interaction.member.permissions.has('Administrator');
    const isOfficer = data.pingRoles.some(r => interaction.member.roles.cache.has(r)); 
    if (!isAdmin && !isOfficer) {
      await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
      return;
    }

    const parts      = interaction.customId.split('_'); // ['accept'/'decline', 'request', id]
    const action     = parts[0];                        // 'accept' or 'decline'
    const id         = parseInt(parts[2]);
    const req        = data.requests.find(r => r.id === id);

    if (!req) {
      await interaction.reply({ content: `❌ Request #${id} not found.`, ephemeral: true });
      return;
    }
    if (req.status !== 'open') {
      await interaction.reply({ content: `⚠️ Request #${id} is already **${req.status}**.`, ephemeral: true });
      return;
    }

    const isAccepted = action === 'accept';
    req.status       = isAccepted ? 'accepted' : 'declined';
    req.closedBy     = interaction.user.tag;
    req.closedAt     = new Date().toISOString();
    saveData(data);

    // Edit the officer log message — update embed color/title and disable buttons
    const updatedEmbed = new EmbedBuilder()
      .setColor(isAccepted ? 0x57F287 : 0xE74C3C)
      .setTitle(`${isAccepted ? '✅ Accepted' : '❌ Declined'} — Request #${id}`)
      .addFields(
        { name: '👤 Discord User',   value: `<@${req.userId}>`,   inline: true },
        { name: '🧙 Character Name', value: req.charName,          inline: true },
        { name: '⚒️ Crafting',        value: req.craftingDesc,      inline: false },
        { name: '📦 Item Needed',     value: req.itemName,          inline: true },
        { name: '🔢 Quantity',        value: `${req.quantity}`,     inline: true },
        {
          name:  isAccepted ? '✅ Accepted By' : '❌ Declined By',
          value: req.closedBy,
          inline: true,
        },
        {
          name:  '🕐 Resolved',
          value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: true,
        },
      )
      .setFooter({ text: `Request ID: ${id} • ${req.status.toUpperCase()}` })
      .setTimestamp();

    const disabledRow = {
      type: 1,
      components: [
        { type: 2, style: 3, label: '✅ Accept',  custom_id: `accept_request_${id}`,  disabled: true },
        { type: 2, style: 4, label: '❌ Decline', custom_id: `decline_request_${id}`, disabled: true },
      ]
    };

    await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });

    // DM the requester with the outcome
    try {
      const requester = await client.users.fetch(req.userId);
      const dmEmbed = new EmbedBuilder()
        .setColor(isAccepted ? 0x57F287 : 0xE74C3C)
        .setTitle(isAccepted
          ? '✅ Your Craft Request Was Accepted!'
          : '❌ Your Craft Request Was Declined')
        .setDescription(isAccepted
          ? 'An officer will reach out to you shortly to fulfill your request!'
          : 'Your request was declined. Feel free to reach out to an officer if you have questions.')
        .addFields(
          { name: '⚒️ Crafting', value: req.craftingDesc,                   inline: true },
          { name: '📦 Item',     value: `${req.itemName} x${req.quantity}`, inline: true },
        )
        .setFooter({ text: `Request #${id}` })
        .setTimestamp();

      await requester.send({ embeds: [dmEmbed] });
    } catch {
      // User has DMs disabled — silently ignore
    }

    return;
  }

  // ── Modal submit: save request + notify log channel ──────────────────────────
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'craft_request_modal') {
    const charName     = interaction.fields.getTextInputValue('char_name');
    const craftingDesc = interaction.fields.getTextInputValue('crafting_desc');
    const itemName     = interaction.fields.getTextInputValue('item_name');
    const quantityRaw  = interaction.fields.getTextInputValue('quantity');
    const quantity     = parseInt(quantityRaw);

    if (isNaN(quantity) || quantity < 1) {
      await interaction.reply({ content: '❌ Quantity must be a valid number greater than 0.', ephemeral: true });
      return;
    }

    const requestId = data.requests.length + 1;
    const entry = {
      id:           requestId,
      userId:       interaction.user.id,
      username:     interaction.user.tag,
      charName,
      craftingDesc,
      itemName,
      quantity,
      status:       'open',
      timestamp:    new Date().toISOString(),
    };
    data.requests.push(entry);
    saveData(data);

    await interaction.reply({
      content: `✅ **Request #${requestId} submitted!** An officer will reach out to you.`,
      ephemeral: true
    });

    if (data.logChannelId) {
      try {
        const logChannel = await client.channels.fetch(data.logChannelId);
        const rolePings  = data.pingRoles.map(r => `<@&${r}>`).join(' ');

        const logEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle(`📬 New Craft Request — #${requestId}`)
          .addFields(
            { name: '👤 Discord User',   value: `<@${interaction.user.id}>`, inline: true },
            { name: '🧙 Character Name', value: charName,                    inline: true },
            { name: '⚒️ Crafting',        value: craftingDesc,                inline: false },
            { name: '📦 Item Needed',     value: itemName,                    inline: true },
            { name: '🔢 Quantity',        value: `${quantity}`,               inline: true },
            { name: '🕐 Submitted',       value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
          )
          .setFooter({ text: `Request ID: ${requestId} • Use the buttons below to accept or decline` })
          .setTimestamp();

        const actionRow = {
          type: 1,
          components: [
            { type: 2, style: 3, label: '✅ Accept',  custom_id: `accept_request_${requestId}` },
            { type: 2, style: 4, label: '❌ Decline', custom_id: `decline_request_${requestId}` },
          ]
        };

        await logChannel.send({
          content:    rolePings || undefined,
          embeds:     [logEmbed],
          components: [actionRow],
        });
      } catch (err) {
        console.error('Failed to send to log channel:', err);
      }
    }
    return;
  }

  // ── Slash commands ───────────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const isAdmin = interaction.member.permissions.has('Administrator');

  if (interaction.commandName === 'testpoll') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    await interaction.reply({ content: '✅ Posting a test poll now!', ephemeral: true });
    await postDailyPoll(interaction.channel);
    return;
  }

  if (interaction.commandName === 'setrequestchannel') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    data.requestChannelId = interaction.channelId;
    saveData(data);
    await postRequestEmbed(interaction.channel);
    await interaction.reply({ content: '✅ This channel is now the craft request channel.', ephemeral: true });
    return;
  }

  if (interaction.commandName === 'setlogchannel') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    data.logChannelId = interaction.channelId;
    saveData(data);
    await interaction.reply({ content: '✅ This channel is now the private request log channel.', ephemeral: true });
    return;
  }

  if (interaction.commandName === 'addpingrole') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    const role = interaction.options.getRole('role');
    if (data.pingRoles.includes(role.id)) {
      await interaction.reply({ content: `⚠️ ${role} is already on the ping list.`, ephemeral: true });
      return;
    }
    data.pingRoles.push(role.id);
    saveData(data);
    await interaction.reply({ content: `✅ ${role} will now be pinged on new requests.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'removepingrole') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    const role = interaction.options.getRole('role');
    const idx  = data.pingRoles.indexOf(role.id);
    if (idx === -1) {
      await interaction.reply({ content: `⚠️ ${role} is not on the ping list.`, ephemeral: true });
      return;
    }
    data.pingRoles.splice(idx, 1);
    saveData(data);
    await interaction.reply({ content: `✅ ${role} removed from ping list.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'listpingroles') {
    if (data.pingRoles.length === 0) {
      await interaction.reply({ content: '📋 No roles are currently set to be pinged.', ephemeral: true });
      return;
    }
    const list = data.pingRoles.map(r => `<@&${r}>`).join('\n');
    await interaction.reply({ content: `📋 **Ping Roles:**\n${list}`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'additem') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    const item = interaction.options.getString('item').trim();
    if (data.craftItems.map(i => i.toLowerCase()).includes(item.toLowerCase())) {
      await interaction.reply({ content: `⚠️ **${item}** is already in the list.`, ephemeral: true });
      return;
    }
    data.craftItems.push(item);
    saveData(data);
    await interaction.reply({ content: `✅ **${item}** added to the craft item list.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'removeitem') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    const item = interaction.options.getString('item').trim();
    const idx  = data.craftItems.findIndex(i => i.toLowerCase() === item.toLowerCase());
    if (idx === -1) {
      await interaction.reply({ content: `⚠️ **${item}** not found in the list.`, ephemeral: true });
      return;
    }
    data.craftItems.splice(idx, 1);
    saveData(data);
    await interaction.reply({ content: `✅ **${item}** removed from the craft item list.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'listitems') {
    if (data.craftItems.length === 0) {
      await interaction.reply({ content: '📋 No items in the list yet.', ephemeral: true });
      return;
    }
    const list = data.craftItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
    await interaction.reply({ content: `📋 **Craft Items:**\n${list}`, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'requesthistory') {
    const statusFilter = interaction.options.getString('status') ?? 'all';
    let filtered = data.requests;
    if (statusFilter !== 'all') filtered = filtered.filter(r => r.status === statusFilter);

    const recent = filtered.slice(-20).reverse();
    if (recent.length === 0) {
      await interaction.reply({ content: '📋 No requests found.', ephemeral: true });
      return;
    }

    const lines = recent.map(r =>
      `**#${r.id}** ${statusIcon(r.status)} [${r.status.toUpperCase()}] — <@${r.userId}> | ${r.charName} | ${r.itemName} x${r.quantity} | <t:${Math.floor(new Date(r.timestamp).getTime() / 1000)}:R>`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle(`📋 Craft Request History${statusFilter !== 'all' ? ` (${statusFilter})` : ''}`)
      .setDescription(lines)
      .setFooter({ text: `Showing last ${recent.length} requests` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === 'userrequests') {
    const user     = interaction.options.getUser('user');
    const userReqs = data.requests.filter(r => r.userId === user.id);

    if (userReqs.length === 0) {
      await interaction.reply({ content: `📋 No requests found for <@${user.id}>.`, ephemeral: true });
      return;
    }

    const lines = userReqs.slice(-20).reverse().map(r =>
      `**#${r.id}** ${statusIcon(r.status)} [${r.status.toUpperCase()}] — ${r.charName} | ⚒️ ${r.craftingDesc} | 📦 ${r.itemName} x${r.quantity} | <t:${Math.floor(new Date(r.timestamp).getTime() / 1000)}:R>`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle(`📋 Requests for ${user.username}`)
      .setDescription(lines)
      .setFooter({ text: `${userReqs.length} total request(s)` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === 'closerequest') {
    if (!isAdmin) { await interaction.reply({ content: '❌ Admins only.', ephemeral: true }); return; }
    const id  = interaction.options.getInteger('id');
    const req = data.requests.find(r => r.id === id);

    if (!req) {
      await interaction.reply({ content: `❌ No request found with ID **#${id}**.`, ephemeral: true });
      return;
    }
    if (req.status !== 'open') {
      await interaction.reply({ content: `⚠️ Request **#${id}** is already **${req.status}**.`, ephemeral: true });
      return;
    }

    req.status   = 'closed';
    req.closedBy = interaction.user.tag;
    req.closedAt = new Date().toISOString();
    saveData(data);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`✅ Request #${id} Closed`)
      .addFields(
        { name: '👤 Requester', value: `<@${req.userId}>`,                  inline: true },
        { name: '🧙 Character', value: req.charName,                        inline: true },
        { name: '📦 Item',      value: `${req.itemName} x${req.quantity}`,  inline: true },
        { name: '✅ Closed By', value: req.closedBy,                        inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
    return;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  scheduleNextPoll();
});

client.login(DISCORD_TOKEN);
