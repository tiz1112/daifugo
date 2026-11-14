const R = require('./rules.js');

let pass = 0, fail = 0;
function ck(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) pass++;
    else { fail++; console.log(`NG ${name}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`); }
}

// カードを短く書くための道具： c('s', 3) = スペードの3
const c = (suit, rank) => ({ suit, rank, id: `${suit}${rank}` });
const JK = (n = 1) => ({ suit: 'x', rank: 0, id: `x${n}` });
const noState = { revolution: false, eleven: false };
const free = { cards: [], play: null, lockSuits: null };

/* ===== 強さ ===== */
ck('3が最弱', R.strength(c('s', 3)), 1);
ck('2が最強', R.strength(c('s', 2)), 13);
ck('Aは2の次に強い', R.strength(c('s', 1)), 12);
ck('Kはその下', R.strength(c('s', 13)), 11);
ck('ジョーカー', R.strength(JK()), 99);

/* ===== 手の種類 ===== */
ck('1枚', R.classify([c('s', 5)]).kind, 'single');
ck('ペア', R.classify([c('s', 5), c('h', 5)]).kind, 'pair');
ck('3枚', R.classify([c('s', 5), c('h', 5), c('d', 5)]).count, 3);
ck('数字違いの2枚は出せない', R.classify([c('s', 5), c('h', 6)]), null);
ck('階段', R.classify([c('s', 5), c('s', 6), c('s', 7)]).kind, 'sequence');
ck('マーク違いの連番は階段ではない', R.classify([c('s', 5), c('h', 6), c('s', 7)]), null);
ck('2枚の連番は階段にならない', R.classify([c('s', 5), c('s', 6)]), null);
ck('ジョーカー入りペア', R.classify([c('s', 5), JK()]).kind, 'pair');
ck('ジョーカーで穴を埋めた階段', R.classify([c('s', 5), c('s', 7), JK()]).kind, 'sequence');
ck('飛びすぎた連番は階段にならない', R.classify([c('s', 5), c('s', 9), JK()]), null);

/* ===== 強さ比べ ===== */
let field = { cards: [c('s', 5)], play: R.classify([c('s', 5)]), lockSuits: null };
ck('強い札は出せる', R.canPlay([c('h', 7)], field, noState).ok, true);
ck('弱い札は出せない', R.canPlay([c('h', 4)], field, noState).ok, false);
ck('同じ強さは出せない', R.canPlay([c('h', 5)], field, noState).ok, false);
ck('枚数が違うと出せない', R.canPlay([c('h', 7), c('d', 7)], field, noState).ok, false);
ck('場が空なら何でも出せる', R.canPlay([c('h', 4)], free, noState).ok, true);

/* ===== 革命 ===== */
const rev = { revolution: true, eleven: false };
ck('革命中は弱い札が強い', R.canPlay([c('h', 4)], field, rev).ok, true);
ck('革命中は強い札が出せない', R.canPlay([c('h', 7)], field, rev).ok, false);
ck('4枚そろいは革命', R.isRevolution(R.classify([c('s', 5), c('h', 5), c('d', 5), c('c', 5)])), true);
ck('3枚は革命ではない', R.isRevolution(R.classify([c('s', 5), c('h', 5), c('d', 5)])), false);
ck('階段5枚は革命', R.isRevolution(R.classify([c('s', 4), c('s', 5), c('s', 6), c('s', 7), c('s', 8)])), true);
ck('階段4枚は革命ではない', R.isRevolution(R.classify([c('s', 4), c('s', 5), c('s', 6), c('s', 7)])), false);

/* ===== 11バック ===== */
const eleven = { revolution: false, eleven: true };
ck('11バック中は弱い札が強い', R.canPlay([c('h', 4)], field, eleven).ok, true);
ck('11を含むと11バック', R.isElevenBack([c('s', 11)]), true);
ck('11が無ければ起きない', R.isElevenBack([c('s', 10)]), false);

// 革命と11バックが重なると元に戻る
const both = { revolution: true, eleven: true };
ck('革命＋11バックで元どおり', R.canPlay([c('h', 7)], field, both).ok, true);
ck('革命＋11バックで弱い札は出せない', R.canPlay([c('h', 4)], field, both).ok, false);

/* ===== 8切り ===== */
ck('8を含めば場が流れる', R.isEightCut([c('s', 8)]), true);
ck('8が無ければ流れない', R.isEightCut([c('s', 7)]), false);
ck('ペアに8が混ざっていても流れる', R.isEightCut([c('s', 8), JK()]), true);

