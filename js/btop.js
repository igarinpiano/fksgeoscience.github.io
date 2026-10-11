// btop（リソースモニタ）。js/term-cmds.js のあとに読み込みます。
// 罫線・グラフ・メーターは文字ではなく、CSS で描いた 1 桁ぶんの箱（<b>）で出します。
// この端末は全角・曖昧幅の文字を 2 桁として扱うので、罫線素片や点字をそのまま使うと桁がずれるためです。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { HOME, USER } = T;
    const { cw, width, pad, padL, escHtml } = T.util;
    const { load, traffic, noise } = T.sys;
    const VERSION = '1.4.5';
    const CONF = `${HOME}/.config/btop/btop.conf`;
    const SELF = 4129;
    const MEM_K = 100352;
    const BOXES = ['cpu', 'mem', 'net', 'proc'];
    const PRESETS = [BOXES, ['cpu', 'proc'], ['cpu', 'mem', 'net']];
    const SORTS = ['pid', 'program', 'arguments', 'threads', 'user', 'memory', 'cpu direct', 'cpu lazy'];
    const SIGNALS = [[1, 'SIGHUP'], [2, 'SIGINT'], [9, 'SIGKILL'], [15, 'SIGTERM'], [18, 'SIGCONT'], [19, 'SIGSTOP']];
    const MEMS = [['used', 'Used', 'Used'], ['available', 'Available', 'Avail'], ['cached', 'Cached', 'Cache'], ['free', 'Free', 'Free']];
    const BOLD = { bold: true };

    // ---------- 色（btop の Default テーマ） ----------
    const C = {
        fg: '#cccccc', title: '#eeeeee', hi: '#d05050', selBg: '#6a2f2f', selFg: '#eeeeee', off: '#404040', dim: '#8a8a8a', gtext: '#707070', div: '#4a4a4a',
        cpu: '#556d59', mem: '#6c6c4b', net: '#5c588d', proc: '#805252',
    };
    const GRAD = {
        cpu: ['#77ca9b', '#cbc06c', '#dc4c4c'], temp: ['#4897d4', '#5474e8', '#ff40b6'], process: ['#80d0a3', '#dcd179', '#d45454'],
        used: ['#592b26', '#d9626d', '#ff4769'], available: ['#4e3f0e', '#ffd77a', '#ffb814'], cached: ['#163350', '#74e6fc', '#26c5ff'], free: ['#384f21', '#b5e685', '#dcff85'],
        download: ['#291f75', '#4f43a3', '#b0a9de'], upload: ['#620665', '#7d4180', '#dcafde'],
    };
    const BANNER = ['#e62525', '#cd2121', '#b31d1d', '#9a1919', '#801414'];
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const grads = {};
    for (const [k, stops] of Object.entries(GRAD)) {
        const [a, m, b] = stops.map(rgb);
        grads[k] = Array.from({ length: 101 }, (_, i) => { const [p, q, t] = i < 50 ? [a, m, i / 50] : [m, b, (i - 50) / 50]; return `rgb(${p.map((v, j) => Math.round(v + (q[j] - v) * t)).join(',')})`; });
    }
    const tint = (k, v) => grads[k][Math.max(0, Math.min(100, Math.round(v * 100)))];

    // ---------- 表示用の小道具 ----------
    const p2 = (n) => String(n).padStart(2, '0');
    // btop と同じく 1000 を超えたら次の単位へ、有効数字は 3 桁
    const human = (n, short = false) => {
        const U = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
        let i = 0;
        while (n >= 1000 && i < 4) { n /= 1024; i++; }
        const s = !i ? String(Math.round(n)) : n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.round(n));
        return short ? s + U[i][0] : `${s} ${U[i]}`;
    };
    const elapsed = (ms, secs = true) => { const s = Math.floor(ms / 1000), d = Math.floor(s / 86400); return `${d ? `${d}d ` : ''}${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}${secs ? `:${p2(s % 60)}` : ''}`; };
    // "_m_enu" のように、_ で囲んだ文字をホットキーの色にする
    const label = (s, on = true) => s.split('_').map((part, i) => [part, i % 2 ? C.hi : on ? C.title : C.dim, { bold: on }]).filter(([part]) => part);

    // 画面 1 枚ぶんのマス目。最後に行ごとの HTML にする
    class Canvas {
        constructor(w, h) { this.w = w; this.h = h; this.cell = new Array(w * h).fill(null); this.hits = []; }
        put(x, y, html, fg = '', bg = '', cls = '', wide = false) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cell[y * this.w + x] = [html, fg, bg, cls, wide]; }
        text(x, y, s, fg, { bg = '', bold = false, cls = bold ? 'bo' : '', max = this.w } = {}) {
            const end = Math.min(max, this.w);
            for (const ch of String(s)) {
                const n = cw(ch);
                if (x + n > end) break;
                this.put(x, y, n === 2 ? `<i>${ch}</i>` : escHtml(ch), fg, bg, cls, n === 2);
                if (n === 2 && x >= 0 && y >= 0 && y < this.h) this.cell[y * this.w + x + 1] = 0;
                x += n;
            }
            return x;
        }
        shape(x, y, kind, fg, bg) { this.put(x, y, `<b class="${kind}"></b>`, fg, bg); }
        hline(x, y, n, fg) { for (let i = 0; i < n; i++) this.shape(x + i, y, 'bh', fg); }
        clear(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, ' '); }
        box({ x, y, w, h }, fg) {
            this.hline(x + 1, y, w - 2, fg); this.hline(x + 1, y + h - 1, w - 2, fg);
            for (let j = 1; j < h - 1; j++) { this.shape(x, y + j, 'bv', fg); this.shape(x + w - 1, y + j, 'bv', fg); }
            this.shape(x, y, 'tl rd', fg); this.shape(x + w - 1, y, 'tr rd', fg); this.shape(x, y + h - 1, 'bl rd', fg); this.shape(x + w - 1, y + h - 1, 'br rd', fg);
        }
        // 枠線の上に ┐見出し┌ を置く。segs は [文字列, 色, オプション] の並び。key を渡すとクリックできる
        tab(x, y, segs, fg, { bottom = false, key = null } = {}) {
            const x0 = x;
            this.shape(x++, y, bottom ? 'br' : 'tr', fg);
            for (const [s, col, o = {}] of segs) {
                if (o.sup) this.put(x++, y, `<b class="sp">${s}</b>`, col);
                else x = this.text(x, y, s, col, o);
            }
            this.shape(x++, y, bottom ? 'bl' : 'tl', fg);
            if (key) this.hits.push([x0, y, x - x0, key]);
            return x;
        }
        // 履歴（0〜1）を右づめで描く。1 桁に 2 サンプル、1 行に 4 段（点字と同じ刻み）
        graph(x, y, w, h, hist, key, { down = false, block = false, bg = '' } = {}) {
            const kind = `${block ? 'gk' : 'gr'}${down ? ' dn' : ''}`;
            for (let col = 0; col < w; col++) {
                const i = hist.length - (w - col) * 2;
                if (i + 1 < 0) continue;
                const a = i >= 0 ? hist[i] : -1, b = hist[i + 1];
                for (let r = 0; r < h; r++) {
                    // いちばん下の段には、値が 0 でも点を 1 つ打つ
                    const lv = (v) => (v < 0 ? 0 : Math.max(r ? 0 : 1, Math.min(4, Math.round(v * h * 4) - r * 4)));
                    const la = lv(a), lb = lv(b);
                    if (la || lb) this.put(x + col, down ? y + r : y + h - 1 - r, `<b class="${kind}" style="--a:${la};--b:${lb}"></b>`, tint(key, h > 1 ? (r + 1) / h : Math.max(a, b)), bg);
                }
            }
        }
        // 色は左から右へ変わる。暗い出だしの色は地に沈むので、少し先から始める
        meter(x, y, n, v, key) { const on = Math.round(v * n); for (let i = 0; i < n; i++) this.put(x + i, y, '<b class="mt"></b>', i < on ? tint(key, n > 1 ? 0.25 + 0.75 * i / (n - 1) : 1) : C.off); }
        rows() {
            const out = [];
            for (let y = 0; y < this.h; y++) {
                let s = '', key = '||';
                for (let x = 0; x < this.w; x++) {
                    let c = this.cell[y * this.w + x];
                    if (c === 0) c = null;
                    else if (c && c[4]) { if (x + 1 < this.w && this.cell[y * this.w + x + 1] === 0) x++; else c = null; }
                    const k = c ? `${c[1]}|${c[2]}|${c[3]}` : '||';
                    if (k !== key) {
                        if (key !== '||') s += '</span>';
                        if (k !== '||') s += `<span${c[3] ? ` class="${c[3]}"` : ''}${c[1] || c[2] ? ` style="${c[1] ? `color:${c[1]};` : ''}${c[2] ? `background:${c[2]}` : ''}"` : ''}>`;
                        key = k;
                    }
                    s += c ? c[0] : ' ';
                }
                out.push(key !== '||' ? `${s}</span>` : s);
            }
            return out;
        }
    }

    const KEYS = [
        ['Esc, m', 'メニューを開く・閉じる'], ['h, ?', 'このヘルプ'], ['o', '設定'], ['q, Ctrl-C', '終了'],
        ['1 2 3 4', 'cpu / mem / net / proc の箱を出し入れする'], ['p', 'プリセットを切りかえる'], ['+ -', '更新間隔を 100ms ずつ変える'], ['d', 'ディスクの表示を切りかえる'], ['z', '通信量の合計を 0 から数えなおす'],
        ['↑ ↓', 'プロセスを選ぶ（PgUp PgDn Home End も可）'], ['← →', '並べかえる列を変える'], ['r', '逆順にする'], ['e', '親子の木として表示する'],
        ['f, /', '絞りこむ（Enter で確定、Esc で解除）'], ['Enter', '選んだプロセスの詳細を開く・閉じる'], ['t k s', 'TERM / KILL / 選んだシグナルを送る'],
    ];
    const USAGE = `usage: btop [-h] [-v] [-p <id>] [-u <ms>]\n\noptional arguments:\n  -h, --help            このヘルプを表示して終了する\n  -v, --version         バージョンを表示して終了する\n  -p, --preset <id>     プリセット（0〜${PRESETS.length - 1}）を選んで起動する\n  -u, --update <ms>     更新間隔をミリ秒で指定する\n`;

    function run(c, start) {
        return new Promise((resolve) => {
            const scr = c.term.openScreen();
            const since = T.sys.since, t0 = Date.now();
            const ui = { boxes: new Set(BOXES), ms: 2000, graph: 'braille', sort: 'cpu lazy', reversed: false, tree: false, disks: true, filter: '', typing: false, sel: 0, top: 0, info: null, over: null, zero: null };
            const view = { list: [], page: 1 };
            let hits = [];

            // ---------- 設定ファイル（~/.config/btop/btop.conf） ----------
            const bool = (v) => (v ? 'True' : 'False');
            const yes = (v) => /^true$/i.test(v);
            const clampMs = (n) => Math.max(100, Math.min(60000, Math.round(n / 100) * 100));
            const SET = {
                graph_symbol: (v) => { if (v === 'braille' || v === 'block') ui.graph = v; },
                update_ms: (v) => { if (/^\d+$/.test(v)) ui.ms = clampMs(Number(v)); },
                proc_sorting: (v) => { if (SORTS.includes(v)) ui.sort = v; },
                proc_reversed: (v) => { ui.reversed = yes(v); },
                proc_tree: (v) => { ui.tree = yes(v); },
                show_disks: (v) => { ui.disks = yes(v); },
                shown_boxes: (v) => { const b = v.split(/\s+/).filter((k) => BOXES.includes(k)); if (b.length) ui.boxes = new Set(b); },
            };
            const confText = () => [
                `#? Config file for btop v. ${VERSION}`, '',
                '#* グラフの描きかた。"braille"（点）か "block"（面）。', `graph_symbol = "${ui.graph}"`, '',
                '#* 更新間隔（ミリ秒）。btop の中では + と - で変えられます。', `update_ms = ${ui.ms}`, '',
                `#* プロセスの並び順。${SORTS.map((s) => `"${s}"`).join(' ')} のどれか。`, `proc_sorting = "${ui.sort}"`, '',
                '#* 並び順を逆にする。', `proc_reversed = ${bool(ui.reversed)}`, '',
                '#* プロセスを親子の木として表示する。', `proc_tree = ${bool(ui.tree)}`, '',
                '#* メモリの箱にディスクも表示する。', `show_disks = ${bool(ui.disks)}`, '',
                '#* 表示する箱。"cpu mem net proc" から選んで空白で区切る。', `shown_boxes = "${BOXES.filter((b) => ui.boxes.has(b)).join(' ')}"`, '',
            ].join('\n');
            const conf = c.fs.get(CONF);
            if (conf?.t === 'f') for (const m of conf.data.matchAll(/^(\w+)[ \t]*=[ \t]*"?([^"\n]*?)"?[ \t]*$/gm)) SET[m[1]]?.(m[2]);
            const saveConf = () => {
                const text = confText();
                if (c.fs.get(CONF)?.data === text) return;
                c.fs.mkdirp(`${HOME}/.config/btop`, USER, true);
                c.fs.write(CONF, text);
            };
            if (start.preset != null) ui.boxes = new Set(PRESETS[start.preset]);
            if (start.ms != null) ui.ms = clampMs(start.ms);
            const presetName = () => { const i = PRESETS.findIndex((p) => p.length === ui.boxes.size && p.every((b) => ui.boxes.has(b))); return i < 0 ? '*' : String(i); };

            // ---------- 計測 ----------
            const base = T.sys.tasks(SELF, ['btop', ...c.args].join(' '));
            const hist = { cpu: [], temp: [], down: [], up: [], used: [], available: [], cached: [], free: [], proc: new Map(base.map((p) => [p.pid, []])) };
            const now = { list: [], cpu: 0, temp: 0, down: 0, up: 0, mem: {}, lav: 0 };
            const upSec = (t0 - since) / 1000;
            const total = { down: 5800 * upSec, up: 1900 * upSec, topDown: 0, topUp: 0 };
            const push = (a, v) => { a.push(v); if (a.length > 400) a.shift(); };
            const sample = (ms, dt) => {
                const t = (ms - since) / 1000;
                now.list = base.map((p) => {
                    const cpu = load(p.pid, ms), h = hist.proc.get(p.pid);
                    push(h, cpu / 100);
                    const last = h.slice(-4);
                    return { ...p, cpu, lazy: last.reduce((s, v) => s + v, 0) / last.length * 100 };
                });
                now.cpu = Math.min(100, now.list.reduce((s, p) => s + p.cpu, 0.4));
                const hour = new Date(ms).getHours();
                now.temp = 27 + now.cpu * 0.25 + (hour >= 9 && hour < 17 ? 5 : 0) + 2 * noise(61, t / 15);
                Object.assign(now, traffic(ms));
                now.mem = T.sys.mem(ms);
                push(hist.cpu, now.cpu / 100); push(hist.temp, now.temp / 90); push(hist.down, now.down); push(hist.up, now.up);
                for (const [k] of MEMS) push(hist[k], now.mem[k] / MEM_K);
                const recent = hist.cpu.slice(-30);
                now.lav = 0.39 + recent.reduce((s, v) => s + v, 0) / recent.length;
                total.down += now.down * dt; total.up += now.up * dt;
                total.topDown = Math.max(total.topDown, now.down); total.topUp = Math.max(total.topUp, now.up);
            };
            for (let i = 400; i > 0; i--) sample(t0 - i * ui.ms, 0);
            let last = t0, lastSec = 0;
            sample(t0, 0);

            // ---------- 箱の配置 ----------
            const layout = (cols, rows) => {
                const on = (k) => ui.boxes.has(k), r = {};
                if (cols >= 74) {
                    const cpuH = !on('cpu') ? 0 : ui.boxes.size > 1 ? Math.max(6, Math.round(rows * 0.32)) : rows;
                    const h = rows - cpuH, lw = !(on('mem') || on('net')) ? 0 : on('proc') ? Math.floor(cols * 0.45) : cols;
                    const memH = !on('mem') ? 0 : on('net') ? Math.round(h * 0.56) : h;
                    if (cpuH) r.cpu = { x: 0, y: 0, w: cols, h: cpuH };
                    if (on('mem')) r.mem = { x: 0, y: cpuH, w: lw, h: memH };
                    if (on('net')) r.net = { x: 0, y: cpuH + memH, w: lw, h: h - memH };
                    if (on('proc')) r.proc = { x: lw, y: cpuH, w: cols - lw, h };
                    return r;
                }
                // せまい画面（スマホなど）では縦に積む。入りきらない箱は net、mem の順にあきらめる
                const want = { cpu: 6, mem: 7, net: 6, proc: 7 };
                const list = BOXES.filter(on);
                for (const drop of ['net', 'mem', 'cpu']) if (list.length > 1 && list.reduce((s, k) => s + want[k], 0) > rows && list.includes(drop)) list.splice(list.indexOf(drop), 1);
                let y = 0;
                list.forEach((k, i) => { const h = i === list.length - 1 ? rows - y : want[k]; r[k] = { x: 0, y, w: cols, h }; y += h; });
                return r;
            };

            // ---------- cpu ----------
            const drawCpu = (cv, r) => {
                const { x, y, w, h } = r, B = C.cpu, ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2, block = ui.graph === 'block';
                cv.box(r, B);
                let tx = cv.tab(ix, y, [['1', C.hi, { sup: true }], ['cpu', C.title, BOLD]], B, { key: '1' });
                tx = cv.tab(tx, y, label('_m_enu'), B, { key: 'm' });
                if (w >= 46) tx = cv.tab(tx, y, label(`_p_reset ${presetName()}`), B, { key: 'p' });
                const ms = `${ui.ms}ms`, rx = x + w - 1 - (ms.length + 6);
                if (rx > tx) { cv.tab(rx, y, [['-', C.hi, BOLD], [` ${ms} `, C.title, BOLD], ['+', C.hi, BOLD]], B); cv.hits.push([rx + 1, y, 2, '-'], [rx + ms.length + 3, y, 2, '+']); }
                const d = new Date(), cx = x + ((w - 10) >> 1);
                if (cx > tx && cx + 10 < rx) cv.tab(cx, y, [[`${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, C.title, BOLD]], B);

                const pct = `${padL(Math.round(now.cpu), 3)}%`, temp = `${padL(Math.round(now.temp), 3)}℃`, up = `up ${elapsed(Date.now() - since, false)}`;
                const wide = iw >= 60 && ih >= 4, bw = wide ? Math.max(30, Math.min(40, Math.floor(iw * 0.42))) : 0;
                const gw = iw - bw, gh = wide ? ih : ih - 1, g1 = Math.ceil(gh / 2);
                // 上半分は上向き、下半分は鏡写し
                cv.graph(ix, iy, gw, g1, hist.cpu, 'cpu', { block });
                cv.graph(ix, iy + g1, gw, gh - g1, hist.cpu, 'cpu', { down: true, block });
                cv.text(ix + 1, iy, up, C.gtext, { max: ix + gw });
                if (!wide) {
                    const yy = iy + ih - 1, m = Math.max(3, iw - 29);
                    let px = cv.text(ix + 1, yy, 'CPU ', C.title, BOLD);
                    cv.meter(px, yy, m, now.cpu / 100, 'cpu');
                    px = cv.text(px + m + 1, yy, pct, C.fg);
                    px = cv.text(px + 1, yy, temp, tint('temp', now.temp / 90));
                    cv.text(px + 2, yy, `LAV ${now.lav.toFixed(2)}`, C.fg, { max: ix + iw });
                    return;
                }
                const bx = x + w - 1 - bw, inner = ih - 2, m = bw - 25;
                cv.box({ x: bx, y: iy, w: bw, h: ih }, C.div);
                const tend = cv.tab(bx + 1, iy, [['タカハシ 計算機', C.title, BOLD]], C.div);
                if (bx + bw - 9 > tend) cv.tab(bx + bw - 9, iy, [['98 MHz', C.title, BOLD]], C.div);
                const line = (yy, name, col, withTemp) => {
                    let px = cv.text(bx + 2, yy, pad(name, 4), col, { bold: withTemp });
                    cv.meter(px, yy, m, now.cpu / 100, 'cpu');
                    px = cv.text(px + m + 1, yy, pct, C.fg);
                    if (!withTemp) return;
                    cv.graph(px + 1, yy, 5, 1, hist.temp, 'temp', { block });
                    cv.text(px + 6, yy, temp, tint('temp', now.temp / 90));
                };
                line(iy + 1, 'CPU', C.title, true);
                if (inner >= 3) line(iy + 2, 'C0', C.fg, false);
                if (inner >= 2) {
                    const lav = `${now.lav.toFixed(2)}  0.31  0.27`;
                    cv.text(bx + 2, iy + inner, 'Load AVG:', C.title, BOLD);
                    cv.text(bx + bw - 2 - lav.length, iy + inner, lav, C.fg);
                }
            };

            // ---------- mem ----------
            const drawMem = (cv, r) => {
                const { x, y, w, h } = r, B = C.mem, ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2, block = ui.graph === 'block';
                cv.box(r, B);
                cv.tab(ix, y, [['2', C.hi, { sup: true }], ['mem', C.title, BOLD]], B, { key: '2' });
                const disks = ui.disks && iw >= 32, dw = disks ? Math.max(15, Math.floor(iw * 0.45)) : 0, mw = iw - dw - (disks ? 1 : 0);
                const long = mw >= 26, size = (k) => human(k * 1024, !long), tall = ih >= 9;
                const right = (yy, s) => cv.text(ix + mw - 1 - width(s), yy, s, C.fg);
                cv.text(ix + 1, iy, 'Total:', C.title, BOLD);
                right(iy, size(MEM_K));
                MEMS.forEach(([k, name, short], i) => {
                    const f = now.mem[k] / MEM_K, sv = size(now.mem[k]), pct = `${padL(Math.round(f * 100), 3)}%`, yy = iy + 1 + i * (tall ? 2 : 1);
                    if (yy >= y + h - 1) return;
                    if (tall) {
                        cv.text(ix + 1, yy, `${name}:`, C.title, BOLD);
                        right(yy, sv);
                        cv.graph(ix + 1, yy + 1, mw - 7, 1, hist[k], k, { block });
                        right(yy + 1, pct);
                        return;
                    }
                    const m = mw - 9 - width(sv) - (long ? 5 : 0), px = cv.text(ix + 1, yy, pad(short, 6), C.title, BOLD);
                    cv.meter(px, yy, m, f, k);
                    if (long) cv.text(px + m + 1, yy, pct, C.fg);
                    right(yy, sv);
                });
                if (!disks) return;
                const sx = ix + mw, dx = sx + 1, per = ih >= T.sys.disks.length * 3 ? 3 : 2;
                cv.shape(sx, y, 'tt', B); cv.shape(sx, y + h - 1, 'bt', B);
                for (let j = 0; j < ih; j++) cv.shape(sx, iy + j, 'bv', B);
                cv.tab(dx, y, label('_d_isks'), B, { key: 'd' });
                T.sys.disks.forEach(([, bytes, used, mount], i) => {
                    const yy = iy + i * per;
                    if (yy + 1 >= y + h - 1) return;
                    const tv = human(bytes, dw < 22);
                    cv.text(dx + 1, yy, mount === '/' ? 'root' : mount.split('/').pop(), C.title, BOLD);
                    cv.text(dx + dw - 1 - width(tv), yy, tv, C.fg);
                    // せまいときは見出しを省いて、メーターに幅をゆずる
                    const line = (y2, name, f, key) => { const px = cv.text(dx + 1, y2, `${dw >= 20 ? `${name}:` : per === 3 ? `${name[0]} ` : ''}${padL(Math.round(f * 100), 3)}% `, C.fg); cv.meter(px, y2, dx + dw - 1 - px, f, key); };
                    line(yy + 1, 'Used', used / bytes, 'used');
                    if (per === 3) line(yy + 2, 'Free', 1 - used / bytes, 'free');
                });
            };

            // ---------- net ----------
            const drawNet = (cv, r) => {
                const { x, y, w, h } = r, B = C.net, ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2, block = ui.graph === 'block';
                cv.box(r, B);
                let tx = cv.tab(ix, y, [['3', C.hi, { sup: true }], ['net', C.title, BOLD]], B, { key: '3' });
                const rx = x + w - 11;
                if (rx > tx) cv.tab(rx, y, [['b', C.hi, BOLD], [' eth0 ', C.title, BOLD], ['n', C.hi, BOLD]], B);
                if (tx + 6 < rx) tx = cv.tab(tx, y, label('_z_ero', !!ui.zero), B, { key: 'z' });
                if (tx + 14 < rx) cv.tab(tx, y, [['192.168.24.5', C.title, BOLD]], B);
                const tw = 17, gw = Math.max(0, iw - tw), g1 = Math.ceil(ih / 2);
                const scale = (a, floor) => Math.max(floor, ...a.slice(-gw * 2));
                const sd = scale(hist.down, 10240), su = scale(hist.up, 4096);
                cv.graph(ix, iy, gw, g1, hist.down.map((v) => v / sd), 'download', { block });
                cv.graph(ix, iy + g1, gw, ih - g1, hist.up.map((v) => v / su), 'upload', { down: true, block });
                if (gw >= 8) { cv.text(ix, iy, human(sd, true), C.gtext); if (ih > 1) cv.text(ix, iy + ih - 1, human(su, true), C.gtext); }
                // 右側の数字。下りは上から、上りは下から詰める
                const txx = ix + gw + 1, more = ih >= 6, both = ih >= 4;
                const stat = (yy, arrow, key, rate, top, sum) => {
                    cv.text(txx, yy, arrow, tint(key, 1));
                    cv.text(txx + 3, yy, `${human(rate)}/s`, C.fg, { max: ix + iw });
                    if (more) cv.text(txx, ++yy, `Top: ${human(top)}/s`, C.dim, { max: ix + iw });
                    if (both) cv.text(txx, ++yy, `Total: ${human(sum)}`, C.dim, { max: ix + iw });
                };
                const lines = more ? 3 : both ? 2 : 1;
                stat(iy, '▼', 'download', now.down, total.topDown, total.down - (ui.zero?.down ?? 0));
                if (ih >= lines * 2) stat(iy + ih - lines, '▲', 'upload', now.up, total.topUp, total.up - (ui.zero?.up ?? 0));
            };

            // ---------- proc ----------
            const sorted = () => {
                const f = ui.filter.toLowerCase();
                const list = now.list.filter((p) => !f || `${p.pid} ${p.name} ${p.cmd} ${p.user}`.toLowerCase().includes(f));
                const key = { pid: (p) => p.pid, program: (p) => p.name, arguments: (p) => p.cmd, threads: (p) => p.threads, user: (p) => p.user, memory: (p) => p.mem, 'cpu direct': (p) => p.cpu, 'cpu lazy': (p) => p.lazy }[ui.sort];
                // 本物と同じく、どの列も既定は降順
                list.sort((a, b) => { const u = key(a), v = key(b); return (u < v ? 1 : u > v ? -1 : a.pid - b.pid) * (ui.reversed ? -1 : 1); });
                if (!ui.tree) return list;
                const out = [];
                const walk = (p, pre, lastKid, depth) => {
                    out.push({ ...p, pre: depth ? pre + (lastKid ? 'L' : 'T') : '' });
                    const kids = list.filter((q) => q.ppid === p.pid);
                    kids.forEach((k, i) => walk(k, depth ? pre + (lastKid ? ' ' : 'I') : '', i === kids.length - 1, depth + 1));
                };
                for (const root of list.filter((p) => !list.some((q) => q.pid === p.ppid))) walk(root, '', true, 0);
                return out;
            };
            const drawProc = (cv, r) => {
                const { x, y, w, h } = r, B = C.proc, ix = x + 1, iw = w - 2, yb = y + h - 1, block = ui.graph === 'block';
                cv.box(r, B);
                let tx = cv.tab(ix, y, [['4', C.hi, { sup: true }], ['proc', C.title, BOLD]], B, { key: '4' });
                if (ui.typing || ui.filter) tx = cv.tab(tx, y, [['f', C.hi, BOLD], [` ${ui.filter}`, C.fg, { max: x + w - 4 }], ...(ui.typing ? [[' ', '', { cls: 'cur' }]] : [])], B, { key: 'f' });
                else tx = cv.tab(tx, y, label('_f_ilter'), B, { key: 'f' });
                let rx = x + w - 1;
                for (const [segs, key] of [[[['<', C.hi, BOLD], [` ${ui.sort} `, C.title, BOLD], ['>', C.hi, BOLD]], null], [label('tre_e_', ui.tree), 'e'], [label('_r_everse', ui.reversed), 'r']]) {
                    const tw = 2 + segs.reduce((s, [t]) => s + width(t), 0);
                    if (rx - tw <= tx) break;
                    rx -= tw;
                    cv.tab(rx, y, segs, B, { key });
                    if (!key) cv.hits.push([rx, y, 3, 'Left'], [rx + tw - 3, y, 3, 'Right']);
                }

                let cy = y + 1, avail = h - 2;
                const info = ui.info != null && now.list.find((p) => p.pid === ui.info);
                if (info && avail >= 10) {
                    const half = ix + Math.max(20, iw >> 1), busy = info.cpu > 5 || info.pid === SELF, memB = info.mem / 100 * MEM_K * 1024, max = ix + iw;
                    // 詳細の上下の線は、外枠につなぐ
                    for (const yy of [cy, cy + 6]) { cv.shape(x, yy, 'lt', B); cv.hline(ix, yy, iw, B); cv.shape(x + w - 1, yy, 'rt', B); }
                    cv.tab(cv.tab(ix + 1, cy, [[`pid: ${info.pid}`, C.title, BOLD]], B), cy, [[info.name, C.title, BOLD]], B);
                    const kv = (xx, yy, k, v, col = C.fg) => cv.text(cv.text(xx, yy, `${k} `, C.title, { bold: true, max }), yy, v, col, { max });
                    kv(ix + 1, cy + 1, 'Status:', busy ? 'Running' : 'Sleeping', busy ? '#0de756' : C.fg);
                    kv(half, cy + 1, 'Elapsed:', elapsed(Date.now() - info.born, info.born > since));
                    kv(ix + 1, cy + 2, 'Parent:', base.find((p) => p.pid === info.ppid)?.name || '-');
                    const ux = kv(half, cy + 2, 'User:', info.user);
                    if (ux + 14 < max) kv(ux + 2, cy + 2, 'Threads:', String(info.threads));
                    const mx = kv(ix + 1, cy + 3, 'Memory:', `${padL(info.mem.toFixed(1), 4)}% `), mlen = Math.max(0, Math.min(16, max - mx - 10));
                    cv.meter(mx, cy + 3, mlen, Math.min(1, info.mem / 10), 'used');
                    cv.text(mx + mlen + 1, cy + 3, human(memB), C.fg, { max });
                    const gx = kv(ix + 1, cy + 4, 'CPU:   ', `${padL(info.cpu.toFixed(1), 4)}% `, tint('process', Math.min(1, info.cpu / 30)));
                    cv.graph(gx, cy + 4, Math.max(0, max - gx - 1), 1, hist.proc.get(info.pid).map((v) => Math.min(1, v * 4)), 'process', { block });
                    kv(ix + 1, cy + 5, 'CMD:', info.cmd);
                    cy += 7; avail -= 7;
                }

                // 列の幅。せまいときは グラフ → User → Threads → Command の順に足していく
                let rest = iw - 17;
                const graphW = rest - 6 >= 12 ? 6 : 0; rest -= graphW;
                const userW = rest - 5 >= 12 ? 5 : 0; rest -= userW;
                const thrW = rest - 9 >= 16 ? 9 : 0; rest -= thrW;
                const cmdW = !ui.tree && rest - 15 >= 12 ? rest - 15 : 0, progW = rest - cmdW;
                const head = (ui.tree ? pad('Tree:', 6 + progW) : `${padL('Pid:', 5)} ${pad('Program:', progW)}${cmdW ? pad('Command:', cmdW) : ''}`)
                    + (thrW ? `${padL('Threads:', 8)} ` : '') + (userW ? pad('User:', userW) : '') + `${padL('MemB', 5)} ${' '.repeat(graphW)}Cpu%`;
                cv.text(ix, cy, head, C.title, BOLD);

                const list = sorted(), n = Math.max(1, avail - 1);
                ui.sel = Math.min(ui.sel, list.length);
                if (ui.sel && ui.sel - 1 < ui.top) ui.top = ui.sel - 1;
                if (ui.sel > ui.top + n) ui.top = ui.sel - n;
                ui.top = Math.max(0, Math.min(ui.top, list.length - n));
                view.list = list; view.page = n;
                list.slice(ui.top, ui.top + n).forEach((p, i) => {
                    const yy = cy + 1 + i, sel = ui.sel === ui.top + i + 1, bg = sel ? C.selBg : '', col = (v) => (sel ? C.selFg : v);
                    if (yy >= yb) return;
                    if (sel) for (let k = 0; k < iw; k++) cv.put(ix + k, yy, ' ', '', bg);
                    const nameEnd = ix + 6 + progW;
                    if (ui.tree) {
                        let px = ix;
                        for (const ch of p.pre) {
                            if (ch === 'I') cv.shape(px, yy, 'bv', C.gtext, bg);
                            else if (ch !== ' ') { cv.shape(px, yy, ch === 'L' ? 'bl' : 'lt', C.gtext, bg); cv.shape(px + 1, yy, 'bh', C.gtext, bg); }
                            px += ch === ' ' || ch === 'I' ? 2 : 3;
                        }
                        px = cv.text(px, yy, `${p.pid} `, col(C.dim), { bg, max: nameEnd - 1 });
                        px = cv.text(px, yy, `${p.name} `, col(C.title), { bg, bold: true, max: nameEnd - 1 });
                        cv.text(px, yy, p.cmd.split(' ').slice(1).join(' '), col(C.gtext), { bg, max: nameEnd - 1 });
                    } else {
                        cv.text(ix, yy, padL(p.pid, 5), col(C.fg), { bg });
                        cv.text(ix + 6, yy, p.name, col(C.title), { bg, bold: true, max: nameEnd - 1 });
                        if (cmdW) cv.text(nameEnd, yy, p.cmd, col(C.dim), { bg, max: nameEnd + cmdW - 1 });
                    }
                    let px = nameEnd + cmdW;
                    if (thrW) { cv.text(px, yy, padL(p.threads, 8), col(C.fg), { bg }); px += thrW; }
                    if (userW) { cv.text(px, yy, p.user.slice(0, 4), col(C.fg), { bg }); px += userW; }
                    cv.text(px, yy, padL(human(p.mem / 100 * MEM_K * 1024, true), 5), col(C.fg), { bg });
                    px += 6;
                    if (graphW) { cv.graph(px, yy, 5, 1, hist.proc.get(p.pid).map((v) => Math.min(1, v * 4)), 'process', { block, bg }); px += graphW; }
                    cv.text(px, yy, padL(p.cpu.toFixed(1), 4), sel ? C.selFg : tint('process', Math.min(1, p.cpu / 30)), { bg });
                    cv.hits.push([ix, yy, iw, { row: ui.top + i + 1 }]);
                });

                const count = `${ui.sel}/${list.length}`, cxr = x + w - 1 - (count.length + 2), has = ui.sel > 0 || !!info;
                let bx = ix, room = true;
                const foot = (segs, key, tw) => { room &&= bx + tw < cxr; if (!room) return; cv.tab(bx, yb, segs, B, { bottom: true, key }); bx += tw; };
                if (bx + 14 < cxr) { cv.hits.push([bx, yb, 4, 'Up'], [bx + 10, yb, 4, 'Down']); foot([['↑', C.hi], [' select ', C.title, BOLD], ['↓', C.hi]], null, 14); }
                foot([['info ', has ? C.title : C.dim, { bold: has }], ['↵', C.hi]], 'Enter', 9);
                foot(label('_t_erminate', has), 't', 11);
                foot(label('_k_ill', has), 'k', 6);
                foot(label('_s_ignals', has), 's', 9);
                cv.tab(cxr, yb, [[count, C.title, BOLD]], B, { bottom: true });
            };

            // ---------- 重ねて出す窓 ----------
            const panel = (cv, w, h, title) => {
                w = Math.min(w, cv.w); h = Math.min(h, cv.h);
                const x = (cv.w - w) >> 1, y = (cv.h - h) >> 1;
                cv.hits = [];
                cv.clear(x, y, w, h);
                cv.box({ x, y, w, h }, C.hi);
                cv.tab(x + 1, y, [[title, C.title, BOLD]], C.hi);
                return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
            };
            const OPTS = [
                ['graph_symbol', 'グラフを点（braille）で描くか、面（block）で描くか', () => ui.graph, () => { ui.graph = ui.graph === 'braille' ? 'block' : 'braille'; }],
                ['update_ms', '更新間隔（ミリ秒）。100 ずつ変わります', () => ui.ms, (d) => { ui.ms = clampMs(ui.ms + d * 100); }],
                ['proc_sorting', 'プロセスを並べかえる列', () => ui.sort, (d) => { ui.sort = SORTS[(SORTS.indexOf(ui.sort) + d + SORTS.length) % SORTS.length]; }],
                ['proc_reversed', '並び順を逆にする', () => bool(ui.reversed), () => { ui.reversed = !ui.reversed; }],
                ['proc_tree', 'プロセスを親子の木として表示する', () => bool(ui.tree), () => { ui.tree = !ui.tree; }],
                ['show_disks', 'メモリの箱にディスクも表示する', () => bool(ui.disks), () => { ui.disks = !ui.disks; }],
            ];
            const MENU = ['Options', 'Help', 'Quit'];
            const GLYPH = { B: '110101110101110', T: '111010010010010', O: '111101101101111', P: '110101110100100' };
            const drawOver = (cv) => {
                const o = ui.over;
                if (o.kind === 'help') {
                    const a = panel(cv, 58, KEYS.length + 4, 'help');
                    cv.text(a.x + 1, a.y, pad('キー:', 12) + '説明:', C.title, { bold: true, max: a.x + a.w });
                    KEYS.slice(0, a.h - 2).forEach(([k, desc], i) => { cv.text(a.x + 1, a.y + 1 + i, k, C.hi, { bold: true, max: a.x + a.w }); cv.text(a.x + 13, a.y + 1 + i, desc, C.fg, { max: a.x + a.w }); });
                    cv.text(a.x + 1, a.y + a.h - 1, 'なにかキーを押すと閉じます', C.gtext, { max: a.x + a.w });
                } else if (o.kind === 'menu') {
                    const banner = cv.h >= 16 && cv.w >= 36;
                    const a = panel(cv, 34, MENU.length + (banner ? 11 : 5), 'menu');
                    let yy = a.y + 1;
                    if (banner) {
                        [...'BTOP'].forEach((ch, n) => { for (let j = 0; j < 15; j++) if (GLYPH[ch][j] === '1') for (let k = 0; k < 2; k++) cv.put(a.x + 2 + n * 8 + (j % 3) * 2 + k, yy + Math.floor(j / 3), ' ', '', BANNER[Math.floor(j / 3)]); });
                        yy += 6;
                    }
                    MENU.forEach((name, i) => {
                        const on = o.i === i, xx = a.x + ((a.w - name.length - 4) >> 1);
                        cv.text(xx, yy + i, `  ${name}  `, on ? C.selFg : C.fg, { bold: on, bg: on ? C.selBg : '' });
                        cv.hits.push([a.x, yy + i, a.w, { menu: i }]);
                    });
                    cv.text(a.x + 1, a.y + a.h - 1, `btop v${VERSION}`, C.gtext);
                } else if (o.kind === 'options') {
                    const a = panel(cv, 56, OPTS.length + 5, 'options');
                    OPTS.forEach(([name, , get], i) => {
                        const on = o.i === i, v = `< ${get()} >`, bg = on ? C.selBg : '';
                        if (on) for (let k = 0; k < a.w; k++) cv.put(a.x + k, a.y + i, ' ', '', bg);
                        cv.text(a.x + 1, a.y + i, name, on ? C.selFg : C.title, { bold: true, bg });
                        cv.text(a.x + a.w - 1 - v.length, a.y + i, v, on ? C.selFg : C.fg, { bg });
                        cv.hits.push([a.x, a.y + i, a.w, { opt: i }]);
                    });
                    cv.text(a.x + 1, a.y + OPTS.length + 1, OPTS[o.i][1], C.fg, { max: a.x + a.w });
                    cv.text(a.x + 1, a.y + OPTS.length + 2, '↑↓:選ぶ  ←→:変える  Esc:閉じる', C.gtext, { max: a.x + a.w });
                } else if (o.kind === 'signal') {
                    const name = SIGNALS.find(([n]) => n === o.sig)[1];
                    const a = panel(cv, 40, 7, 'signal');
                    cv.text(a.x + 1, a.y, `Send signal: ${o.sig} (${name})`, C.title, { bold: true, max: a.x + a.w });
                    cv.text(a.x + 1, a.y + 1, `To PID: ${o.p.pid} (${o.p.name})?`, C.fg, { max: a.x + a.w });
                    [['Yes', 'y'], ['No', 'n']].forEach(([s, key], i) => {
                        const on = o.yes === !i, xx = a.x + (a.w >> 1) + (i ? 2 : -9);
                        cv.text(xx, a.y + 3, `[ ${pad(s, 3)} ]`, on ? C.selFg : C.fg, { bold: on, bg: on ? C.selBg : '' });
                        cv.hits.push([xx, a.y + 3, 7, key]);
                    });
                } else if (o.kind === 'pick') {
                    const a = panel(cv, 40, SIGNALS.length + 4, 'signals');
                    cv.text(a.x + 1, a.y, `To PID: ${o.p.pid} (${o.p.name})`, C.fg, { max: a.x + a.w });
                    SIGNALS.forEach(([n, name], i) => {
                        const on = o.i === i;
                        cv.text(a.x + 2, a.y + 1 + i, pad(`${padL(n, 2)}  ${name}`, a.w - 4), on ? C.selFg : C.fg, { bold: on, bg: on ? C.selBg : '' });
                        cv.hits.push([a.x, a.y + 1 + i, a.w, { pick: i }]);
                    });
                    cv.text(a.x + 1, a.y + a.h - 1, '↑↓:選ぶ  Enter:送る  Esc:やめる', C.gtext, { max: a.x + a.w });
                } else if (o.kind === 'error') {
                    const a = panel(cv, Math.max(...o.lines.map(width)) + 4, o.lines.length + 2, 'error');
                    o.lines.forEach((s, i) => cv.text(a.x + 1, a.y + i, s, i ? C.fg : C.hi, { bold: !i, max: a.x + a.w }));
                }
            };

            const draw = () => {
                const cols = scr.cols, rows = scr.rows, cv = new Canvas(cols, rows);
                if (cols < 30 || rows < 10) {
                    ['Terminal size too small:', `Width = ${cols} Height = ${rows}`, '', 'Needed for current config:', 'Width = 30 Height = 10'].forEach((s, i) => cv.text(Math.max(0, (cols - s.length) >> 1), Math.max(0, (rows - 5) >> 1) + i, s, i % 3 ? C.fg : C.title, { bold: !(i % 3) }));
                } else {
                    const r = layout(cols, rows);
                    if (r.cpu) drawCpu(cv, r.cpu);
                    if (r.mem) drawMem(cv, r.mem);
                    if (r.net) drawNet(cv, r.net);
                    if (r.proc) drawProc(cv, r.proc); else { view.list = sorted(); view.page = 1; }
                    if (ui.over) drawOver(cv);
                }
                hits = cv.hits;
                const out = cv.rows();
                out[rows - 1] += '<span class="cur"></span>';
                scr.draw(out);
            };

            // ---------- 操作 ----------
            const quit = (code = 0, msg = '') => { clearInterval(timer); saveConf(); scr.close(); if (msg) c.err(msg); resolve(code); };
            const target = () => view.list[ui.sel - 1] || now.list.find((p) => p.pid === ui.info);
            const send = (sig, p) => {
                ui.over = null;
                if (p.pid === SELF) { if (sig < 18) quit(128 + sig, { 1: 'ハングアップ\n', 9: '強制終了\n', 15: '終了しました\n' }[sig] || ''); return; }
                ui.over = { kind: 'error', lines: [`Failed to send ${SIGNALS.find(([n]) => n === sig)[1]} to PID ${p.pid}!`, 'Insufficient permissions to send signal!', '', `kill: (${p.pid}) - 許可されていない操作です`] };
            };
            const overKey = (key) => {
                const o = ui.over, close = () => { ui.over = null; };
                if (key === '^c') return quit();
                if (o.kind === 'help' || o.kind === 'error') return close();
                if (key === 'Escape' || key === 'q' || (key === 'm' && o.kind === 'menu')) return close();
                const step = (n) => { o.i = (o.i + (key === 'Up' ? n - 1 : 1)) % n; };
                if (o.kind === 'menu') {
                    if (key === 'Up' || key === 'Down') step(MENU.length);
                    else if (key === 'Enter') { if (o.i === 2) return quit(); ui.over = o.i ? { kind: 'help' } : { kind: 'options', i: 0 }; }
                } else if (o.kind === 'options') {
                    if (key === 'Up' || key === 'Down') step(OPTS.length);
                    else if (key === 'Left' || key === 'Right' || key === 'Enter' || key === ' ') OPTS[o.i][3](key === 'Left' ? -1 : 1);
                } else if (o.kind === 'signal') {
                    if (key === 'Left' || key === 'Right' || key === 'Tab') o.yes = !o.yes;
                    else if (key === 'y' || (key === 'Enter' && o.yes)) send(o.sig, o.p);
                    else if (key === 'n' || key === 'Enter') close();
                } else if (o.kind === 'pick') {
                    if (key === 'Up' || key === 'Down') step(SIGNALS.length);
                    else if (key === 'Enter') send(SIGNALS[o.i][0], o.p);
                }
            };
            const act = (key, k = {}) => {
                if (ui.over) return overKey(key);
                if (key === '^c') return quit();
                if (ui.typing) {
                    if (key === 'Enter' || key === 'Down') ui.typing = false;
                    else if (key === 'Escape') { ui.typing = false; ui.filter = ''; } else if (key === 'Backspace') ui.filter = [...ui.filter].slice(0, -1).join('');
                    else if (k.text) ui.filter += k.text;
                    ui.sel = Math.min(ui.sel, 1);
                    return;
                }
                const n = view.list.length, p = target();
                switch (key) {
                    case 'q': return quit();
                    case 'Escape': case 'm': ui.over = { kind: 'menu', i: 0 }; break;
                    case 'h': case '?': ui.over = { kind: 'help' }; break;
                    case 'o': ui.over = { kind: 'options', i: 0 }; break;
                    case '1': case '2': case '3': case '4': { const b = BOXES[key - 1]; if (!ui.boxes.delete(b)) ui.boxes.add(b); else if (!ui.boxes.size) ui.boxes.add(b); break; }
                    case 'p': ui.boxes = new Set(PRESETS[(Number(presetName()) + 1 || 0) % PRESETS.length]); break;
                    case '+': case '=': ui.ms = clampMs(ui.ms + 100); break;
                    case '-': ui.ms = clampMs(ui.ms - 100); break;
                    case 'd': ui.disks = !ui.disks; break;
                    case 'z': ui.zero = ui.zero ? null : { down: total.down, up: total.up }; break;
                    case 'r': ui.reversed = !ui.reversed; break;
                    case 'e': ui.tree = !ui.tree; break;
                    case 'f': case '/': ui.typing = true; break;
                    case 'Delete': case 'Backspace': ui.filter = ''; break;
                    case 'Left': case 'Right': OPTS[2][3](key === 'Left' ? -1 : 1); break;
                    case 'Up': ui.sel = Math.max(0, ui.sel - 1); break;
                    case 'Down': ui.sel = Math.min(n, ui.sel + 1); break;
                    case 'PageUp': ui.sel = Math.max(1, ui.sel - view.page); break;
                    case 'PageDown': ui.sel = Math.min(n, Math.max(1, ui.sel) + view.page - (ui.sel ? 0 : 1)); break;
                    case 'Home': ui.sel = Math.min(n, 1); break;
                    case 'End': ui.sel = n; break;
                    case 'Enter': ui.info = ui.sel && view.list[ui.sel - 1].pid !== ui.info ? view.list[ui.sel - 1].pid : null; break;
                    case 't': case 'k': if (p) ui.over = { kind: 'signal', sig: key === 't' ? 15 : 9, p, yes: true }; break;
                    case 's': if (p) ui.over = { kind: 'pick', p, i: 3 }; break;
                    default:
                }
            };
            scr.onKey = (k) => { act(k.ctrl ? `^${k.key}` : k.key, k); draw(); };
            scr.onClick = (col, row) => {
                const hit = hits.findLast(([x, y, w]) => row === y && col >= x && col < x + w)?.[3];
                if (hit == null) { if (ui.over) act('Escape'); else return; } else if (typeof hit === 'string') act(hit);
                else if ('row' in hit) { if (ui.sel === hit.row) act('Enter'); else ui.sel = hit.row; } else {
                    // メニューや一覧は、押した行を選んでから決定する
                    ui.over.i = hit.menu ?? hit.opt ?? hit.pick;
                    act('Enter');
                }
                draw();
            };
            scr.onWheel = (dir) => { act(dir > 0 ? 'Down' : 'Up'); draw(); };
            scr.onResize = () => draw();
            const timer = setInterval(() => {
                const t = Date.now(), sec = Math.floor(t / 1000);
                if (t - last < ui.ms && sec === lastSec) return;
                if (t - last >= ui.ms) { sample(t, (t - last) / 1000); last = t; }
                lastSec = sec;
                draw();
            }, 100);
            draw();
        });
    }

    T.commands.btop = (c) => {
        const start = {};
        for (let i = 0; i < c.args.length; i++) {
            const a = c.args[i];
            if (a === '-h' || a === '--help') { c.out(USAGE); return 0; }
            if (a === '-v' || a === '--version') { c.out(`btop version: ${VERSION}\n`); return 0; }
            const v = Number(c.args[i + 1]);
            if ((a === '-p' || a === '--preset') && Number.isInteger(v) && v >= 0 && v < PRESETS.length) { start.preset = v; i++; }
            else if ((a === '-u' || a === '--update') && v > 0) { start.ms = v; i++; }
            else { c.err(`Unknown argument: ${a}\n${USAGE}`); return 1; }
        }
        if (!c.tty) { c.err('No tty detected!\nbtop needs an interactive shell to run.\n'); return 1; }
        return run(c, start);
    };
    T.docs.btop = {
        names: ['btop'], usage: 'btop [-p 番号] [-u ミリ秒]', desc: 'CPU・メモリ・通信・プロセスのようすをグラフで見る',
        more: '4 つの箱（cpu / mem / net / proc）で、計算機のようすをリアルタイムに表示します。\n\n  q 終了   h ヘルプ   Esc メニュー   o 設定   1〜4 箱の出し入れ   + - 更新間隔\n  ↑↓ プロセスを選ぶ   ←→ 並べかえ   r 逆順   e ツリー   f 絞りこみ   Enter 詳細\n  t / k / s  選んだプロセスにシグナルを送る\n\n枠の見出しやプロセスの行は、マウスやタップでも押せます。\n設定は終了するときに ~/.config/btop/btop.conf に保存されます（vim で書きかえても反映されます）。\n\n負荷は時計に合わせて変わります。sunspotd は昼休みに、meteor-watch は夜に忙しくなります。',
    };
})();
