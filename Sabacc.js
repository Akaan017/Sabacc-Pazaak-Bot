const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const sabacc = require('../games/sabacc');

// Pending discard selections: Map<userId, { state, cardIndex }>
const pendingDiscard = new Map();

const SABACC_COLOR = 0x1a1a2e;
const SABACC_ACCENT = 0xffd700;

function sabaccEmbed(title, description, color = SABACC_COLOR) {
  return new EmbedBuilder()
    .setTitle(`🃏 ${title}`)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: 'Sabacc — Corellian Spike Variant' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sabacc')
    .setDescription('Play Sabacc — the galaxy\'s favourite card game')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new Sabacc game in this channel')
        .addIntegerOption(opt =>
          opt.setName('bet')
            .setDescription('Credits per player (default: 100)')
            .setMinValue(10).setMaxValue(10000)))
    .addSubcommand(sub =>
      sub.setName('join')
        .setDescription('Join the current Sabacc game'))
    .addSubcommand(sub =>
      sub.setName('deal')
        .setDescription('Deal cards and start the game (host only)'))
    .addSubcommand(sub =>
      sub.setName('hand')
        .setDescription('View your hand (private)'))
    .addSubcommand(sub =>
      sub.setName('draw')
        .setDescription('Draw a card from the deck'))
    .addSubcommand(sub =>
      sub.setName('draw-discard')
        .setDescription('Draw from the discard pile'))
    .addSubcommand(sub =>
      sub.setName('discard')
        .setDescription('Discard a card from your hand')
        .addIntegerOption(opt =>
          opt.setName('position')
            .setDescription('Card position in hand (1, 2, 3...)')
            .setRequired(true).setMinValue(1).setMaxValue(10)))
    .addSubcommand(sub =>
      sub.setName('stand')
        .setDescription('Stand — lock in your current hand'))
    .addSubcommand(sub =>
      sub.setName('fold')
        .setDescription('Fold — leave the current round'))
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show the current game status'))
    .addSubcommand(sub =>
      sub.setName('showdown')
        .setDescription('Force showdown — reveal all hands (host only)'))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the current game (host only)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channelId;
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // ── START ──────────────────────────────────────────────────────────────
    if (sub === 'start') {
      const existing = sabacc.getGame(channelId);
      if (existing) {
        return interaction.reply({ embeds: [sabaccEmbed('Game Already Running', 'A Sabacc game is already in progress here. Use `/sabacc join` to join it!', 0xe74c3c)], ephemeral: true });
      }
      const bet = interaction.options.getInteger('bet') || 100;
      const state = sabacc.startGame(channelId, userId, username, bet);
      if (!state) return interaction.reply({ content: 'Failed to start game.', ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sabacc_join').setLabel('Join Game').setStyle(ButtonStyle.Primary).setEmoji('🃏'),
        new ButtonBuilder().setCustomId('sabacc_deal').setLabel('Deal Cards').setStyle(ButtonStyle.Success).setEmoji('🎴'),
      );

      return interaction.reply({
        embeds: [sabaccEmbed(
          'Sabacc Game Starting!',
          `**${username}** is hosting a game of Sabacc!\n\n` +
          `💰 Ante: **${bet} credits** per player\n` +
          `👥 Players: **${username}**\n\n` +
          `Click **Join Game** to join, then the host clicks **Deal Cards** to start!`,
          SABACC_ACCENT,
        )],
        components: [row],
      });
    }

    // ── JOIN ───────────────────────────────────────────────────────────────
    if (sub === 'join') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ embeds: [sabaccEmbed('No Game', 'No Sabacc game running. Start one with `/sabacc start`!', 0xe74c3c)], ephemeral: true });
      if (state.phase !== 'joining') return interaction.reply({ embeds: [sabaccEmbed('Too Late', 'Cards have already been dealt.', 0xe74c3c)], ephemeral: true });

      const joined = sabacc.addPlayer(state, userId, username);
      if (!joined) return interaction.reply({ embeds: [sabaccEmbed('Already In', 'You\'re already in this game!', 0xe74c3c)], ephemeral: true });

      const names = state.players.map(p => `• ${p.username}`).join('\n');
      return interaction.reply({
        embeds: [sabaccEmbed('Player Joined!', `**${username}** joined the game!\n\n**Players (${state.players.length}):**\n${names}`, SABACC_ACCENT)],
      });
    }

    // ── DEAL ───────────────────────────────────────────────────────────────
    if (sub === 'deal') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });
      if (state.hostId !== userId) return interaction.reply({ content: 'Only the host can deal!', ephemeral: true });
      if (state.phase !== 'joining') return interaction.reply({ content: 'Cards already dealt.', ephemeral: true });
      if (state.players.length < 2) return interaction.reply({ content: 'Need at least 2 players to start!', ephemeral: true });

      sabacc.dealInitialCards(state);
      const names = state.players.map(p => `• ${p.username} (${p.credits} credits)`).join('\n');
      const current = sabacc.getCurrentPlayer(state);

      return interaction.reply({
        embeds: [sabaccEmbed(
          'Cards Dealt!',
          `Cards have been dealt! Each player has 2 cards.\n\n**Players:**\n${names}\n\n` +
          `🎮 First turn: **${current?.username}**\n\n` +
          `Use \`/sabacc hand\` to see your cards (private).\nOn your turn: \`draw\`, \`draw-discard\`, \`discard\`, \`stand\`, or \`fold\`.`,
          SABACC_ACCENT,
        )],
      });
    }

    // ── HAND ───────────────────────────────────────────────────────────────
    if (sub === 'hand') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });
      const player = state.players.find(p => p.id === userId);
      if (!player) return interaction.reply({ content: 'You\'re not in this game!', ephemeral: true });

      const total = sabacc.handTotal(player.hand);
      const display = sabacc.handDisplay(player.hand);
      const status = player.folded ? '🏳️ Folded' : player.standing ? '🛑 Standing' : '🎮 Active';

      return interaction.reply({
        embeds: [sabaccEmbed(
          'Your Hand',
          `${status}\n\n**Cards:** ${display}\n**Total:** \`${total}\`\n**Credits:** ${player.credits}\n\n` +
          `🎯 Goal: Get as close to **0** as possible!`,
          SABACC_COLOR,
        )],
        ephemeral: true,
      });
    }

    // ── DRAW ───────────────────────────────────────────────────────────────
    if (sub === 'draw') {
      const state = sabacc.getGame(channelId);
      if (!state || state.phase !== 'playing') return interaction.reply({ content: 'No active game.', ephemeral: true });

      const current = sabacc.getCurrentPlayer(state);
      if (!current || current.id !== userId) {
        return interaction.reply({ embeds: [sabaccEmbed('Not Your Turn', `It\'s **${current?.username || '?'}**\'s turn!`, 0xe74c3c)], ephemeral: true });
      }

      const card = sabacc.drawFromDeck(state, userId);
      if (!card) return interaction.reply({ content: 'Deck is empty!', ephemeral: true });

      const total = sabacc.handTotal(current.hand);
      const display = sabacc.handDisplay(current.hand);

      return interaction.reply({
        embeds: [sabaccEmbed(
          `${username} Drew a Card`,
          `Drew: \`${card.name}\`\n\n**Hand:** ${display}\n**Total:** \`${total}\`\n\n` +
          `You may: \`/sabacc discard\`, \`/sabacc stand\`, or \`/sabacc fold\``,
          SABACC_ACCENT,
        )],
      });
    }

    // ── DRAW-DISCARD ───────────────────────────────────────────────────────
    if (sub === 'draw-discard') {
      const state = sabacc.getGame(channelId);
      if (!state || state.phase !== 'playing') return interaction.reply({ content: 'No active game.', ephemeral: true });
      const current = sabacc.getCurrentPlayer(state);
      if (!current || current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });

      if (state.discardPile.length === 0) return interaction.reply({ content: 'Discard pile is empty!', ephemeral: true });

      const card = sabacc.drawFromDiscard(state, userId);
      const total = sabacc.handTotal(current.hand);
      const display = sabacc.handDisplay(current.hand);

      return interaction.reply({
        embeds: [sabaccEmbed(
          `${username} Drew from Discard`,
          `Drew: \`${card.name}\`\n\n**Hand:** ${display}\n**Total:** \`${total}\``,
          SABACC_ACCENT,
        )],
      });
    }

    // ── DISCARD ────────────────────────────────────────────────────────────
    if (sub === 'discard') {
      const state = sabacc.getGame(channelId);
      if (!state || state.phase !== 'playing') return interaction.reply({ content: 'No active game.', ephemeral: true });
      const current = sabacc.getCurrentPlayer(state);
      if (!current || current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });

      const pos = interaction.options.getInteger('position') - 1;
      if (pos < 0 || pos >= current.hand.length) return interaction.reply({ content: `Invalid position. You have ${current.hand.length} cards.`, ephemeral: true });

      const card = sabacc.discardCard(state, userId, pos);
      sabacc.advanceTurn(state);
      const nextPlayer = sabacc.getCurrentPlayer(state);

      return interaction.reply({
        embeds: [sabaccEmbed(
          `${username} Discarded`,
          `Discarded: \`${card.name}\`\n\n🎮 Next turn: **${nextPlayer?.username || 'nobody'}**`,
          SABACC_ACCENT,
        )],
      });
    }

    // ── STAND ──────────────────────────────────────────────────────────────
    if (sub === 'stand') {
      const state = sabacc.getGame(channelId);
      if (!state || state.phase !== 'playing') return interaction.reply({ content: 'No active game.', ephemeral: true });
      const current = sabacc.getCurrentPlayer(state);
      if (!current || current.id !== userId) return interaction.reply({ content: 'Not your turn!', ephemeral: true });

      sabacc.standPlayer(state, userId);
      sabacc.advanceTurn(state);

      if (sabacc.isRoundOver(state)) {
        const result = sabacc.resolveGame(state);
        const winLines = result.winners.map(w => {
          const sc = sabacc.scoreHand(w.hand);
          const handStr = sabacc.handDisplay(w.hand);
          return `🏆 **${w.username}** — ${handStr} = **${sc.total}**${sc.isPureSabacc ? ' ⭐ PURE SABACC!' : ''}`;
        }).join('\n');

        const allLines = state.players.map(p => {
          const sc = sabacc.scoreHand(p.hand);
          const folded = p.folded ? ' _(folded)_' : '';
          return `• **${p.username}**: ${sabacc.handDisplay(p.hand)} = \`${sc.total}\`${folded}`;
        }).join('\n');

        sabacc.endGame(channelId);
        return interaction.reply({
          embeds: [sabaccEmbed(
            'SHOWDOWN!',
            `All players have stood.\n\n**Hands:**\n${allLines}\n\n${winLines}\n\n💰 Pot: **${result.pot} credits**`,
            0xffd700,
          )],
        });
      }

      const next = sabacc.getCurrentPlayer(state);
      return interaction.reply({
        embeds: [sabaccEmbed(`${username} Stands`, `**${username}** is standing!\n\n🎮 Next turn: **${next?.username || 'showdown soon'}**`, SABACC_ACCENT)],
      });
    }

    // ── FOLD ───────────────────────────────────────────────────────────────
    if (sub === 'fold') {
      const state = sabacc.getGame(channelId);
      if (!state || state.phase !== 'playing') return interaction.reply({ content: 'No active game.', ephemeral: true });

      sabacc.foldPlayer(state, userId);

      const activePlayers = state.players.filter(p => !p.folded);
      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        winner.credits += state.pot;
        sabacc.endGame(channelId);
        return interaction.reply({
          embeds: [sabaccEmbed('Game Over', `**${username}** folded!\n\n🏆 **${winner.username}** wins by default! +${state.pot} credits`, 0xffd700)],
        });
      }

      sabacc.advanceTurn(state);
      const next = sabacc.getCurrentPlayer(state);
      return interaction.reply({
        embeds: [sabaccEmbed(`${username} Folded`, `**${username}** has folded.\n\n🎮 Next turn: **${next?.username || '?'}**`, SABACC_COLOR)],
      });
    }

    // ── STATUS ─────────────────────────────────────────────────────────────
    if (sub === 'status') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running. Start with `/sabacc start`!', ephemeral: true });
      const current = sabacc.getCurrentPlayer(state);
      const status = sabacc.formatGameState(state, userId);
      return interaction.reply({
        embeds: [sabaccEmbed('Game Status', status + (current ? `\n\n🎮 Current turn: **${current.username}**` : ''), SABACC_COLOR)],
        ephemeral: true,
      });
    }

    // ── SHOWDOWN ───────────────────────────────────────────────────────────
    if (sub === 'showdown') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });
      if (state.hostId !== userId) return interaction.reply({ content: 'Only the host can force a showdown!', ephemeral: true });

      const result = sabacc.resolveGame(state);
      const allLines = state.players.map(p => {
        const sc = sabacc.scoreHand(p.hand);
        return `• **${p.username}**: ${sabacc.handDisplay(p.hand)} = \`${sc.total}\`${p.folded ? ' _(folded)_' : ''}`;
      }).join('\n');
      const winLines = result.winners.map(w => {
        const sc = sabacc.scoreHand(w.hand);
        return `🏆 **${w.username}** — total: \`${sc.total}\`${sc.isPureSabacc ? ' ⭐ PURE SABACC!' : ''}`;
      }).join('\n');

      sabacc.endGame(channelId);
      return interaction.reply({
        embeds: [sabaccEmbed('Forced Showdown!', `**All Hands:**\n${allLines}\n\n${winLines}\n\n💰 Pot: **${result.pot} credits**`, 0xffd700)],
      });
    }

    // ── END ────────────────────────────────────────────────────────────────
    if (sub === 'end') {
      const state = sabacc.getGame(channelId);
      if (!state) return interaction.reply({ content: 'No game running.', ephemeral: true });
      if (state.hostId !== userId) return interaction.reply({ content: 'Only the host can end the game!', ephemeral: true });
      sabacc.endGame(channelId);
      return interaction.reply({ embeds: [sabaccEmbed('Game Ended', 'The Sabacc game has been ended by the host.', 0xe74c3c)] });
    }
  },
};
