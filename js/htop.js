// htop（プロセスビューア）。js/term-cmds.js のあとに読み込みます。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { HOME, USER } = T;
    const { pad, padL, line, getopt } = T.util;
    const S = T.sys;
    const VERSION = '3.2.2';
    const RC = `${HOME}/.config/htop/htoprc`;
    const SELF = 4130;
    const p2 = (n) => String(n).padStart(2, '0');
    const kb = (k) => (k < 10000 ? String(Math.round(k)) : k < 102400 ? `${(k / 1024).toFixed(1)}M` : `${Math.round(k / 1024)}M`);
    const clock = (s) => {
        const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s) % 60;
        return h >= 100 ? `${Math.floor(h / 24)}d${p2(h % 24)}h` : h ? `${h}h${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}.${p2(Math.floor(s * 100) % 100)}`;
    };
    // 列。no は htoprc に書く番号、drop は画面がせまいときに落とす順（小さいものから）
    const FIELDS = [
        { id: 'PID', no: 0, head: 'PID', w: 5, r: 1, drop: 99, get: (p) => p.pid },
        { id: 'USER', no: 48, head: 'USER', w: 9, drop: 6, get: (p) => p.user },
        { id: 'PRIORITY', no: 17, head: 'PRI', w: 3, r: 1, drop: 2, get: (p) => 20 + p.ni },
        { id: 'NICE', no: 18, head: 'NI', w: 3, r: 1, drop: 3, get: (p) => p.ni },
        { id: 'M_VIRT', no: 38, head: 'VIRT', w: 5, r: 1, desc: 1, drop: 4, get: (p) => p.res * 4.2, show: kb },
        { id: 'M_RESIDENT', no: 39, head: 'RES', w: 5, r: 1, desc: 1, drop: 8, get: (p) => p.res, show: kb },
        { id: 'M_SHARE', no: 40, head: 'SHR', w: 5, r: 1, desc: 1, drop: 1, get: (p) => p.res * 0.3, show: kb },
        { id: 'STATE', no: 2, head: 'S', w: 1, drop: 7, get: (p) => p.st },
        { id: 'PERCENT_CPU', no: 46, head: 'CPU%', w: 4, r: 1, desc: 1, drop: 99, get: (p) => p.cpu, show: (v) => v.toFixed(1) },
        { id: 'PERCENT_MEM', no: 47, head: 'MEM%', w: 4, r: 1, desc: 1, drop: 9, get: (p) => p.mem, show: (v) => v.toFixed(1) },
        { id: 'TIME', no: 49, head: 'TIME+', w: 9, r: 1, desc: 1, drop: 5, get: (p) => p.time, show: clock },
        { id: 'COMM', no: 1, head: 'Command', get: (p) => p.cmd },
    ];
    const field = (id) => FIELDS.find((f) => f.id === id);
    const SIGNALS = [[0, 'Cancel'], [1, 'SIGHUP'], [2, 'SIGINT'], [3, 'SIGQUIT'], [4, 'SIGILL'], [5, 'SIGTRAP'], [6, 'SIGABRT'], [7, 'SIGBUS'], [8, 'SIGFPE'], [9, 'SIGKILL'], [10, 'SIGUSR1'],
        [11, 'SIGSEGV'], [12, 'SIGUSR2'], [13, 'SIGPIPE'], [14, 'SIGALRM'], [15, 'SIGTERM'], [17, 'SIGCHLD'], [18, 'SIGCONT'], [19, 'SIGSTOP'], [20, 'SIGTSTP']];
    const DIED = { 1: 'ハングアップ\n', 3: '終了 (コアダンプ)\n', 6: '中止 (コアダンプ)\n', 9: '強制終了\n', 11: 'Segmentation fault (コアダンプ)\n', 14: '目覚まし時計\n', 15: '終了しました\n' };
    const FKEYS = [['F1', 'Help'], ['F2', 'Setup'], ['F3', 'Search'], ['F4', 'Filter'], ['F5', 'Tree'], ['F6', 'SortBy'], ['F7', 'Nice -'], ['F8', 'Nice +'], ['F9', 'Kill'], ['F10', 'Quit']];
    const OPTS = [
        ['tree', 'Tree view', 'プロセスを親子の木として表示する'], ['shadow', "Shadow other users' processes", 'ほかのユーザーのプロセスを暗くする'],
        ['hideThreads', 'Hide userland process threads', 'スレッド（緑の行）を隠す'], ['base', 'Highlight program "basename"', 'コマンドのうち、プログラム名のところを目立たせる'],
        ['path', 'Show program path', 'プログラムのパスも表示する'], ['mono', 'Monochromatic color scheme', '色を使わない'],
    ];
    const RC_KEYS = { hide_userland_threads: 'hideThreads', shadow_other_users: 'shadow', highlight_base_name: 'base', show_program_path: 'path', tree_view: 'tree', color_scheme: 'mono' };
    const HELP = [
        ['↑ ↓ PgUp PgDn', '一覧を動かす（Home / End で先頭・末尾）'], ['F3  /', 'コマンド名で検索する'], ['F4  \\', '絞りこむ（Esc で解除）'], ['F5  t', 'ツリー表示を切りかえる'],
        ['F6  < >', '並べかえる列を選ぶ'], ['P M T N', 'CPU% / MEM% / TIME+ / PID で並べる'], ['I', '逆順にする'], ['u', 'ユーザーで絞る'], ['H', 'スレッドを隠す・出す'],
        ['p', 'プログラムのパスを隠す・出す'], ['Space  U', '印をつける・すべて外す'], ['F', '選んだプロセスを追いかける'], ['Z', '更新を止める・再開する'],
        ['F7 ]  F8 [', '優先度を上げる・下げる（上げられるのは root だけ）'], ['F9  k', 'シグナルを送る'], ['F2  S', '設定'], ['F1  h ?', 'このヘルプ'], ['F10  q', '終了'],
    ];
    const USAGE = `htop ${VERSION}\nUsage: htop [-dCthV] [-d DELAY] [-u USER] [-p PID,...] [-s COLUMN]\n\n-C --no-color                   色を使わない\n-d --delay=DELAY                更新間隔を 1/10 秒単位で指定する（1〜100）\n-h --help                       このヘルプを表示して終了する\n-p --pid=PID[,PID,PID...]       指定した PID だけを表示する\n-s --sort-key=COLUMN            並べかえる列（-s help で一覧）\n-t --tree                       ツリー表示で起動する\n-u --user=USERNAME              指定したユーザーのプロセスだけを表示する\n-V --version                    バージョンを表示して終了する\n\n起動したら、F1 か h でキーの一覧が出ます。\n`;
    const SHAPE = { I: ['<b class="bv"></b>', 1], T: ['<b class="lt"></b><b class="bh"></b>', 2], L: ['<b class="bl"></b><b class="bh"></b>', 2] };
    const CUR = ['<span class="cur"> </span>', '', 1];

    function run(c, opt) {
        return new Promise((resolve) => {
            const scr = c.term.openScreen();
            scr.fkeys = true;
            const tasks = S.tasks(SELF, ['htop', ...c.args].join(' '));
            const ui = { tree: false, shadow: false, hideThreads: false, base: false, path: true, mono: false, sort: 'PERCENT_CPU', invert: false, delay: 15, user: null, filter: '', search: '', typing: null, sel: 0, top: 0, follow: null, paused: false, panel: null, page: null, opt: 0, tagged: new Set() };
            let rows = [], meters = {}, list = [], pageRows = 1, hits = [];

            // ---------- 設定ファイル（~/.config/htop/htoprc） ----------
            const rcText = () => {
                const f = field(ui.sort);
                return [
                    '# Beware! This file is rewritten by htop when settings are changed in the interface.', '# The parser is also very primitive, and not human-friendly.', `htop_version=${VERSION}`, 'config_reader_min_version=3',
                    `fields=${FIELDS.slice(0, -1).map((x) => x.no).join(' ')} 1`, `hide_userland_threads=${+ui.hideThreads}`, `shadow_other_users=${+ui.shadow}`, `highlight_base_name=${+ui.base}`, `show_program_path=${+ui.path}`,
                    `tree_view=${+ui.tree}`, `sort_key=${f.no}`, `sort_direction=${(f.desc ? -1 : 1) * (ui.invert ? -1 : 1)}`, `color_scheme=${+ui.mono}`, `delay=${ui.delay}`, '',
                ].join('\n');
            };
            const rc = c.fs.get(RC);
            if (rc?.t === 'f') {
                const kv = Object.fromEntries([...rc.data.matchAll(/^(\w+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
                for (const [k, name] of Object.entries(RC_KEYS)) if (k in kv) ui[name] = kv[k] === '1';
                const f = FIELDS.find((x) => String(x.no) === kv.sort_key);
                if (f) { ui.sort = f.id; ui.invert = Number(kv.sort_direction || 0) === (f.desc ? 1 : -1); }
                if (/^\d+$/.test(kv.delay || '')) ui.delay = Math.max(1, Math.min(100, Number(kv.delay)));
            }
            const saveRc = () => {
                const text = rcText();
                if (c.fs.get(RC)?.data === text) return;
                c.fs.mkdirp(`${HOME}/.config/htop`, USER, true);
                c.fs.write(RC, text);
            };
            if (opt.tree) ui.tree = true;
            if (opt.mono) ui.mono = true;
            if (opt.sort) { ui.sort = opt.sort; ui.invert = false; ui.tree = false; }
            if (opt.delay) ui.delay = opt.delay;
            if (opt.user) ui.user = opt.user;

            // ---------- 計測 ----------
            const sample = () => {
                const ms = Date.now();
                rows = tasks.flatMap((p) => {
                    const cpu = S.load(p.pid, ms), time = S.cputime(p, ms), n = p.threads - 1;
                    const row = { ...p, own: p.pid, cpu, time, ni: S.nice[p.pid] || 0, res: p.mem / 100 * S.memK, st: p.pid === SELF || cpu >= 5 ? 'R' : 'S' };
                    // スレッドは、プロセスの負荷の 6 割を分けあう
                    return [row, ...Array.from({ length: n }, (_, i) => ({ ...row, pid: p.pid + 1 + i, ppid: p.pid, thread: true, cpu: cpu * 0.6 / n, time: time * 0.6 / n, st: cpu * 0.6 / n >= 5 ? 'R' : 'S' }))];
                });
                const main = rows.filter((p) => !p.thread), cpu = S.total(tasks, ms), nice = Math.min(cpu, main.reduce((s, p) => s + (p.ni > 0 ? p.cpu : 0), 0));
                meters = { ms, cpu, nice, sys: (cpu - nice) * 0.25, user: (cpu - nice) * 0.75, mem: S.mem(ms), lav: S.lav(tasks, ms), procs: main.length, thr: rows.length - main.length, run: rows.filter((p) => p.st === 'R').length };
            };
            const build = () => {
                const f = ui.filter.toLowerCase();
                const shown = rows.filter((p) => !(ui.hideThreads && p.thread) && (!ui.user || p.user === ui.user) && (!opt.pids || opt.pids.includes(p.own)) && (!f || p.cmd.toLowerCase().includes(f)));
                if (!ui.tree) {
                    const fld = field(ui.sort), dir = (fld.desc ? -1 : 1) * (ui.invert ? -1 : 1);
                    return shown.sort((a, b) => { const u = fld.get(a), v = fld.get(b); return (u < v ? -1 : u > v ? 1 : 0) * dir || a.pid - b.pid; });
                }
                const out = [];
                const walk = (p, pre, last, depth) => {
                    out.push({ ...p, pre: depth ? pre + (last ? 'L' : 'T') : '' });
                    const kids = shown.filter((q) => q.ppid === p.pid);
                    kids.forEach((q, i) => walk(q, depth ? pre + (last ? ' ' : 'I') : '', i === kids.length - 1, depth + 1));
                };
                shown.sort((a, b) => a.pid - b.pid);
                for (const root of shown.filter((p) => !shown.some((q) => q.pid === p.ppid))) walk(root, '', true, 0);
                return out;
            };

            // ---------- 描画 ----------
            // 色を使わない設定では、背景色は反転に、文字色はなしにする
            const K = (cls) => (!ui.mono || !cls ? cls : [...new Set(cls.split(' ').map((k) => (k[0] === 'g' ? 'iv' : k[0] === 'f' ? '' : k)).filter(Boolean))].join(' '));
            const L = (segs, fill = '') => line(segs.map(([s, cls, raw]) => [s, K(cls || ''), raw]), scr.cols, K(fill));
            const BAR = 'g6 f0', HEAD = 'g2 f0';
            // [||||||      12.3%] のメーター。parts は [割合, クラス] の並びで、右はしの文字は下のバーの色になる
            const meter = (label, w, parts, text) => {
                const n = Math.max(0, w - 5);
                let used = 0;
                const ends = parts.map(([f, cls]) => [Math.round((used += f) * n), cls]);
                const ch = Array.from({ length: n }, (_, i) => (i < Math.round(used * n) ? '|' : ' '));
                [...text].forEach((t, i) => { const at = n - text.length + i; if (at >= 0) ch[at] = t; });
                const segs = [[padL(label, 3), 'f6'], ['[', 'bo']];
                ch.forEach((x, i) => { const cls = ends.find(([e]) => i < e)?.[1] ?? 'f8 bo', last = segs[segs.length - 1]; if (segs.length > 2 && last[1] === cls) last[0] += x; else segs.push([x, cls]); });
                return [...segs, [']', 'bo']];
            };
            const header = (cols) => {
                const m = meters, up = Math.floor((m.ms - S.since) / 1000), days = Math.floor(up / 86400), K1 = S.memK;
                const bars = (w) => [
                    meter('0', w, [[m.nice / 100, 'f12'], [m.user / 100, 'f2'], [m.sys / 100, 'f1']], `${m.cpu.toFixed(1)}%`),
                    meter('Mem', w, [[m.mem.used / K1, 'f2'], [512 / K1, 'f12'], [(m.mem.cached - 512) / K1, 'f3']], `${kb(m.mem.used)}/${kb(K1)}`),
                    meter('Swp', w, [], '0K/0K'),
                ];
                const texts = [
                    [['Tasks: ', 'f6'], [String(m.procs), 'f14 bo'], [', ', 'f6'], [String(m.thr), ui.hideThreads ? 'f8 bo' : 'f10 bo'], [' thr', ui.hideThreads ? 'f8 bo' : 'f2'], ['; ', 'f6'], [String(m.run), 'f10 bo'], [' running', 'f6']],
                    [['Load average: ', 'f6'], [`${m.lav.toFixed(2)} `, 'f15 bo'], ['0.31 ', 'f14 bo'], ['0.27', 'f6']],
                    [['Uptime: ', 'f6'], [`${days} days${days > 100 ? '(!)' : ''}, ${p2(Math.floor(up / 3600) % 24)}:${p2(Math.floor(up / 60) % 60)}:${p2(up % 60)}`, 'f14 bo']],
                ];
                if (cols < 60) return [...bars(cols - 2).map((b) => [[' '], ...b]), ...texts.map((t) => [[' '], ...t])];
                const lw = cols >> 1;
                return bars(lw - 2).map((b, i) => [[' '], ...b, ['  '], ...texts[i]]);
            };
            const fit = (w) => { const on = FIELDS.slice(0, -1); while (on.length > 2 && on.reduce((s, f) => s + f.w + 1, 0) + 14 > w) on.splice(on.indexOf(on.reduce((a, b) => (b.drop < a.drop ? b : a))), 1); return on; };
            const rowSegs = (p, on, over) => {
                const k = (cls) => over ?? cls, tcls = p.thread ? 'f2' : '';
                const segs = on.map((f) => { const v = String(f.show ? f.show(f.get(p)) : f.get(p)); return [`${f.r ? padL(v, f.w) : pad(v.slice(0, f.w), f.w)} `, k(f.id === 'STATE' && p.st === 'R' ? 'f10 bo' : '')]; });
                for (const ch of p.pre || '') {
                    if (ch === ' ') { segs.push(['   ', k('')]); continue; }
                    segs.push([...SHAPE[ch].slice(0, 1), k('f6'), SHAPE[ch][1]], [ch === 'I' ? '  ' : ' ', k('')]);
                }
                const first = p.cmd.split(' ')[0], at = first.lastIndexOf('/') + 1;
                if (ui.path && at) segs.push([first.slice(0, at), k(tcls)]);
                segs.push([first.slice(at), k(ui.base && !p.thread ? 'f14 bo' : tcls)], [p.cmd.slice(first.length), k(tcls)]);
                return segs;
            };
            const bottom = (out, items, tail = []) => {
                // せまい画面では 2 段にして、タップで押せるようにする
                const y0 = out.length, per = scr.cols >= 80 || items.length <= 5 ? items.length : 5, lines = scr.cols >= 80 ? 1 : 2;
                for (let n = 0; n < lines; n++) {
                    const segs = [];
                    let x = 0;
                    for (const [key, label, on] of items.slice(n * per, (n + 1) * per)) {
                        const w = /^F\d/.test(key) ? 6 : 8;
                        segs.push([key, ''], [pad(label, w), on ? 'g3 f0 bo' : BAR]);
                        hits.push([x, y0 + n, key.length + w, key]);
                        x += key.length + w;
                    }
                    out.push(L(n ? segs : [...segs, ...tail], BAR));
                }
            };
            const pageHelp = (out, cols) => {
                const two = cols >= 130, half = two ? Math.ceil(HELP.length / 2) : HELP.length;
                out.push(L([[`htop ${VERSION}`, 'f14 bo'], [' — 地学會ターミナル版（本物の htop を模したものです）', 'f6']]), L([]),
                    L([['CPU usage bar: ', 'f6'], ['[', 'bo'], ['low-priority', 'f12'], ['/'], ['normal', 'f2'], ['/'], ['kernel', 'f1'], ['        used%', 'f8 bo'], [']', 'bo']]),
                    L([['Memory bar:    ', 'f6'], ['[', 'bo'], ['used', 'f2'], ['/'], ['buffers', 'f12'], ['/'], ['cache', 'f3'], ['          used/total', 'f8 bo'], [']', 'bo']]),
                    L([['Status: ', 'f6'], ['R', 'f10 bo'], [': 実行中  '], ['S', 'bo'], [': 待機中    緑の行はスレッドです']]), L([]));
                for (let i = 0; i < half; i++) {
                    const segs = [[` ${pad(HELP[i][0], 16)}`, 'f14 bo'], [pad(HELP[i][1], two ? (cols >> 1) - 18 : 0)]];
                    if (two && HELP[i + half]) segs.push([pad(HELP[i + half][0], 16), 'f14 bo'], [HELP[i + half][1]]);
                    out.push(L(segs));
                }
                out.push(L([]), L([['下の F1〜F10 は、クリックやタップでも押せます。'], ['  なにかキーを押すと戻ります。', 'f14 bo']]));
            };
            const pageSetup = (out) => {
                out.push(L([['Setup — Display options', HEAD]], HEAD));
                OPTS.forEach(([key, name], i) => {
                    const on = ui.opt === i;
                    hits.push([0, out.length, scr.cols, { opt: i }]);
                    out.push(L([[`[${ui[key] ? 'x' : ' '}] `, on ? BAR : 'f14 bo'], [name, on ? BAR : '']], on ? BAR : ''));
                });
                out.push(L([]), L([[OPTS[ui.opt][2], 'f6']]));
            };
            const draw = () => {
                const cols = scr.cols, total = scr.rows, out = [], barH = cols >= 80 ? 1 : 2;
                hits = [];
                list = build();
                if (ui.follow != null) { const i = list.findIndex((p) => p.pid === ui.follow); if (i >= 0) ui.sel = i; }
                ui.sel = Math.max(0, Math.min(ui.sel, list.length - 1));
                if (ui.page) {
                    (ui.page === 'help' ? pageHelp : pageSetup)(out, cols);
                    out.length = Math.min(out.length, total - barH);
                    while (out.length < total - barH) out.push(L([]));
                    bottom(out, ui.page === 'help' ? [['Esc', 'Done']] : [['Space', 'Toggle'], ['Esc', 'Done']]);
                } else {
                    for (const segs of header(cols)) out.push(L(segs));
                    if (total >= 20) out.push(L(ui.paused ? [[' '.repeat(Math.max(0, cols - 9))], ['[PAUSED]', 'f11 bo']] : []));
                    const pn = ui.panel, pw = !pn ? 0 : cols < 44 ? 16 : 20, on = fit(cols - pw), y0 = out.length;
                    pageRows = Math.max(1, total - y0 - 1 - barH);
                    if (ui.sel < ui.top) ui.top = ui.sel;
                    if (ui.sel >= ui.top + pageRows) ui.top = ui.sel - pageRows + 1;
                    ui.top = Math.max(0, Math.min(ui.top, list.length - pageRows));
                    if (pn) pn.top = Math.max(Math.min(pn.top || 0, pn.i), pn.i - pageRows + 1, 0);
                    // 左に選択肢のパネルがあるときは、そのぶん一覧を右に寄せる
                    const side = (i) => {
                        if (!pn) return [];
                        if (i < 0) return [[pad(pn.title, pw - 1), HEAD], [' ', '']];
                        const it = pn.items[pn.top + i];
                        if (it) hits.push([0, y0 + 1 + i, pw - 1, { pick: pn.top + i }]);
                        return [[pad(it ? it[0] : '', pw - 1), it && pn.top + i === pn.i ? BAR : ''], [' ', '']];
                    };
                    let x = pw;
                    const head = on.map((f) => { hits.push([x, y0, f.w + 1, { sort: f.id }]); x += f.w + 1; return [`${f.r ? padL(f.head, f.w) : pad(f.head, f.w)} `, f.id === ui.sort && !ui.tree ? BAR : HEAD]; });
                    hits.push([x, y0, cols - x, { sort: 'COMM' }]);
                    out.push(L([...side(-1), ...head, ['Command', ui.sort === 'COMM' && !ui.tree ? BAR : HEAD]], HEAD));
                    for (let i = 0; i < pageRows; i++) {
                        const p = list[ui.top + i];
                        if (!p) { out.push(L(side(i))); continue; }
                        const sel = ui.top + i === ui.sel, over = sel ? (ui.follow != null ? 'g3 f0' : BAR) : ui.tagged.has(p.pid) ? 'f11 bo' : ui.shadow && p.user !== USER ? 'f8 bo' : undefined;
                        hits.push([pw, out.length, cols - pw, { row: ui.top + i }]);
                        out.push(L([...side(i), ...rowSegs(p, on, over)], sel ? over : ''));
                    }
                    if (pn) bottom(out, [['Enter', pn.ok], ['Esc', 'Cancel']]);
                    else if (ui.typing) bottom(out, ui.typing === 'search' ? [['F3', 'Next'], ['Esc', 'Cancel']] : [['Enter', 'Done'], ['Esc', 'Clear']], [[ui.typing === 'search' ? '  Search: ' : '  Filter: ', BAR], [ui[ui.typing], BAR], CUR]);
                    else bottom(out, FKEYS.map(([key, label]) => (key === 'F5' && ui.tree ? [key, 'List'] : key === 'F4' && ui.filter ? [key, 'FILTER', true] : [key, label])));
                }
                if (!out.some((h) => h.includes('class="cur"'))) out[out.length - 1] += '<span class="cur"></span>';
                scr.draw(out);
            };

            // ---------- 操作 ----------
            let timer = 0;
            const quit = (code = 0, msg = '') => { clearInterval(timer); saveRc(); scr.close(); if (msg) c.err(msg); resolve(code); };
            const targets = () => { const tagged = list.filter((p) => ui.tagged.has(p.pid)); return tagged.length ? tagged : list[ui.sel] ? [list[ui.sel]] : []; };
            const move = (to) => { ui.sel = Math.max(0, Math.min(list.length - 1, to)); ui.follow = null; };
            const sortBy = (id) => { if (ui.sort === id && !ui.tree) ui.invert = !ui.invert; else { ui.sort = id; ui.invert = false; } ui.tree = false; };
            const renice = (d) => {
                // 優先度を上げる（nice 値を下げる）のは root だけ。自分のプロセスなら下げられる
                const mine = d > 0 ? targets().filter((p) => p.user === USER && (S.nice[p.own] || 0) < 19) : [];
                if (!mine.length) return c.term.bell?.();
                for (const pid of new Set(mine.map((p) => p.own))) S.nice[pid] = (S.nice[pid] || 0) + 1;
                sample();
            };
            const kill = (sig) => {
                if (!sig) return;
                if (targets().some((p) => p.own === SELF) && sig < 17) return quit(128 + sig, DIED[sig] || '');
                if (targets().some((p) => p.own !== SELF)) c.term.bell?.();
                ui.tagged.clear();
            };
            const find = (from) => { const s = ui.search.toLowerCase(); if (!s) return; for (let n = 0; n < list.length; n++) { const i = (from + n) % list.length; if (list[i].cmd.toLowerCase().includes(s)) return move(i); } };
            const choose = (title, ok, items, i, done) => { ui.panel = { title, ok, items, i: Math.max(0, i), done }; };
            const act = (key, k = {}) => {
                if (key === '^c') return quit();
                if (ui.page === 'help') { ui.page = null; return; }
                if (ui.page === 'setup') {
                    if (key === 'Up' || key === 'Down') ui.opt = (ui.opt + (key === 'Up' ? OPTS.length - 1 : 1)) % OPTS.length;
                    else if (key === ' ' || key === 'Enter') ui[OPTS[ui.opt][0]] = !ui[OPTS[ui.opt][0]];
                    else if (key === 'Escape' || key === 'q' || key === 'F10' || key === 'F2') ui.page = null;
                    return;
                }
                const pn = ui.panel;
                if (pn) {
                    if (key === 'Up') pn.i = Math.max(0, pn.i - 1);
                    else if (key === 'Down') pn.i = Math.min(pn.items.length - 1, pn.i + 1);
                    else if (key === 'PageUp' || key === 'Home') pn.i = 0;
                    else if (key === 'PageDown' || key === 'End') pn.i = pn.items.length - 1;
                    else if (key === 'Enter') { ui.panel = null; pn.done(pn.items[pn.i][1]); } else if (key === 'Escape' || key === 'q' || key === 'F10') ui.panel = null;
                    return;
                }
                if (ui.typing) {
                    const name = ui.typing;
                    if (key === 'Enter' || (key === 'Escape' && name === 'search')) ui.typing = null;
                    else if (key === 'Escape') { ui.typing = null; ui.filter = ''; } else if (key === 'F3' && name === 'search') find(ui.sel + 1);
                    else if (key === 'Up' || key === 'Down') move(ui.sel + (key === 'Up' ? -1 : 1));
                    else if (key === 'Backspace' || k.text) {
                        ui[name] = k.text ? ui[name] + k.text : [...ui[name]].slice(0, -1).join('');
                        if (name === 'filter') ui.sel = 0; else { list = build(); find(0); }
                    }
                    return;
                }
                switch (key) {
                    case 'q': case 'F10': return quit();
                    case 'Up': move(ui.sel - 1); break;
                    case 'Down': move(ui.sel + 1); break;
                    case 'PageUp': move(ui.sel - pageRows); break;
                    case 'PageDown': move(ui.sel + pageRows); break;
                    case 'Home': move(0); break;
                    case 'End': move(list.length - 1); break;
                    case 'F1': case 'h': case '?': ui.page = 'help'; break;
                    case 'F2': case 'S': case 'C': ui.page = 'setup'; break;
                    case 'F3': case '/': ui.typing = 'search'; ui.search = ''; break;
                    case 'F4': case '\\': ui.typing = 'filter'; break;
                    case 'F5': case 't': ui.tree = !ui.tree; break;
                    case 'F6': case '<': case '>': case ',': case '.': choose('Sort by', 'Sort', FIELDS.map((f) => [f.head, f.id]), FIELDS.findIndex((f) => f.id === ui.sort), (id) => { ui.sort = id; ui.invert = false; ui.tree = false; }); break;
                    case 'F7': case ']': renice(-1); break;
                    case 'F8': case '[': renice(1); break;
                    case 'F9': case 'k': if (targets().length) choose('Send signal:', 'Send', SIGNALS.map(([n, name]) => [`${padL(n, 2)} ${name}`, n]), 15, kill); break;
                    case 'P': sortBy('PERCENT_CPU'); break;
                    case 'M': sortBy('PERCENT_MEM'); break;
                    case 'T': sortBy('TIME'); break;
                    case 'N': sortBy('PID'); break;
                    case 'I': ui.invert = !ui.invert; break;
                    case 'u': choose('Show processes of:', 'Show', [['All users', null], ...[...new Set(rows.map((p) => p.user))].sort().map((u) => [u, u])], 0, (u) => { ui.user = u; ui.sel = 0; }); break;
                    case 'H': ui.hideThreads = !ui.hideThreads; break;
                    case 'p': ui.path = !ui.path; break;
                    case 'F': ui.follow = ui.follow == null && list[ui.sel] ? list[ui.sel].pid : null; break;
                    case 'Z': ui.paused = !ui.paused; break;
                    case ' ': { const p = list[ui.sel]; if (p) { if (!ui.tagged.delete(p.pid)) ui.tagged.add(p.pid); move(ui.sel + 1); } break; }
                    case 'U': ui.tagged.clear(); break;
                    default:
                }
            };
            scr.onKey = (k) => { act(k.ctrl ? `^${k.key}` : k.key, k); draw(); };
            scr.onClick = (col, row) => {
                const hit = hits.findLast(([x, y, w]) => row === y && col >= x && col < x + w)?.[3];
                if (hit == null) { if (ui.page !== 'help') return; act('Escape'); } else if (typeof hit === 'string') act(hit === 'Esc' ? 'Escape' : hit === 'Space' ? ' ' : hit);
                else if ('row' in hit) move(hit.row);
                else if ('sort' in hit) sortBy(hit.sort);
                else if ('opt' in hit) { ui.opt = hit.opt; act(' '); } else { ui.panel.i = hit.pick; act('Enter'); }
                draw();
            };
            scr.onWheel = (dir) => { act(dir > 0 ? 'Down' : 'Up'); draw(); };
            scr.onResize = () => draw();
            let last = Date.now();
            timer = setInterval(() => { const t = Date.now(); if (ui.paused || t - last < ui.delay * 100) return; last = t; sample(); draw(); }, 100);
            sample();
            draw();
        });
    }

    T.commands.htop = (c) => {
        const { o, rest } = getopt(c.args, 'd:u:p:s:');
        const known = new Set(['d', 'u', 'p', 's', 'C', 't', 'h', 'V', 'delay', 'user', 'pid', 'sort-key', 'no-color', 'tree', 'help', 'version']);
        const bad = Object.keys(o).find((k) => !known.has(k));
        if (bad || rest.length) { c.err(bad ? `htop: 無効なオプション -- '${bad}'\n${USAGE}` : `htop: 余分な引数です: ${rest[0]}\n${USAGE}`); return 1; }
        if (o.h || o.help) { c.out(USAGE); return 0; }
        if (o.V || o.version) { c.out(`htop ${VERSION}\n`); return 0; }
        const opt = { tree: !!(o.t || o.tree), mono: !!(o.C || o['no-color']) };
        const sort = o.s ?? o['sort-key'], delay = o.d ?? o.delay, user = o.u ?? o.user, pids = o.p ?? o.pid;
        if (sort === 'help') { c.out(FIELDS.map((f) => `${pad(f.id, 12)} ${f.head}\n`).join('')); return 0; }
        if (sort != null) { opt.sort = field(String(sort).toUpperCase())?.id; if (!opt.sort) { c.err(`Error: invalid column "${sort}".\n`); return 1; } }
        if (delay != null) { opt.delay = Math.round(Number(delay)); if (!(opt.delay >= 1 && opt.delay <= 100)) { c.err(`Error: invalid delay value "${delay}".\n`); return 1; } }
        if (user != null) { if (!/^(root|gonzalez)$/.test(user) && user !== USER) { c.err(`Error: invalid user "${user}".\n`); return 1; } opt.user = user; }
        if (pids != null) opt.pids = String(pids).split(',').map(Number);
        if (!c.tty) { c.err('Error opening terminal: unknown.\n'); return 1; }
        return run(c, opt);
    };
    T.docs.htop = {
        names: ['htop'], usage: 'htop [-Ct] [-d 間隔] [-u ユーザー] [-p PID,...] [-s 列]', desc: 'プロセスを一覧して操作する',
        more: '上にメーター（CPU・メモリ・スワップ）、下にプロセスの一覧が出ます。緑の行はスレッドです。\n\n  ↑↓ 選ぶ   F3 / 検索   F4 \\ 絞りこみ   F5 t ツリー   F6 並べかえ   F9 k シグナル   F10 q 終了\n  P M T  CPU% / MEM% / TIME+ で並べる   I 逆順   u ユーザー   H スレッド   Space 印   F1 h ヘルプ   F2 S 設定\n\n下に並んだ F1〜F10 や列の見出しは、マウスやタップでも押せます。\nF8（Nice +）で自分のプロセスの優先度を下げられます。上げるのとシグナルは、権限がないので通りません。\n設定は終了するときに ~/.config/htop/htoprc に保存されます。\n\n本物の htop ではなく、よく使う操作を再現したものです。数字は btop・atop と同じものを見ています。',
    };
})();
