/**
 * PAZAAK GAME ENGINE
 * Based on the card game from Knights of the Old Republic (KOTOR)
 *
 * Rules:
 * - Main deck: cards 1-10, drawn randomly (infinite deck, just random 1-10)
 * - Each player has a side deck of 4 cards (chosen from their collection)
 * - Goal: Get exactly 20, or as close to 20 without going over
 * - If you go over 20, you BUST
 * - Players take turns; each turn you draw a main deck card (auto)
 *   then may play a side deck card, then must stand or end turn
 * - First to win 3 sets wins the match
 * - Special side cards: +/- combos (e.g., "+/-3"), tiebreaker cards, double cards
 */

// Card types for the side deck
const SIDE_DECK_OPTIONS = [
  { id: 's+1', display: '+1', value: 1, type: 'fixed' },
  { id: 's+2', display: '+2', value: 2, type: 'fixed' },
  { id: 's+3', display: '+3', value: 3, type: 'fixed' },
  { id: 's+4', display: '+4', value: 4, type: 'fixed' },
  { id: 's+5', display: '+5', value: 5, type: 'fixed' },
  { id: 's+6', display: '+6', value: 6, type: 'fixed' },
  { id: 's-1', display: '-1', value: -1, type: 'fixed' },
  { id: 's-2', display: '-2', value: -2, type: 'fixed' },
  { id: 's-3', display: '-3', value: -3, type: 'fixed' },
  { id: 's-4', display: '-4', value: -4, type: 'fixed' },
  { id: 's-5', display: '-5', value: -5, type: 'fixed' },
  { id: 's-6', display: '-6', value: -6, type: 'fixed' },
  { id: 'spm1', display: '+/-1', value: null, type: 'plusminus', range: 1 },
  { id: 'spm2', display: '+/-2', value: null, type: 'plusminus', range: 2 },
  { id: 'spm3', display: '+/-3', value: null, type: 'plusminus', range: 3 },
  { id: 'spm4', display: '+/-4', value: null, type: 'plusminus', range: 4 },
  { id: 'spm5', display: '+/-5', value: null, type: 'plusminus', range: 5 },
  { id: 'spm6', display: '+/-6', value: null, type: 'plusminus', range: 6 },
  { id: 'sdbl', display: '2x', value: null, type: 'double' },
  { id: 'sflip', display: 'Flip', value: null, type: 'flip' },
];

function drawMainCard() {
  return Math.floor(Math.random() * 10) + 1;
}

function buildDefaultSideDeck() {
  // Default side deck: two +/- pairs
  return [
    { ...SIDE_DECK_OPTIONS.find(c => c.id === 'spm3') },
    { ...SIDE_DECK_OPTIONS.find(c => c.id === 'spm4') },
    { ...SIDE_DECK_OPTIONS.find(c => c.id === 's+3') },
    { ...SIDE_DECK_OPTIONS.find(c => c.id === 's-2') },
  ];
}

function handTotal(cards) {
  return cards.reduce((s, c) => s + c, 0);
}

// Active games: Map<channelId, PazaakGame>
const games = new Map();

function getGame(channelId) {
  return games.get(channelId) || null;
}

function startGame(channelId, player1Id, player1Name, player2Id, player2Name) {
  if (games.has(channelId)) return null;

  const mkPlayer = (id, name) => ({
    id, name,
    sideDeck: buildDefaultSideDeck(),
    usedSideCards: [],
    tableCards: [],     // drawn main deck cards on table
    total: 0,
    standing: false,
    busted: false,
    setsWon: 0,
    pendingSideCard: null, // if a +/- card is played, waiting for choice
  });

  const state = {
    channelId,
    players: [mkPlayer(player1Id, player1Name), mkPlayer(player2Id, player2Name)],
    currentTurn: 0,   // index into players
    phase: 'draw',    // draw → sidecard → stand_or_end → next
    set: 1,
    maxSets: 3,
    winsNeeded: 2,
  };

  games.set(channelId, state);
  return state;
}

function getCurrentPlayer(state) {
  return state.players[state.currentTurn];
}

function getOpponent(state) {
  return state.players[1 - state.currentTurn];
}

// Auto-draw a main deck card for the current player
function drawCard(state) {
  const player = getCurrentPlayer(state);
  if (player.standing || player.busted) return null;
  const card = drawMainCard();
  player.tableCards.push(card);
  player.total = handTotal(player.tableCards);
  if (player.total > 20) {
    player.busted = true;
    state.phase = 'busted';
  } else {
    state.phase = 'action'; // can now play side card or stand/end
  }
  return card;
}

