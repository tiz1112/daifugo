/* ============================================================
   main.js — 対局の進行役

   rules.js（ルール）・ai.js（思考）・ui.js（画面）をつなぐ。
   誰の番か、場が流れたか、といった進行の管理をここで行う。
============================================================ */

const TITLES = ['大富豪', '富豪', '貧民', '大貧民'];
const POINTS = [4, 3, 2, 1];
const TOTAL_ROUNDS = 3;

const Game = {
    players: [],
    field: { cards: [], play: null, lockSuits: null },
    state: { revolution: false, eleven: false },
    turn: 0,
    passes: 0,
    finished: [],          // 上がった順に席番号が入る
    round: 1,
    picked: new Set(),     // 自分が選んでいる札
    busy: false,           // CPU が考えている間は操作を止める
    lastTitles: null,      // 前局の順位（カード交換に使う）

    /* --------------------------------------------------------
       起動
    -------------------------------------------------------- */
    init() {
        UI.init();

        this.players = [
            { name: 'あなた', title: '', hand: [], points: 0, rank: 0, kind: null },
            { name: PERSONALITIES.steady.title, title: PERSONALITIES.steady.name, hand: [], points: 0, rank: 0, kind: 'steady' },
            { name: PERSONALITIES.bold.title, title: PERSONALITIES.bold.name, hand: [], points: 0, rank: 0, kind: 'bold' },
            { name: PERSONALITIES.sharp.title, title: PERSONALITIES.sharp.name, hand: [], points: 0, rank: 0, kind: 'sharp' }
        ];

        UI.onPick = (id) => this.togglePick(id);
        UI.onPlay = () => this.playPicked();

        UI.el.playBtn.addEventListener('click', () => this.playPicked());
        UI.el.passBtn.addEventListener('click', () => this.pass());
        UI.el.sortBtn.addEventListener('click', () => this.sortHand());
        UI.el.startBtn.addEventListener('click', () => { UI.hideStart(); this.startRound(); });
        UI.el.nextRoundBtn.addEventListener('click', () => this.nextRound());
        UI.el.exchangeOkBtn.addEventListener('click', () => { UI.hideExchange(); this.beginPlay(); });

        // 画面の向きが変わったら、手札を並べ直す
        window.addEventListener('resize', () => this.refreshHand());
    },

    /* --------------------------------------------------------
       1局の開始
    -------------------------------------------------------- */
    startRound() {
        const hands = deal(4);
        this.players.forEach((p, i) => {
            p.hand = hands[i];
            p.rank = 0;
        });

        this.field = { cards: [], play: null, lockSuits: null, owner: null };
        this.state = { revolution: false, eleven: false };
        this.finished = [];
        this.passes = 0;
        this.picked.clear();

        UI.setRound(this.round);
        UI.renderSeats(this.players);
        UI.renderField([], '');
        UI.setBadges(this.state, null);
        UI.setMyTitle(this.lastTitles ? TITLES[this.lastTitles.indexOf(0)] : '平民');

        // 2局目からはカード交換がある
        if (this.lastTitles) {
            this.doExchange();
        } else {
            this.beginPlay();
        }
    },

    /* --------------------------------------------------------
       カード交換
       大貧民→大富豪に強い2枚、大富豪→大貧民に好きな2枚
       （CPU の手は自動で決める）
    -------------------------------------------------------- */
    doExchange() {
        const order = this.lastTitles;
        const rich = order[0], poor = order[3];
        const rich2 = order[1], poor2 = order[2];

        const swap = (fromIdx, toIdx, cards) => {
            const ids = new Set(cards.map(c => c.id));
            this.players[fromIdx].hand = this.players[fromIdx].hand.filter(c => !ids.has(c.id));
            this.players[toIdx].hand.push(...cards);
        };

        // 大貧民 → 大富豪（強い2枚を渡す）
        const up2 = strongest(this.players[poor].hand, 2);
        // 富豪 ↔ 貧民（1枚）
        const up1 = strongest(this.players[poor2].hand, 1);
        // 大富豪 → 大貧民（弱い2枚を渡す）
        const down2 = weakest(this.players[rich].hand, 2);
        const down1 = weakest(this.players[rich2].hand, 1);

        swap(poor, rich, up2);
        swap(rich, poor, down2);
        swap(poor2, rich2, up1);
        swap(rich2, poor2, down1);

        this.players.forEach(p => p.hand.sort((a, b) => strength(a) - strength(b)));

        // 自分が関わる交換だけ画面で知らせる
        let text = null, show = [];
        if (rich === 0) {
            text = `大富豪のあなたに、大貧民から強い2枚が渡されました。<br>代わりに弱い2枚を渡します。`;
            show = up2;
        } else if (poor === 0) {
            text = `大貧民のあなたは、強い2枚を大富豪に渡しました。<br>代わりに受け取った2枚です。`;
            show = down2;
        } else if (rich2 === 0) {
            text = `富豪のあなたに、貧民から1枚が渡されました。`;
            show = up1;
        } else if (poor2 === 0) {
            text = `貧民のあなたは1枚を渡し、代わりに1枚を受け取りました。`;
            show = down1;
        }

        if (text) {
            UI.showExchange(text, show);
        } else {
            this.beginPlay();
        }
    },

    /** 最初の手番を決めて、進行を始める */
    beginPlay() {
        // 2局目以降は大貧民から。初回はダイヤの3を持つ人から
        if (this.lastTitles) {
            this.turn = this.lastTitles[3];
        } else {
            this.turn = this.players.findIndex(p =>
                p.hand.some(c => c.suit === 'd' && c.rank === 3));
            if (this.turn < 0) this.turn = 0;
        }

        this.refreshAll();
        this.step();
    },

    /* --------------------------------------------------------
       進行
    -------------------------------------------------------- */
    async step() {
        // 3人上がったら終了
        if (this.finished.length >= 3) {
            this.endRound();
            return;
        }

        // 上がった人は飛ばす
        if (this.players[this.turn].hand.length === 0) {
            this.turn = (this.turn + 1) % 4;
            return this.step();
        }

        if (this.turn === 0) {
            // 自分の番。操作を待つ
            // （出せる札の明暗を正しく出すため、先に busy を解除してから描く）
            this.busy = false;
            this.refreshAll();

            const options = enumeratePlays(this.players[0].hand, this.field, this.state);
            if (options.length === 0) {
                UI.setHint('出せる札がありません。パスしてください。', true);
                UI.setButtons({ play: false, pass: true, sort: true });
            } else {
                UI.setHint(this.field.play ? '札を選んで、上へスワイプ' : '親番です。好きな札から');
                UI.setButtons({ play: this.picked.size > 0, pass: !!this.field.play, sort: true });
            }
            return;
        }

        // CPU の番
        this.busy = true;
        this.refreshAll();
        UI.setButtons({ play: false, pass: false, sort: false });
        UI.setHint(`${this.players[this.turn].name} が考えています…`);

        await wait(700 + Math.random() * 500);

        const me = this.players[this.turn];
        const others = this.players
            .map((p, i) => (i === this.turn || p.hand.length === 0) ? null : p.hand.length)
            .filter(n => n !== null);

        const pick = choosePlay(me.hand, this.field, this.state,
            { othersCounts: others.length ? others : [99], isLeader: !this.field.play },
            me.kind);

        if (!pick) {
            UI.flashSeat(this.turn, 'パス', 'pass');
            await wait(420);
            this.doPass();
        } else {
            UI.flashSeat(this.turn, '出す', 'play');
            await wait(320);
            this.commit(this.turn, pick.cards, pick.play);
        }
    },

    /* --------------------------------------------------------
       札を出す（共通処理）
    -------------------------------------------------------- */
    commit(playerIndex, cards, play) {
        const p = this.players[playerIndex];
        const ids = new Set(cards.map(c => c.id));
        p.hand = p.hand.filter(c => !ids.has(c.id));

        const notes = [];

        // 革命
        if (isRevolution(play)) {
            this.state.revolution = !this.state.revolution;
            notes.push(this.state.revolution ? '革命' : '革命返し');
        }

        // 縛り
        const lock = nextLockSuits(this.field.play, play, this.field.lockSuits);
        if (lock && !this.field.lockSuits) notes.push('縛り');

        const eightCut = isEightCut(cards);
        if (eightCut) notes.push('8切り');

        if (isElevenBack(cards) && !eightCut) {
            this.state.eleven = true;
            notes.push('11バック');
        }

        // 上がったかどうか
        if (p.hand.length === 0) {
            this.finished.push(playerIndex);
            p.rank = this.finished.length;
            notes.push(`${TITLES[this.finished.length - 1]}！`);
        }

        UI.renderField(cards, notes.join(' ・ '));
        this.passes = 0;

        if (eightCut) {
            // 場が流れて、出した人がそのまま親
            this.field = { cards: [], play: null, lockSuits: null, owner: null };
            this.state.eleven = false;
            setTimeout(() => {
                UI.renderField([], '場が流れました');
                if (p.hand.length === 0) {
                    this.turn = (playerIndex + 1) % 4;
                }
                this.step();
            }, 900);
            return;
        }

        this.field = { cards, play, lockSuits: lock, owner: playerIndex };
        this.turn = (playerIndex + 1) % 4;
        setTimeout(() => this.step(), 420);
    },

    /* --------------------------------------------------------
       パス
    -------------------------------------------------------- */
    doPass() {
        this.passes++;
        const alive = this.players.filter(p => p.hand.length > 0).length;

        // 自分以外の全員がパスしたら場が流れる
        if (this.passes >= alive - 1) {
            const owner = this.field.owner;
            this.field = { cards: [], play: null, lockSuits: null, owner: null };
            this.state.eleven = false;
            this.passes = 0;
            UI.renderField([], '場が流れました');

            // 最後に札を出した人が、そのまま親になる
            if (owner != null && this.players[owner].hand.length > 0) {
                this.turn = owner;
            } else {
                this.turn = (this.turn + 1) % 4;
            }
            setTimeout(() => this.step(), 300);
            return;
        }

        this.turn = (this.turn + 1) % 4;
        setTimeout(() => this.step(), 300);
    },

    pass() {
        if (this.busy || this.turn !== 0) return;
        if (!this.field.play) {
            UI.setHint('親番はパスできません', true);
            return;
        }
        this.picked.clear();
        UI.flashSeat(0, 'パス', 'pass');
        this.doPass();
    },

    /* --------------------------------------------------------
       自分の操作
    -------------------------------------------------------- */
    togglePick(id) {
        if (this.busy || this.turn !== 0) return;

        if (this.picked.has(id)) this.picked.delete(id);
        else this.picked.add(id);

        this.refreshHand();

        // 選んだ組み合わせが出せるかを、その場で知らせる
        const cards = this.selectedCards();
        if (cards.length === 0) {
            UI.setHint(this.field.play ? '札を選んで、上へスワイプ' : '親番です。好きな札から');
            UI.setButtons({ play: false, pass: !!this.field.play, sort: true });
            return;
        }

        const r = canPlay(cards, this.field, this.state);
        if (r.ok) {
            UI.setHint(`${cards.length}枚 — 上へスワイプで出す`);
            UI.setButtons({ play: true, pass: !!this.field.play, sort: true });
        } else {
            UI.setHint(r.reason, true);
            UI.setButtons({ play: false, pass: !!this.field.play, sort: true });
        }
    },

    selectedCards() {
        return this.players[0].hand.filter(c => this.picked.has(c.id));
    },

    playPicked() {
        if (this.busy || this.turn !== 0) return;

        const cards = this.selectedCards();
        if (cards.length === 0) return;

        const r = canPlay(cards, this.field, this.state);
        if (!r.ok) {
            UI.setHint(r.reason, true);
            return;
        }

        this.picked.clear();
        this.commit(0, cards, r.play);
    },

    /** 並べ替え：数字順とマーク順を交互に切り替える */
    sortHand() {
        if (this.busy) return;
        this.sortBySuit = !this.sortBySuit;

        if (this.sortBySuit) {
            const order = { s: 0, h: 1, d: 2, c: 3, x: 4 };
            this.players[0].hand.sort((a, b) =>
                order[a.suit] - order[b.suit] || strength(a) - strength(b));
        } else {
            this.players[0].hand.sort((a, b) => strength(a) - strength(b));
        }

        this.refreshHand();
    },

    /* --------------------------------------------------------
       画面の更新
    -------------------------------------------------------- */
    refreshAll() {
        for (let i = 1; i < 4; i++) {
            UI.updateSeat(i, this.players[i], this.turn === i && !this.players[i].rank);
        }
        UI.setBadges(this.state, this.field.lockSuits);
        this.refreshHand();
    },

    refreshHand() {
        // いま出せる札だけを明るくする
        let playableIds = null;
        if (this.turn === 0 && !this.busy) {
            const options = enumeratePlays(this.players[0].hand, this.field, this.state);
            playableIds = new Set();
            for (const o of options) {
                for (const c of o.cards) playableIds.add(c.id);
            }
        }
        UI.renderHand(this.players[0].hand, this.picked, playableIds);
    },

    /* --------------------------------------------------------
       局の終わり
    -------------------------------------------------------- */
    endRound() {
        // 残った1人を最下位にする
        for (let i = 0; i < 4; i++) {
            if (!this.finished.includes(i)) {
                this.finished.push(i);
                this.players[i].rank = 4;
            }
        }

        this.finished.forEach((p, rank) => {
            this.players[p].points += POINTS[rank];
        });

        this.lastTitles = [...this.finished];

        UI.setHint('');
        UI.setButtons({ play: false, pass: false, sort: false });
        UI.showResult(this.players, this.finished, TITLES);

        // 最終局なら表示を変える
        if (this.round >= TOTAL_ROUNDS) {
            UI.el.resultSub.textContent = '総合成績';
            const best = this.players.reduce((a, b) => b.points > a.points ? b : a);
            UI.el.resultTitle.textContent = best === this.players[0] ? 'あなたの勝ち' : `${best.name} の勝ち`;
            UI.el.nextRoundBtn.textContent = 'もう一度';
        }
    },

    nextRound() {
        UI.hideResult();

        if (this.round >= TOTAL_ROUNDS) {
            this.round = 1;
            this.lastTitles = null;
            this.players.forEach(p => p.points = 0);
            UI.el.nextRoundBtn.textContent = '次の局へ';
        } else {
            this.round++;
        }

        this.startRound();
    }
};

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

document.addEventListener('DOMContentLoaded', () => Game.init());
