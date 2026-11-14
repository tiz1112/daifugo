/* ============================================================
   rules.js — 大富豪のルールそのもの

   画面にも思考にも触れない。「その手は出せるのか」だけを判定する。

   カードの持ち方
     { suit: 's'|'h'|'d'|'c'|'x', rank: 1..13, id: '...' }
     suit 'x' はジョーカー（rank は 0）

   強さの順
     3 < 4 < ... < 13(K) < 1(A) < 2 < ジョーカー
     内部では「強さ」に変換して比べる（下の strength）
============================================================ */

const SUITS = ['s', 'h', 'd', 'c'];
const JOKER = 'x';

/* ------------------------------------------------------------
   山札を作る（52枚 + ジョーカー2枚）
------------------------------------------------------------ */
function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (let rank = 1; rank <= 13; rank++) {
            deck.push({ suit, rank, id: `${suit}${rank}` });
        }
    }
    deck.push({ suit: JOKER, rank: 0, id: 'x1' });
    deck.push({ suit: JOKER, rank: 0, id: 'x2' });
    return deck;
}

function shuffle(cards) {
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

/** 4人に配る。52+2=54枚なので、2人が14枚、2人が13枚になる */
function deal(playerCount = 4) {
    const deck = shuffle(buildDeck());
    const hands = Array.from({ length: playerCount }, () => []);
    deck.forEach((card, i) => hands[i % playerCount].push(card));
    hands.forEach(h => h.sort((a, b) => strength(a) - strength(b)));
    return hands;
}

/* ------------------------------------------------------------
   強さ

   3 を 1、4 を 2 … 2 を 13、ジョーカーを 99 とする。
   革命や11バックのときは、この値を反転させて比べる。
------------------------------------------------------------ */
function strength(card) {
    if (card.suit === JOKER) return 99;
    // 3→1, 4→2, ... 13→11, 1(A)→12, 2→13
    if (card.rank >= 3) return card.rank - 2;
    return card.rank + 11;          // A(1)→12, 2(2)→13
}

/** revert が true のとき、強さの上下を逆にする */
function effectiveStrength(card, revert) {
    const s = strength(card);
    if (s === 99) return 99;        // ジョーカーは常に最強（スペ3返しは別扱い）
    return revert ? 14 - s : s;
}

/* ------------------------------------------------------------
   手の種類を判定する

   返すのは次の形。出せない組み合わせなら null。
     { kind: 'single'|'pair'|'sequence',
       count: 枚数,
       rank: 代表のランク（階段なら一番弱いカード）,
       suits: [使ったマーク],
       jokers: ジョーカーの枚数 }
------------------------------------------------------------ */
function classify(cards) {
    if (!cards || cards.length === 0) return null;

    const jokers = cards.filter(c => c.suit === JOKER);
    const normals = cards.filter(c => c.suit !== JOKER);

    // ジョーカーだけ
    if (normals.length === 0) {
        return {
            kind: jokers.length === 1 ? 'single' : 'pair',
            count: jokers.length,
            rank: 0,
            suits: [],
            jokers: jokers.length
        };
    }

    // --- 同じ数字がそろっているか（1枚・ペア・3枚・4枚） ---
    const sameRank = normals.every(c => c.rank === normals[0].rank);
    if (sameRank) {
        return {
            kind: cards.length === 1 ? 'single' : 'pair',
            count: cards.length,
            rank: normals[0].rank,
            suits: normals.map(c => c.suit),
            jokers: jokers.length
        };
    }

    // --- 階段（同じマークの連番、3枚以上） ---
    if (cards.length < 3) return null;

    const suit = normals[0].suit;
    if (!normals.every(c => c.suit === suit)) return null;

    // ジョーカーを含めて連番にできるか試す
    const values = normals.map(c => strength(c)).sort((a, b) => a - b);
    if (new Set(values).size !== values.length) return null;    // 同じ数字が混ざっている

    const span = values[values.length - 1] - values[0] + 1;
    const gaps = span - values.length;

    // 隙間の数がジョーカーの枚数で埋まり、かつ全体の長さが合っていること
    if (span > cards.length) {
        if (gaps !== jokers.length) return null;
    } else if (span < cards.length) {
        // ジョーカーを端に足すぶんには構わない
        if (values.length + jokers.length !== cards.length) return null;
    }

    return {
        kind: 'sequence',
        count: cards.length,
        rank: values[0],            // 階段は一番弱いカードの強さで比べる
        suits: [suit],
        jokers: jokers.length
    };
}

/* ------------------------------------------------------------
   場の状態

   field = {
     cards: 直前に出された札,
     play : classify の結果,
     lockSuits : 縛りが効いているマーク（null なら縛りなし）
   }
   state = { revolution: bool, eleven: bool }
------------------------------------------------------------ */

/** 階段の強さを比べるとき、ジョーカーが端にいると値がずれるので補正する */
function sequenceLow(play) {
    return play.rank;
}

/**
 * その手を場に出せるかどうか。
 * 出せない理由を返したいので、{ ok, reason } の形にする。
 */
function canPlay(cards, field, state) {
    const play = classify(cards);
    if (!play) return { ok: false, reason: '組み合わせが正しくありません' };

    // 場が流れていれば何でも出せる
    if (!field || !field.play) return { ok: true, play };

    const f = field.play;

    // --- 種類と枚数が同じであること ---
    if (f.kind !== play.kind) return { ok: false, reason: '同じ種類を出してください' };
    if (f.count !== play.count) return { ok: false, reason: `${f.count}枚で出してください` };

    // --- スペ3返し：場がジョーカー1枚のとき、スペードの3だけが返せる ---
    const fieldIsSingleJoker = f.count === 1 && f.jokers === 1;
    if (fieldIsSingleJoker) {
        const isSpadeThree = cards.length === 1 && cards[0].suit === 's' && cards[0].rank === 3;
        if (isSpadeThree) return { ok: true, play, spadeThree: true };
        return { ok: false, reason: 'ジョーカーにはスペードの3しか返せません' };
    }

    // --- 縛り：マークがそろっていること ---
    if (field.lockSuits) {
        const ok = play.suits.every(s => field.lockSuits.includes(s));
        if (!ok) return { ok: false, reason: '縛りが効いています' };
    }

    // --- 強さ比べ ---
    const revert = state.revolution !== state.eleven;   // どちらか一方だけなら逆転

    if (play.kind === 'sequence') {
        const a = revert ? 14 - sequenceLow(play) : sequenceLow(play);
        const b = revert ? 14 - sequenceLow(f) : sequenceLow(f);
        if (a <= b) return { ok: false, reason: '場より強い手を出してください' };
    } else {
        const a = playStrength(play, revert);
        const b = playStrength(f, revert);
        if (a <= b) return { ok: false, reason: '場より強い手を出してください' };
    }

    return { ok: true, play };
}

/** 1枚・ペアの強さ。ジョーカーだけの手は最強 */
function playStrength(play, revert) {
    if (play.rank === 0) return 99;                     // ジョーカーのみ
    const s = strength({ suit: 's', rank: play.rank });
    return revert ? 14 - s : s;
}

/* ------------------------------------------------------------
   出したあとに起きること
------------------------------------------------------------ */

/** 8切り：8が含まれていれば場が流れる */
function isEightCut(cards) {
    return cards.some(c => c.suit !== JOKER && c.rank === 8);
}

/** 11バック：11が含まれていれば、場が流れるまで強さが逆転する */
function isElevenBack(cards) {
    return cards.some(c => c.suit !== JOKER && c.rank === 11);
}

/** 革命：同じ数字4枚、または階段5枚以上 */
function isRevolution(play) {
    if (play.kind === 'pair' && play.count >= 4) return true;
    if (play.kind === 'sequence' && play.count >= 5) return true;
    return false;
}

/**
 * 縛りの判定。
 * 直前の手と今の手で、マークの集合が完全に一致したら縛りが始まる。
 */
function nextLockSuits(prevPlay, play, currentLock) {
    if (currentLock) return currentLock;        // すでに縛られている
    if (!prevPlay) return null;
    if (play.jokers > 0 || prevPlay.jokers > 0) return null;   // ジョーカー入りは縛らない

    const a = [...prevPlay.suits].sort().join('');
    const b = [...play.suits].sort().join('');
    return a === b ? [...play.suits] : null;
}

/* ------------------------------------------------------------
   手札から「出せる手」を全部あげる
   CPU の思考と、プレイヤーの補助（出せる札を光らせる）に使う
------------------------------------------------------------ */
function enumeratePlays(hand, field, state) {
    const results = [];
    const n = hand.length;

    // --- 1枚 ---
    for (const c of hand) {
        const r = canPlay([c], field, state);
        if (r.ok) results.push({ cards: [c], play: r.play });
    }

    // --- 同じ数字の組（2枚以上） ---
    const byRank = {};
    for (const c of hand) {
        if (c.suit === JOKER) continue;
        (byRank[c.rank] = byRank[c.rank] || []).push(c);
    }
    const jokers = hand.filter(c => c.suit === JOKER);

    for (const rank of Object.keys(byRank)) {
        const group = byRank[rank];
        // ジョーカーを 0〜2枚混ぜた組み合わせを作る
        for (let use = 0; use <= jokers.length; use++) {
            for (let take = Math.max(1, 2 - use); take <= group.length; take++) {
                if (take + use < 2) continue;
                const cards = [...group.slice(0, take), ...jokers.slice(0, use)];
                const r = canPlay(cards, field, state);
                if (r.ok) results.push({ cards, play: r.play });
            }
        }
    }

    // --- ジョーカーだけの組 ---
    if (jokers.length >= 2) {
        const r = canPlay(jokers.slice(0, 2), field, state);
        if (r.ok) results.push({ cards: jokers.slice(0, 2), play: r.play });
    }

    // --- 階段 ---
    const bySuit = {};
    for (const c of hand) {
        if (c.suit === JOKER) continue;
        (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
    }

    for (const suit of Object.keys(bySuit)) {
        const list = bySuit[suit].slice().sort((a, b) => strength(a) - strength(b));
        for (let i = 0; i < list.length; i++) {
            for (let len = 3; len <= list.length - i + jokers.length; len++) {
                // 連続した部分を取り出し、足りない分をジョーカーで埋める
                for (let use = 0; use <= jokers.length; use++) {
                    const take = len - use;
                    if (take < 2 || i + take > list.length) continue;
                    const cards = [...list.slice(i, i + take), ...jokers.slice(0, use)];
                    if (cards.length !== len) continue;
                    const r = canPlay(cards, field, state);
                    if (r.ok) results.push({ cards, play: r.play });
                }
            }
        }
    }

    // 同じ組み合わせが重複しないようにする
    const seen = new Set();
    return results.filter(r => {
        const key = r.cards.map(c => c.id).sort().join(',');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/* ------------------------------------------------------------
   表示用
------------------------------------------------------------ */
const RANK_LABEL = {
    1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K'
};

function cardLabel(card) {
    return card.suit === JOKER ? 'JOKER' : RANK_LABEL[card.rank];
}

/* Node から読み込めるようにする（テスト用） */
if (typeof module !== 'undefined') {
    module.exports = {
        buildDeck, shuffle, deal, strength, effectiveStrength, classify,
        canPlay, isEightCut, isElevenBack, isRevolution, nextLockSuits,
        enumeratePlays, cardLabel, RANK_LABEL, SUITS, JOKER
    };
}
