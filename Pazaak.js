const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pazaak = require('../games/pazaak');

const PAZ_COLOR = 0x0d3b66;
const PAZ_ACCENT = 0x00d4ff;

function pazEmbed(title, desc, color = PAZ_COLOR) {
  return new EmbedBuilder()
    .setTitle(`🎴 ${title}`)
    .setDescription(desc)
    .setColor(color)
    .setFooter({ text: 'Pazaak — As played in the Old Republic' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pazaak')
    .setDescription('Play Pazaak — the Old Republic card game')
    .addSubcommand(sub =>
      sub.setName('challenge')
        .setDescription('Challenge another player to Pazaak')
        .addUserOption(opt =>
          opt.setName('opponent').setDescription('The player to challenge').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('draw')
        .setDescription('Draw your next main deck card'))
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('Play a card from your side deck')
        .addIntegerOption(opt =>
          opt.setName('card').setDescription('Side deck card slot (1-4)').setRequired(true).setMinValue(1).setMaxValue(4))
        .addStringOption(opt =>
          opt.setName('choice').setDescription('For +/- cards: choose + or -').addChoices(
            { name: '+', value: '+' },
            { name: '-', value: '-' },
          )))
    .addSubcommand(sub =>
      sub.setName('stand')
        .setDescription('Stand — lock in your total for this set'))
    .addSubcommand(sub =>
      sub.setName('end-turn')
        .setDescription('End your turn without standing (draw again next turn)'))
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show the current game board'))
    .addSubcommand(sub =>
      sub.setName('sidedeck')
        .setDescription('View your side deck'))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('Forfeit and end the current Pazaak game')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // ── CHALLENGE ──────────────────────────────────────────────────────────
    if (sub === 'challenge') {
      const existing = pazaak.getGame(channelId);
      if (existing) return interaction.reply({ embeds: [pazEmbed('Game Running', 'A Pazaak game is already in progress here!', 0xe74c3c)], ephemeral: true });

      const opponent = interaction.options.getUser('opponent');
      if (opponent.id === userId) return interaction.reply({ content: 'You can\'t challenge yourself!', ephemeral: true });
      if (opponent.bot) return interaction.reply({ content: 'You can\'t challenge a bot!', ephemeral: true });

      const state = pazaak.startGame(channelId, userId, username, opponent.id, opponent.username);
      if (!state) return interaction.reply({ content: 'Failed to start game.', ephemeral: true });

      const p0 = state.players[0];
      const p1 = state.players[1];

      return interaction.reply({
        embeds: [pazEmbed(
          'Pazaak Challenge!',
          `**${username}** challenges **${opponent.username}** to Pazaak!\n\n` +
          `🎯 Goal: Reach **20** exactly, or as close as possible without going over.\n` +
          `🏆 First to win **2 sets** wins the match.\n\n` +
          `📖 **How to play:**\n` +
          `• \`/pazaak draw\` — draw your main card (auto-added to total)\n` +
          `• \`/pazaak play [1-4]\` — play a side deck card\n` +
          `• \`/pazaak stand\` — lock in your total\n` +
          `• \`/pazaak end-turn\` — end turn without standing\n\n` +
          `🎮 **${p0.name}** goes first!`,
          PAZ_ACCENT,
        )],
      });
    }

    // ── DRAW ───────────────────────────────────────────────────────────────
    if (sub === 'draw') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No Pazaak game here. Start one with `/pazaak challenge`!', ephemeral: true });
      if (state.phase === 'ended') return interaction.reply({ content: 'Game is over!', ephemeral: true });

      const current = pazaak.getCurrentPlayer(state);
      if (current.id !== userId) {
        return interaction.reply({ embeds: [pazEmbed('Not Your Turn', `It\'s **${current.name}**\'s turn!`, 0xe74c3c)], ephemeral: true });
      }
      if (state.phase !== 'draw') {
        return interaction.reply({ embeds: [pazEmbed('Wait', 'You must play a side card, stand, or end turn first.', 0xe74c3c)], ephemeral: true });
      }

      const card = pazaak.drawCard(state);
      if (!card) return interaction.reply({ content: 'Error drawing card.', ephemeral: true });

      const desc = current.busted
        ? `Drew \`${card}\` → Total: **${current.total}** 💥 **BUST!**`
        : `Drew \`${card}\` → Total: **${current.total}**\n\nYou may:\n• \`/pazaak play [1-4]\` — play a side deck card\n• \`/pazaak stand\` — lock in total\n• \`/pazaak end-turn\` — end your turn`;

      const embed = pazEmbed(`${username} Drew ${card}`, desc, current.busted ? 0xe74c3c : PAZ_ACCENT);
      const reply = await interaction.reply({ embeds: [embed], fetchReply: true });

      if (current.busted) {
        // Auto-advance
        const result = pazaak.endTurn(state);
        await handleSetResult(interaction, result, state, false);
      }

      return;
    }

    // ── PLAY (side card) ───────────────────────────────────────────────────
    if (sub === 'play') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });

      const current = pazaak.getCurrentPlayer(state);
      if (current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });
      if (state.phase !== 'action') return interaction.reply({ content: 'Draw first with `/pazaak draw`!', ephemeral: true });

      const slot = interaction.options.getInteger('card') - 1;
      if (slot < 0 || slot >= current.sideDeck.length) {
        return interaction.reply({ content: `Invalid slot. You have ${current.sideDeck.length} side cards.`, ephemeral: true });
      }

      const choiceInput = interaction.options.getString('choice');
      const result = pazaak.playSideCard(state, slot, choiceInput);

      if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

      const desc = current.busted
        ? `Played \`${result.card.display}\` → Total: **${current.total}** 💥 **BUST!**`
        : `Played \`${result.card.display}\` → Total: **${current.total}**\n\nNow: \`/pazaak stand\` or \`/pazaak end-turn\``;

      await interaction.reply({ embeds: [pazEmbed(`${username} Played ${result.card.display}`, desc, current.busted ? 0xe74c3c : PAZ_ACCENT)] });

      if (current.busted) {
        const setResult = pazaak.endTurn(state);
        await handleSetResult(interaction, setResult, state, false);
      }

      return;
    }

    // ── STAND ──────────────────────────────────────────────────────────────
    if (sub === 'stand') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });

      const current = pazaak.getCurrentPlayer(state);
      if (current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });
      if (state.phase !== 'action') return interaction.reply({ content: 'Draw a card first!', ephemeral: true });

      await interaction.reply({ embeds: [pazEmbed(`${username} Stands`, `**${username}** stands at **${current.total}**!`, PAZ_ACCENT)] });
      const result = pazaak.standPlayer(state);
      await handleSetResult(interaction, result, state, false);
      return;
    }

    // ── END TURN ───────────────────────────────────────────────────────────
    if (sub === 'end-turn') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });

      const current = pazaak.getCurrentPlayer(state);
      if (current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });
      if (state.phase !== 'action') return interaction.reply({ content: 'Draw a card first!', ephemeral: true });

      await interaction.reply({ embeds: [pazEmbed(`${username} Ends Turn`, `**${username}** ends their turn at **${current.total}**.`, PAZ_COLOR)] });
      const result = pazaak.endTurn(state);
      await handleSetResult(interaction, result, state, false);
      return;
    }

    // ── STATUS ─────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });

      const display = pazaak.formatState(state, userId);
      const current = pazaak.getCurrentPlayer(state);
      return interaction.reply({
        embeds: [pazEmbed('Game Status', display + `\n\n🎮 Current turn: **${current.name}**`, PAZ_COLOR)],
        ephemeral: true,
      });
    }

    // ── SIDE DECK ──────────────────────────────────────────────────────────
    if (sub === 'sidedeck') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });

      const player = state.players.find(p => p.id === userId);
      if (!player) return interaction.reply({ content: 'You\'re not in this game!', ephemeral: true });

      const cards = player.sideDeck.map((c, i) => `**[${i + 1}]** \`${c.display}\``).join('\n');
      return interaction.reply({
        embeds: [pazEmbed('Your Side Deck', cards || '_All side cards used!_', PAZ_COLOR)],
        ephemeral: true,
      });
    }

    // ── END ────────────────────────────────────────────────────────────────
    if (sub === 'end') {
      const state = pazaak.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });
      const inGame = state.players.find(p => p.id === userId);
      if (!inGame) return interaction.reply({ content: 'You\'re not in this game!', ephemeral: true });
      pazaak.endGame(channelId);
      return interaction.reply({ embeds: [pazEmbed('Game Ended', `**${username}** forfeited the game.`, 0xe74c3c)] });
    }
  },
};