/* ===== スペ3返し ===== */
const jokerField = { cards: [JK()], play: R.classify([JK()]), lockSuits: null };
ck('スペ3で返せる', R.canPlay([c('s', 3)], jokerField, noState).ok, true);
ck('ハートの3では返せない', R.canPlay([c('h', 3)], jokerField, noState).ok, false);
ck('2でも返せない', R.canPlay([c('s', 2)], jokerField, noState).ok, false);

/* ===== 縛り ===== */
const prev = R.classify([c('s', 5)]);
const now = R.classify([c('s', 7)]);
ck('同じマークが続くと縛り', R.nextLockSuits(prev, now, null), ['s']);
ck('違うマークなら縛らない', R.nextLockSuits(prev, R.classify([c('h', 7)]), null), null);
ck('すでに縛られていれば維持', R.nextLockSuits(prev, now, ['h']), ['h']);
ck('ジョーカー入りは縛らない', R.nextLockSuits(prev, R.classify([JK()]), null), null);

const locked = { cards: [c('s', 7)], play: now, lockSuits: ['s'] };
ck('縛り中は同じマークだけ', R.canPlay([c('s', 9)], locked, noState).ok, true);
ck('縛り中に違うマークは出せない', R.canPlay([c('h', 9)], locked, noState).ok, false);

/* ===== 手札から出せる手を数える ===== */
const hand = [c('s', 3), c('s', 4), c('s', 5), c('h', 5), c('d', 9), JK()];
const plays = R.enumeratePlays(hand, free, noState);
ck('場が空なら手がたくさんある', plays.length > 5, true);
ck('同じ組み合わせは重複しない',
    plays.length, new Set(plays.map(p => p.cards.map(x => x.id).sort().join(','))).size);
// 5のペアが候補にあるか
ck('5のペアが見つかる',
    plays.some(p => p.cards.length === 2 && p.cards.every(x => x.rank === 5)), true);
// スペードの3-4-5の階段があるか
ck('階段が見つかる',
    plays.some(p => p.play.kind === 'sequence' && p.cards.length === 3), true);

// 場に7が出ているとき、出せる手だけが残る
const f7 = { cards: [c('h', 7)], play: R.classify([c('h', 7)]), lockSuits: null };
const plays2 = R.enumeratePlays(hand, f7, noState);
ck('7より強い1枚だけ', plays2.filter(p => p.cards.length === 1).map(p => R.cardLabel(p.cards[0])).sort(),
    ['9', 'JOKER']);

/* ===== 配る ===== */
const hands = R.deal(4);
ck('4人に配る', hands.length, 4);
ck('合計54枚', hands.reduce((s, h) => s + h.length, 0), 54);
ck('重複なし', new Set(hands.flat().map(x => x.id)).size, 54);
ck('14枚の人が2人', hands.filter(h => h.length === 14).length, 2);

/* ===== 1万回まわして落ちないか ===== */
let crash = 0;
for (let t = 0; t < 2000; t++) {
    const hs = R.deal(4);
    let fld = { cards: [], play: null, lockSuits: null };
    let st = { revolution: false, eleven: false };
    let turn = 0, pass2 = 0, guard = 0;

    while (hs.some(h => h.length > 0) && guard++ < 500) {
        const h = hs[turn];
        if (h.length === 0) { turn = (turn + 1) % 4; continue; }

        const opts = R.enumeratePlays(h, fld, st);
        if (opts.length === 0) {
            pass2++;
            if (pass2 >= 3) { fld = { cards: [], play: null, lockSuits: null }; st.eleven = false; pass2 = 0; }
            turn = (turn + 1) % 4;
            continue;
        }

        const pick = opts[Math.floor(Math.random() * opts.length)];
        const ids = new Set(pick.cards.map(x => x.id));
        hs[turn] = h.filter(x => !ids.has(x.id));

        if (R.isRevolution(pick.play)) st.revolution = !st.revolution;
        const lock = R.nextLockSuits(fld.play, pick.play, fld.lockSuits);

        if (R.isEightCut(pick.cards)) {
            fld = { cards: [], play: null, lockSuits: null };
            st.eleven = false;
        } else {
            if (R.isElevenBack(pick.cards)) st.eleven = true;
            fld = { cards: pick.cards, play: pick.play, lockSuits: lock };
        }
        pass2 = 0;
        turn = (turn + 1) % 4;
    }
    if (guard >= 500) crash++;
}
ck('2000局まわして詰まらない', crash, 0);

console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
