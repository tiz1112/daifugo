/* ============================================================
   ui.js — 画面を描く係

   rules.js と ai.js が出した結果を、見た目に変える。
   タップとスワイプの受け取りもここで行う。
============================================================ */

const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR = { s: 'black', h: 'red', d: 'red', c: 'black' };

const UI = {
    el: {},
    onPlay: null,       // スワイプ／出すボタンで呼ばれる
    onPick: null,       // 札をタップしたとき

    init() {
        const ids = [
            'roundNum', 'badgeRevolution', 'badgeEleven', 'badgeLock',
            'seats', 'fieldTray', 'fieldMsg',
            'myTitle', 'myCount', 'hand', 'swipeGuide',
            'sortBtn', 'passBtn', 'playBtn', 'hint',
            'resultOverlay', 'resultSub', 'resultTitle', 'rankList', 'nextRoundBtn',
            'exchangeOverlay', 'exchangeText', 'exchangeCards', 'exchangeOkBtn',
            'startOverlay', 'startBtn'
        ];
        ids.forEach(id => this.el[id] = document.getElementById(id));
        this.bindSwipe();
    },

    /* --------------------------------------------------------
       カードを1枚作る
    -------------------------------------------------------- */
    createCard(card) {
        const el = document.createElement('div');

        if (card.suit === 'x') {
            el.className = 'card joker';
            // 左上の角だけで判別できるようにする（重ねて並べても見えるため）
            el.innerHTML =
                '<span class="corner"><b>JO</b><i>KER</i></span>' +
                '<span class="big">★</span>';
        } else {
            el.className = `card ${SUIT_COLOR[card.suit]}`;
            el.innerHTML =
                `<span class="corner"><b>${RANK_LABEL[card.rank]}</b><i>${SUIT_MARK[card.suit]}</i></span>` +
                `<span class="big">${SUIT_MARK[card.suit]}</span>`;
        }

        el.dataset.id = card.id;
        return el;
    },

    /* --------------------------------------------------------
       CPU3人の席
    -------------------------------------------------------- */
    renderSeats(players) {
        this.el.seats.innerHTML = '';
        // 自分（0番）以外を並べる
        for (let i = 1; i < players.length; i++) {
            const p = players[i];
            const seat = document.createElement('div');
            seat.className = 'seat';
            seat.id = 'seat-' + i;
            seat.innerHTML =
                `<div class="seat-title">${p.title}</div>` +
                `<div class="seat-name">${p.name}</div>` +
                `<div class="seat-count"><b>${p.hand.length}</b>枚</div>` +
                `<div class="seat-act"></div>`;
            this.el.seats.appendChild(seat);
        }
    },

    updateSeat(index, player, isActive) {
        const seat = document.getElementById('seat-' + index);
        if (!seat) return;

        seat.querySelector('.seat-count').innerHTML = `<b>${player.hand.length}</b>枚`;
        seat.classList.toggle('active', isActive);
        seat.classList.toggle('danger', player.hand.length > 0 && player.hand.length <= 3);
        seat.classList.toggle('finished', player.hand.length === 0);

        if (player.rank) {
            seat.dataset.rank = player.rank;
        }
    },

    /** CPU が出した・パスしたことを一瞬だけ見せる */
    flashSeat(index, text, type) {
        const seat = document.getElementById('seat-' + index);
        if (!seat) return;
        const act = seat.querySelector('.seat-act');
        act.textContent = text;
        act.className = 'seat-act ' + type;
        void act.offsetWidth;                  // アニメーションをやり直させる
        act.classList.add('show');
    },

    /* --------------------------------------------------------
       場
    -------------------------------------------------------- */
    renderField(cards, message) {
        this.el.fieldTray.innerHTML = '';
        if (cards && cards.length) {
            for (const c of cards) {
                const el = this.createCard(c);
                el.classList.add('in');
                this.el.fieldTray.appendChild(el);
            }
        }
        this.el.fieldMsg.textContent = message || '';
    },

    /* --------------------------------------------------------
       自分の手札

       枚数が多いときは重ねて並べる。
       画面幅に収まるよう、重ね幅を計算する。
    -------------------------------------------------------- */
    renderHand(hand, picked, playableIds) {
        const box = this.el.hand;
        box.innerHTML = '';
        if (hand.length === 0) {
            this.el.myCount.textContent = 0;
            return;
        }

        const cardW = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue('--card-w'));
        const available = box.clientWidth - 6;

        // 全部を横に並べたとき、1枚あたり何ピクセルずらすか。
        // 画面に収まらないときは重ねるが、角（数字とマーク）は必ず見えるようにする
        let step = cardW + 3;
        if (hand.length > 1) {
            const needed = cardW + (hand.length - 1) * step;
            if (needed > available) {
                step = Math.max(18, (available - cardW) / (hand.length - 1));
            }
        }

        hand.forEach((card, i) => {
            // 当たり判定を「見えている幅」に合わせるため、
            // 枠（slot）を step の幅にして、その中にカードを置く。
            // こうしないと、手前の札が隣の札のタップを奪ってしまう
            const slot = document.createElement('div');
            slot.className = 'slot';
            slot.style.width = (i === hand.length - 1 ? cardW : step) + 'px';
            slot.style.zIndex = i;

            const el = this.createCard(card);
            if (picked.has(card.id)) slot.classList.add('picked');
            if (playableIds && !playableIds.has(card.id)) slot.classList.add('dim');

            slot.appendChild(el);
            slot.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onPick) this.onPick(card.id);
            });

            box.appendChild(slot);
        });

        this.el.myCount.textContent = hand.length;
        this.el.swipeGuide.classList.toggle('show', picked.size > 0);
    },

    /* --------------------------------------------------------
       上へスワイプしたら出す
    -------------------------------------------------------- */
    bindSwipe() {
        const wrap = this.el.hand.parentElement;
        let startY = null, startX = null, moved = false;

        const start = (y, x) => { startY = y; startX = x; moved = false; };

        const move = (y, x) => {
            if (startY === null) return;
            const dy = startY - y;
            const dx = Math.abs(startX - x);
            if (dy > 10 && dy > dx) moved = true;
        };

        const end = (y) => {
            if (startY === null) return;
            const dy = startY - y;
            startY = null;
            // 上に40px以上動かしたら「出す」
            if (moved && dy > 40 && this.onPlay) this.onPlay();
        };

        wrap.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            start(t.clientY, t.clientX);
        }, { passive: true });

        wrap.addEventListener('touchmove', (e) => {
            const t = e.touches[0];
            move(t.clientY, t.clientX);
        }, { passive: true });

        wrap.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            end(t.clientY);
        });

        // パソコンでも試せるようにマウスにも対応
        wrap.addEventListener('mousedown', (e) => start(e.clientY, e.clientX));
        wrap.addEventListener('mousemove', (e) => move(e.clientY, e.clientX));
        wrap.addEventListener('mouseup', (e) => end(e.clientY));
        wrap.addEventListener('mouseleave', () => { startY = null; });
    },

    /* --------------------------------------------------------
       状態の表示
    -------------------------------------------------------- */
    setBadges(state, lock) {
        this.el.badgeRevolution.classList.toggle('on', state.revolution);
        this.el.badgeEleven.classList.toggle('on', state.eleven);
        this.el.badgeLock.classList.toggle('on', !!lock);
    },

    setRound(n) {
        this.el.roundNum.textContent = n;
    },

    setMyTitle(title) {
        this.el.myTitle.textContent = title;
    },

    setHint(text, warn) {
        this.el.hint.textContent = text || '';
        this.el.hint.classList.toggle('warn', !!warn);
    },

    setButtons({ play, pass, sort }) {
        this.el.playBtn.disabled = !play;
        this.el.passBtn.disabled = !pass;
        this.el.sortBtn.disabled = !sort;
    },

    /* --------------------------------------------------------
       かぶせ画面
    -------------------------------------------------------- */
    showResult(players, order, titles) {
        this.el.resultSub.textContent = '対局終了';
        this.el.resultTitle.textContent = titles[order.indexOf(0)] || '';

        this.el.rankList.innerHTML = '';
        order.forEach((playerIndex, rank) => {
            const p = players[playerIndex];
            const li = document.createElement('li');
            if (playerIndex === 0) li.classList.add('me');
            li.innerHTML =
                `<span class="rank-title">${titles[rank]}</span>` +
                `<span class="rank-name">${p.name}</span>` +
                `<span class="rank-pt">${p.points} pt</span>`;
            this.el.rankList.appendChild(li);
        });

        this.el.resultOverlay.classList.add('show');
    },

    hideResult() {
        this.el.resultOverlay.classList.remove('show');
    },

    showExchange(text, cards) {
        this.el.exchangeText.innerHTML = text;
        this.el.exchangeCards.innerHTML = '';
        for (const c of cards) {
            this.el.exchangeCards.appendChild(this.createCard(c));
        }
        this.el.exchangeOverlay.classList.add('show');
    },

    hideExchange() {
        this.el.exchangeOverlay.classList.remove('show');
    },

    hideStart() {
        this.el.startOverlay.classList.remove('show');
    }
};