// Helper: follow-up messages for set/match resolution
async function handleSetResult(interaction, result, state, isReply = true) {
  if (!result || result.continued) return;

  const send = (opts) => interaction.followUp(opts);

  if (result.matchOver) {
    const winner = result.matchWinner;
    pazaak.endGame(state.channelId);
    return send({
      embeds: [new EmbedBuilder()
        .setTitle('🏆 PAZAAK MATCH OVER!')
        .setDescription(
          `**${winner.name}** wins the match!\n\n` +
          `**Final Scores:**\n` +
          state.players.map(p => `• **${p.name}**: ${p.setsWon} set(s) won`).join('\n')
        )
        .setColor(0xffd700)
        .setFooter({ text: 'Pazaak — As played in the Old Republic' })
      ],
    });
  }

  if (result.setWinner) {
    const sw = result.setWinner;
    return send({
      embeds: [new EmbedBuilder()
        .setTitle(`Set ${state.set - 1} Over!`)
        .setDescription(
          `🏅 **${sw.name}** wins the set!\n\n` +
          `**Totals:** ${state.players.map(p => `${p.name}: ${result[`p${state.players.indexOf(p)}Total`] ?? p.total}`).join(' vs ')}\n\n` +
          `**Sets:** ${state.players.map(p => `${p.name}: ${p.setsWon}`).join(' | ')}\n\n` +
          `▶️ Starting Set ${state.set}! **${state.players[state.currentTurn].name}** goes first.`
        )
        .setColor(0x00d4ff)
        .setFooter({ text: 'Pazaak — As played in the Old Republic' })
      ],
    });
  }

  // No winner this set (both busted / tie)
  return send({
    embeds: [new EmbedBuilder()
      .setTitle(`Set ${(state.set || 1) - 1} — No Winner`)
      .setDescription(
        `Both players ${result.p0Total > 20 && result.p1Total > 20 ? 'busted' : 'tied'}!\n\n` +
        `▶️ Starting Set ${state.set}!`
      )
      .setColor(0x888888)
    ],
  });
}