// Play a side card from the player's side deck
// cardIndex: index into sideDeck
// For +/- cards, `choice` should be '+' or '-'
function playSideCard(state, cardIndex, choice = null) {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'action') return { error: 'Not your action phase.' };
  if (cardIndex < 0 || cardIndex >= player.sideDeck.length) return { error: 'Invalid card index.' };

  const card = player.sideDeck[cardIndex];
  if (!card) return { error: 'Card not found.' };

  let delta = 0;

  if (card.type === 'fixed') {
    delta = card.value;
  } else if (card.type === 'plusminus') {
    if (!choice) return { error: `This is a +/-${card.range} card. Use choice '+' or '-'.` };
    delta = choice === '+' ? card.range : -card.range;
  } else if (card.type === 'double') {
    delta = player.total; // doubles current total
    player.total = player.total * 2;
    // Skip normal delta logic
    player.tableCards.push(`×2`);
    player.usedSideCards.push(card);
    player.sideDeck.splice(cardIndex, 1);
    if (player.total > 20) player.busted = true;
    state.phase = player.busted ? 'busted' : 'action';
    return { card, newTotal: player.total };
  } else if (card.type === 'flip') {
    // Flip: negate all table cards (experimental)
    player.tableCards = player.tableCards.map(c => typeof c === 'number' ? -c : c);
    player.total = handTotal(player.tableCards.filter(c => typeof c === 'number'));
    player.usedSideCards.push(card);
    player.sideDeck.splice(cardIndex, 1);
    state.phase = 'action';
    return { card, newTotal: player.total };
  }

  player.total += delta;
  player.tableCards.push(delta > 0 ? `+${delta}` : `${delta}`);
  player.usedSideCards.push(card);
  player.sideDeck.splice(cardIndex, 1);

  if (player.total > 20) player.busted = true;
  state.phase = player.busted ? 'busted' : 'action';

  return { card, delta, newTotal: player.total };
}

// Player stands (locks in their total for this set)
function standPlayer(state) {
  const player = getCurrentPlayer(state);
  player.standing = true;
  return advanceTurnOrEndSet(state);
}

// End turn without standing (draw next turn)
function endTurn(state) {
  return advanceTurnOrEndSet(state);
}

function advanceTurnOrEndSet(state) {
  const both = state.players;
  // If both players are done (standing or busted), resolve set
  const p0done = both[0].standing || both[0].busted;
  const p1done = both[1].standing || both[1].busted;

  if (p0done && p1done) {
    return resolveSet(state);
  }

  // Switch turn to the other player (if they're not done)
  state.currentTurn = 1 - state.currentTurn;
  const next = getCurrentPlayer(state);
  if (next.standing || next.busted) {
    // Other player is also done, resolve
    return resolveSet(state);
  }

  state.phase = 'draw';
  return { continued: true };
}

function resolveSet(state) {
  const [p0, p1] = state.players;
  let winner = null;

  if (p0.busted && p1.busted) {
    // Both busted: no winner this set
  } else if (p0.busted) {
    winner = p1;
  } else if (p1.busted) {
    winner = p0;
  } else {
    // Closest to 20
    if (p0.total === 20 && p1.total !== 20) winner = p0;
    else if (p1.total === 20 && p0.total !== 20) winner = p1;
    else if (p0.total > p1.total) winner = p0;
    else if (p1.total > p0.total) winner = p1;
    // Exact tie: no winner
  }

  if (winner) winner.setsWon++;

  const result = {
    setWinner: winner,
    p0Total: p0.total,
    p1Total: p1.total,
    matchOver: false,
    matchWinner: null,
  };

  // Check match winner
  if (p0.setsWon >= state.winsNeeded) {
    result.matchOver = true;
    result.matchWinner = p0;
    state.phase = 'ended';
  } else if (p1.setsWon >= state.winsNeeded) {
    result.matchOver = true;
    result.matchWinner = p1;
    state.phase = 'ended';
  } else {
    // Start new set
    state.set++;
    for (const p of state.players) {
      p.tableCards = [];
      p.total = 0;
      p.standing = false;
      p.busted = false;
      p.usedSideCards = [];
      // Side deck persists but already played cards are gone
    }
    state.currentTurn = 0;
    state.phase = 'draw';
    result.newSet = state.set;
  }

  return result;
}

function endGame(channelId) {
  games.delete(channelId);
}

function formatState(state, forPlayerId = null) {
  const lines = [];
  lines.push(`**🎴 PAZAAK — Set ${state.set}/${state.maxSets}**`);
  lines.push('');

  for (const p of state.players) {
    const isYou = p.id === forPlayerId;
    const status = p.busted ? '💥 BUSTED' : p.standing ? '🛑 Standing' : '🎮 Active';
    const tableStr = p.tableCards.length > 0
      ? p.tableCards.map(c => `\`${c}\``).join(' ') + ` = **${p.total}**`
      : '_no cards_';
    const sideStr = p.sideDeck.map((c, i) => `[${i + 1}] \`${c.display}\``).join(' ');
    lines.push(`${status} **${p.name}** (${p.setsWon} sets won)`);
    lines.push(`  Table: ${tableStr}`);
    if (isYou) lines.push(`  Side deck: ${sideStr || '_empty_'}`);
  }

  return lines.join('\n');
}

module.exports = {
  SIDE_DECK_OPTIONS,
  startGame, getGame, endGame,
  getCurrentPlayer, getOpponent,
  drawCard, playSideCard, standPlayer, endTurn,
  resolveSet, formatState,
};
