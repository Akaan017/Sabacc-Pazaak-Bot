/**
 * SABACC GAME ENGINE
 * Based on the Corellian Spike variant (as seen in Solo: A Star Wars Story)
 *
 * Deck: 62 cards — two suits (Circles & Squares), each numbered 1-10, plus
 * special single-copy cards (Sylop = 0, The Idiot = 0, and special cards).
 * Also includes 2 Sylop cards (wild/zero cards).
 *
 * Goal: Get as close to 0 as possible without going bust.
 * Positive and negative cards exist. Pure Sabacc (two Sylops) = automatic win.
 * Sabacc = exactly 0. Closest to 0 wins; ties go to fewest cards.
 */

const SUITS = ['⭕', '🔷'];
const SPECIAL_CARDS = [
  { name: 'The Idiot', value: 0, id: 'idiot' },
  { name: 'Sylop', value: 0, id: 'sylop1' },
  { name: 'Sylop', value: 0, id: 'sylop2' },
];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let v = 1; v <= 10; v++) {
      // Positive cards
      deck.push({ name: `${suit} ${v}`, value: v, suit, id: `${suit}+${v}` });
      // Negative cards
      deck.push({ name: `${suit} -${v}`, value: -v, suit, id: `${suit}-${v}` });
    }
  }
  for (const s of SPECIAL_CARDS) {
    deck.push({ ...s });
  }
  return deck;
}

function shuffle(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function handTotal(hand) {
  return hand.reduce((s, c) => s + c.value, 0);
}

function handDisplay(hand) {
  return hand.map(c => `\`${c.name}\``).join(' ');
}

function scoreHand(hand) {
  const total = handTotal(hand);
  const isPureSabacc = hand.length === 2 && hand.every(c => c.id?.startsWith('sylop'));
  return { total, isPureSabacc, cards: hand.length };
}

function compareHands(handA, handB) {
  const a = scoreHand(handA);
  const b = scoreHand(handB);
  if (a.isPureSabacc && !b.isPureSabacc) return 1;  // A wins
  if (!a.isPureSabacc && b.isPureSabacc) return -1; // B wins
  if (Math.abs(a.total) < Math.abs(b.total)) return 1;
  if (Math.abs(a.total) > Math.abs(b.total)) return -1;
  // Tie-break: fewer cards
  if (a.cards < b.cards) return 1;
  if (a.cards > b.cards) return -1;
  return 0; // Exact tie
}

// Active games: Map<channelId, GameState>
const games = new Map();

function getGame(channelId) {
  return games.get(channelId) || null;
}

function startGame(channelId, hostId, hostName, bet = 100) {
  if (games.has(channelId)) return null;
  const deck = shuffle(buildDeck());
  const state = {
    channelId,
    bet,
    pot: 0,
    deck,
    discardPile: [],
    players: [],
    hostId,
    phase: 'joining', // joining → betting → playing → showdown
    currentTurn: 0,
    round: 1,
    maxRounds: 3,
    jeopardyRoll: false,
  };
  // Add host immediately
  addPlayer(state, hostId, hostName);
  games.set(channelId, state);
  return state;
}

function addPlayer(state, userId, username) {
  if (state.players.find(p => p.id === userId)) return false;
  if (state.phase !== 'joining') return false;
  state.players.push({
    id: userId,
    username,
    hand: [],
    credits: 1000,
    bet: 0,
    folded: false,
    standing: false,
  });
  return true;
}

function dealInitialCards(state) {
  for (const player of state.players) {
    player.hand = [state.deck.pop(), state.deck.pop()];
    player.bet = state.bet;
    player.credits -= state.bet;
    state.pot += state.bet;
  }
  state.phase = 'playing';
  state.currentTurn = 0;
}

function drawFromDeck(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || state.deck.length === 0) return null;
  const card = state.deck.pop();
  player.hand.push(card);
  return card;
}

function drawFromDiscard(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || state.discardPile.length === 0) return null;
  const card = state.discardPile.pop();
  player.hand.push(card);
  return card;
}

function discardCard(state, playerId, cardIndex) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || cardIndex < 0 || cardIndex >= player.hand.length) return null;
  const [card] = player.hand.splice(cardIndex, 1);
  state.discardPile.push(card);
  return card;
}

function standPlayer(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  player.standing = true;
  return true;
}

function foldPlayer(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return false;
  player.folded = true;
  return true;
}

function getCurrentPlayer(state) {
  const active = state.players.filter(p => !p.folded && !p.standing);
  if (active.length === 0) return null;
  return state.players[state.currentTurn % state.players.length];
}

function advanceTurn(state) {
  const total = state.players.length;
  let tries = 0;
  do {
    state.currentTurn = (state.currentTurn + 1) % total;
    tries++;
    if (tries > total) return false; // All done
  } while (state.players[state.currentTurn].folded || state.players[state.currentTurn].standing);
  return true;
}

function isRoundOver(state) {
  return state.players.every(p => p.folded || p.standing);
}

function resolveGame(state) {
  const active = state.players.filter(p => !p.folded);
  if (active.length === 0) return { winners: [], pot: state.pot };

  // Find best hand
  let best = active[0];
  let winners = [best];
  for (let i = 1; i < active.length; i++) {
    const result = compareHands(active[i].hand, best.hand);
    if (result === 1) { best = active[i]; winners = [active[i]]; }
    else if (result === 0) { winners.push(active[i]); }
  }

  // Check for Jeopardy (busted = over 23 or under -23? No — in Corellian Spike, bomb out = exactly ±23... actually nannies = over with 23 total)
  // Simpler: if winner total is not 0, everyone pays Jeopardy (they owe extra if sum ≠ 0)
  const winnerScore = scoreHand(winners[0].hand);
  const perWinner = Math.floor(state.pot / winners.length);
  winners.forEach(w => { w.credits += perWinner; });

  state.phase = 'ended';
  return { winners, pot: state.pot, winnerScore };
}

function endGame(channelId) {
  games.delete(channelId);
}

function formatGameState(state, forPlayerId = null) {
  const lines = [];
  lines.push(`**🃏 SABACC — Round ${state.round}/${state.maxRounds}**`);
  lines.push(`💰 Pot: **${state.pot} credits**  |  Phase: **${state.phase}**`);
  lines.push('');

  for (const p of state.players) {
    const status = p.folded ? '🏳️ folded' : p.standing ? '🛑 standing' : '🎮 active';
    if (forPlayerId && p.id === forPlayerId) {
      const total = handTotal(p.hand);
      lines.push(`${status} **${p.username}** — Hand: ${handDisplay(p.hand)} = **${total}**  |  ${p.credits} credits`);
    } else {
      lines.push(`${status} **${p.username}** — 🂠 ${p.hand.length} cards  |  ${p.credits} credits`);
    }
  }

  if (state.discardPile.length > 0) {
    const top = state.discardPile[state.discardPile.length - 1];
    lines.push(`\n🗑️ Discard top: \`${top.name}\``);
  }

  return lines.join('\n');
}

module.exports = {
  startGame, addPlayer, dealInitialCards,
  drawFromDeck, drawFromDiscard, discardCard,
  standPlayer, foldPlayer, advanceTurn,
  getCurrentPlayer, isRoundOver, resolveGame,
  endGame, getGame, formatGameState,
  handTotal, handDisplay, scoreHand,
};
