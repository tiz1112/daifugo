/* ============================================================
   ai.js — CPU の思考

   3人それぞれ性格が違う。同じ手札でも選ぶ手が変わる。

     堅実 … 安い札から丁寧に減らす。強い札は最後まで抱える
     豪胆 … 枚数を多く出して一気に減らす。強い札も早めに切る
     読み … 他家の残り枚数を見て、上がられそうなら潰しにいく

   どの性格も「出せる手の一覧」から1つ選ぶだけ。
   ルールの判断は rules.js に任せている。
============================================================ */

const PERSONALITIES = {
    steady: {
        name: '堅実',
        title: '石橋 叩',
        desc: '安い札から確実に。強い札は最後まで握る'
    },
    bold: {
        name: '豪胆',
        title: '剛田 一気',
        desc: '枚数で押す。出し惜しみはしない'
    },
    sharp: {
        name: '読み',
        title: '冷泉 観月',
        desc: '場と残り枚数を読む。上がり際を潰す'
    }
};

/* ------------------------------------------------------------
   手の「もったいなさ」を点数にする

   ・強い札ほど高い（出すのがもったいない）
   ・ジョーカーはとくに高い
   ・2 や A も高め
------------------------------------------------------------ */
function handCost(cards) {
    let cost = 0;
    for (const c of cards) {
        if (c.suit === 'x') cost += 30;           // ジョーカー
        else if (c.rank === 2) cost += 18;
        else if (c.rank === 1) cost += 14;
        else if (c.rank === 8) cost += 12;        // 8切りは切り札なので惜しい
        else if (c.rank === 3) cost += 10;        // スペ3は返し札として惜しい
        else cost += strength(c);
    }
    return cost;
}

/** 残り手札の「手の多さ」。少ないほど上がりに近い */
function handFlexibility(hand) {
    const byRank = {};
    for (const c of hand) {
        if (c.suit === 'x') continue;
        byRank[c.rank] = (byRank[c.rank] || 0) + 1;
    }
    // ペア以上の組が多いほど、まとめて出せて有利
    return Object.values(byRank).filter(n => n >= 2).length;
}

/* ------------------------------------------------------------
   手を選ぶ

   hand      … 自分の手札
   field     … 場
   state     … { revolution, eleven }
   context   … { othersCounts: [他家の残り枚数], isLeader: 場を持っているか }
   kind      … 'steady' | 'bold' | 'sharp'

   返すのは { cards } か null（パス）
------------------------------------------------------------ */
function choosePlay(hand, field, state, context, kind) {
    const options = enumeratePlays(hand, field, state);
    if (options.length === 0) return null;

    // 上がれる手があるなら必ず出す（ただし反則上がりは避ける）
    const finishing = options.filter(o => o.cards.length === hand.length && !isFoulFinish(o.cards, state));
    if (finishing.length > 0) {
        return finishing.sort((a, b) => a.cards.length - b.cards.length)[0];
    }

    // 残り1枚になる手で、その1枚が最強クラスなら狙う
    const nearFinish = options.filter(o => hand.length - o.cards.length === 1);

    const scored = options.map(o => ({
        ...o,
        score: scorePlay(o, hand, field, state, context, kind)
    }));

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];

    // 場を持っていない（＝相手の手に重ねる）とき、
    // あまりにもったいない手しかなければパスする性格もある
    if (field && field.play && shouldPass(best, hand, field, state, context, kind)) {
        return null;
    }

    return best;
}

/** 反則上がり：8・2・ジョーカーで上がってはいけない */
function isFoulFinish(cards, state) {
    return cards.some(c =>
        c.suit === 'x' ||
        (c.suit !== 'x' && c.rank === 2) ||
        (c.suit !== 'x' && c.rank === 8)
    );
}

/* ------------------------------------------------------------
   手に点数を付ける。性格ごとに重みが違う
------------------------------------------------------------ */
function scorePlay(option, hand, field, state, context, kind) {
    const cards = option.cards;
    const cost = handCost(cards);
    const count = cards.length;

    // 出したあとに残る手札
    const ids = new Set(cards.map(c => c.id));
    const rest = hand.filter(c => !ids.has(c.id));

    let score = 0;

    // --- 共通：枚数を減らせるのは良いこと ---
    score += count * 10;

    // --- 共通：もったいない札を使うのはマイナス ---
    score -= cost * 0.8;

    // --- 共通：8切りで場を取れるのは価値がある ---
    const eightCut = cards.some(c => c.suit !== 'x' && c.rank === 8);
    if (eightCut) {
        // 相手が上がりそうなときほど、8切りの価値が上がる
        const danger = context.othersCounts.some(n => n <= 2);
        score += danger ? 40 : 6;
    }

    // --- 共通：残りがペアだらけになる手は良い ---
    score += handFlexibility(rest) * 4;

    switch (kind) {
        case 'steady':
            // 安い札から出したい。高い札を使う手は強く嫌う
            score -= cost * 1.2;
            // ジョーカーは本当に最後まで取っておく
            if (cards.some(c => c.suit === 'x')) score -= 60;
            // 1枚ずつ丁寧に
            score -= count * 3;
            break;

        case 'bold':
            // 枚数を多く出したい
            score += count * 18;
            // 強い札を切ることをあまり気にしない
            score += cost * 0.5;
            // 革命を狙える手があれば積極的に
            if (option.play.kind === 'pair' && option.play.count >= 4) score += 50;
            break;

        case 'sharp':
            // 誰かが上がりそうなら、場を取れる手を優先する
            const threat = Math.min(...context.othersCounts);
            if (threat <= 3) {
                score += count * 6;
                if (eightCut) score += 30;
                // 強い札を出してでも流れを止める
                score += cost * 0.4;
            } else {
                // 平時は手札の形を整える
                score -= cost * 0.6;
                score += handFlexibility(rest) * 8;
            }
            // 場が流れた直後（自分が親）なら、安い札で様子を見る
            if (!field || !field.play) score -= cost * 0.5;
            break;
    }

    return score;
}

/* ------------------------------------------------------------
   パスするかどうか
------------------------------------------------------------ */
function shouldPass(best, hand, field, state, context, kind) {
    const cost = handCost(best.cards);
    const threat = Math.min(...context.othersCounts);

    // 誰かがあと少しで上がるなら、多少もったいなくても出す
    if (threat <= 2) return false;

    switch (kind) {
        case 'steady':
            // 高い札を切ってまで取りに行かない
            return cost > 24 && hand.length > 4;
        case 'bold':
            // ほぼ出す
            return cost > 45 && hand.length > 8;
        case 'sharp':
            // 中盤までは温存、終盤は出す
            return cost > 30 && hand.length > 6;
        default:
            return false;
    }
}

/* ------------------------------------------------------------
   カード交換（大富豪→大貧民など）のとき、何を渡すか
------------------------------------------------------------ */

/** 強い順に n 枚（大富豪が渡す必要はないが、大貧民が渡す札） */
function strongest(hand, n) {
    return [...hand].sort((a, b) => strength(b) - strength(a)).slice(0, n);
}

/** 弱い順に n 枚（大富豪が渡す札） */
function weakest(hand, n) {
    return [...hand].sort((a, b) => strength(a) - strength(b)).slice(0, n);
}
