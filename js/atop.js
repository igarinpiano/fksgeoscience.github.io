// atop（システムとプロセスの活動モニタ）。js/term-cmds.js のあとに読み込みます。
// 一定の間隔ごとに「そのあいだに何が起きたか」を表示します。最初の画面だけは、起動してからの積算です。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { HOST } = T;
    const { pad, padL, line } = T.util;
    const S = T.sys;
    const VERSION = '2.8.1';
    const SELF = 4131;
    // 負荷 1%・1 秒あたりに読み書きするバイト数（[読む, 書く]）。撮像と重ねあわせだけがディスクを使う
    const IO = { 600: [900, 80], 678: [0, 400], 1050: [0, 50], 2025: [0, 20] };
    const p2 = (n) => String(n).padStart(2, '0');
    const cpustr = (s) => (s < 60 ? `${s.toFixed(2)}s` : s < 3600 ? `${Math.floor(s / 60)}m${p2(Math.floor(s % 60))}s` : s < 360000 ? `${Math.floor(s / 3600)}h${p2(Math.floor(s % 3600 / 60))}m` : `${Math.floor(s / 86400)}d${p2(Math.floor(s % 86400 / 3600))}h`);
    const memstr = (k) => {
        let a = Math.abs(k), u = 0;
        while (a >= 10000 && u < 3) { a /= 1024; u++; }
        return (k <= -0.5 ? '-' : '') + (!u || a >= 1000 ? Math.round(a) : a.toFixed(1)) + 'KMGT'[u];
    };
    const M = (k) => `${(k / 1024).toFixed(1)}M`;
    const cnt = (n) => { let e = 0; n = Math.round(n); while (n >= 1e6 || (e && n >= 1e4)) { n = Math.round(n / 1000); e += 3; } return e ? `${n}e${e}` : String(n); };
    const span = (s) => { s = Math.round(s); const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; return `${d ? `${d}d` : ''}${d || h ? `${h}h` : ''}${d || h || m ? `${m}m` : ''}${s % 60}s`; };
    const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`; };
    const hms = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

    // 列: [幅, 右寄せ, 値]。幅 0 は、残りをぜんぶ使う列
    const COLS = {
        PID: [5, 1, (r) => r.pid], PPID: [5, 1, (r) => r.ppid], NPROCS: [6, 1, (r) => r.n],
        SYSCPU: [6, 1, (r) => cpustr(r.sys)], USRCPU: [6, 1, (r) => cpustr(r.usr)],
        VGROW: [6, 1, (r) => memstr(r.rgrow * 4.2)], RGROW: [6, 1, (r) => memstr(r.rgrow)], VSIZE: [6, 1, (r) => memstr(r.rsize * 4.2)], RSIZE: [6, 1, (r) => memstr(r.rsize)], VSTEXT: [6, 1, (r) => memstr(r.rsize * 0.08)],
        RDDSK: [6, 1, (r) => memstr(r.rd)], WRDSK: [6, 1, (r) => memstr(r.wr)], WCANCL: [6, 1, () => '0K'], MINFLT: [6, 1, (r) => cnt(r.flt)], MAJFLT: [6, 1, () => 0],
        RUID: [8, 0, (r) => r.user], EUID: [8, 0, (r) => r.user], RGID: [8, 0, (r) => r.user], ST: [2, 0, (r) => r.st], EXC: [3, 1, () => '-'], THR: [3, 1, (r) => r.threads], S: [1, 0, (r) => r.state], CPUNR: [5, 1, () => 0],
        TRUN: [4, 1, (r) => +(r.state === 'R')], TSLPI: [5, 1, (r) => r.threads - (r.state === 'R')], TSLPU: [5, 1, () => 0], POLI: [4, 0, () => 'norm'], NICE: [4, 1, (r) => r.ni], PRI: [3, 1, (r) => 120 + r.ni], RTPR: [4, 1, () => 0],
        STDATE: [10, 0, (r) => day(r.born)], STTIME: [8, 0, (r) => hms(r.born)], PCT: [4, 1, (r) => `${r.pct}%`], CMD: [0, 0, (r) => r.name], 'COMMAND-LINE': [0, 0, (r) => r.cmd],
    };
    const VIEWS = {
        g: ['PID', 'SYSCPU', 'USRCPU', 'VGROW', 'RGROW', 'RDDSK', 'WRDSK', 'RUID', 'EUID', 'ST', 'EXC', 'THR', 'S', 'CPUNR', 'PCT', 'CMD'],
        m: ['PID', 'MINFLT', 'MAJFLT', 'VSTEXT', 'VSIZE', 'RSIZE', 'VGROW', 'RGROW', 'RUID', 'EUID', 'PCT', 'CMD'],
        d: ['PID', 'RDDSK', 'WRDSK', 'WCANCL', 'PCT', 'CMD'],
        s: ['PID', 'TRUN', 'TSLPI', 'TSLPU', 'POLI', 'NICE', 'PRI', 'RTPR', 'CPUNR', 'ST', 'EXC', 'S', 'PCT', 'CMD'],
        v: ['PID', 'PPID', 'RUID', 'RGID', 'STDATE', 'STTIME', 'ST', 'EXC', 'S', 'PCT', 'CMD'],
        c: ['PID', 'S', 'PCT', 'COMMAND-LINE'],
        u: ['NPROCS', 'SYSCPU', 'USRCPU', 'VSIZE', 'RSIZE', 'RDDSK', 'WRDSK', 'RUID', 'PCT'],
        p: ['NPROCS', 'SYSCPU', 'USRCPU', 'VSIZE', 'RSIZE', 'RDDSK', 'WRDSK', 'PCT', 'CMD'],
    };
    // 画面がせまいときに落とす順
    const DROP = ['EUID', 'RGID', 'CPUNR', 'THR', 'RUID', 'EXC', 'ST', 'RTPR', 'POLI', 'TSLPU', 'MAJFLT', 'VSTEXT', 'WCANCL', 'VGROW', 'STDATE', 'RDDSK', 'PPID', 'TSLPI', 'TRUN', 'MINFLT', 'RGROW', 'NICE', 'PRI', 'WRDSK', 'VSIZE', 'STTIME', 'SYSCPU', 'S', 'USRCPU', 'RSIZE'];
    const SORTS = { C: ['CPU', (r) => r.sys + r.usr], M: ['MEM', (r) => r.rsize], D: ['DSK', (r) => r.rd + r.wr] };
    const HELP = [
        ['g', '一般（既定）'], ['m', 'メモリ'], ['d', 'ディスク'], ['s', 'スケジューリング'], ['v', 'いろいろ（親・開始時刻）'], ['c', 'コマンドライン'], ['u', 'ユーザーごとの合計'], ['p', 'プログラムごとの合計'],
        ['C M D A', 'CPU・メモリ・ディスクで並べる／おまかせ'], ['a', '動きのなかったプロセスも表示する・しない'], ['U  P', 'ユーザー名・プロセス名を正規表現で絞る'],
        ['t', 'いますぐ次の計測をする'], ['i', '計測の間隔を変える'], ['z', '一時停止・再開'], ['r', '起動してからの積算にもどす'],
        ['↑ ↓', '前後のページ（Ctrl-B / Ctrl-F、PgUp / PgDn）'], ['k', 'プロセスにシグナルを送る'], ['V', 'バージョン'], ['h  ?', 'このヘルプ'], ['q', '終了'],
    ];
    const USAGE = `Usage: atop [-flags] [interval [samples]]\n\n    interval   計測の間隔（秒）。省くと 10 秒\n    samples    この回数だけ計測して終了する\n\n    -V         バージョンを表示して終了する\n    -a         動きのなかったプロセスも表示する\n    -g -m -d -s -v -c -u -p   プロセスの表示を選ぶ（一般・メモリ・ディスク・スケジューリング・いろいろ・コマンドライン・ユーザー別・プログラム別）\n    -C -M -D -A               並べかえ（CPU・メモリ・ディスク・おまかせ）\n\n起動したら、h か ? でキーの一覧が出ます。\n`;

    // from〜to のあいだに起きたことを数える。boot なら、起動してからの積算
    function measure(tasks, from, to, boot) {
        const el = (to - from) / 1000, steps = Math.max(1, Math.min(600, Math.round(el)));
        const rss = (p, ms) => p.mem / 100 * S.memK * (IO[p.pid] ? 1 + 0.02 * (S.noise(p.pid + 7, (ms - S.since) / 30000) - 0.5) : 1);
        const rows = tasks.map((p) => {
            let work = 0;       // 負荷(%) × 秒
            if (boot) work = S.cputime(p, to) * 100; else for (let i = 0; i < steps; i++) work += S.load(p.pid, from + (i + 0.5) * (to - from) / steps) * el / steps;
            const [r = 0, w = 0] = IO[p.pid] || [], rsize = rss(p, to), fresh = boot || p.born > from;
            return { ...p, n: 1, sys: work / 400, usr: work / 133.33, rd: work * r / 1024, wr: work * w / 1024, rsize, rgrow: fresh ? rsize : rsize - rss(p, from), flt: work * 6, ni: S.nice[p.pid] || 0, st: !boot && p.born > from ? 'N-' : '--', state: p.pid === SELF || S.load(p.pid, to) >= 5 ? 'R' : 'S' };
        });
        const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
        let net = { down: 5800 * el, up: 1900 * el };
        if (!boot) { net = { down: 0, up: 0 }; for (let i = 0; i < steps; i++) { const n = S.traffic(from + (i + 0.5) * (to - from) / steps); net.down += n.down * el / steps; net.up += n.up * el / steps; } }
        return { from, to, el, boot, rows, net, sys: sum((r) => r.sys) + el * 0.001, usr: sum((r) => r.usr) + el * 0.003, rd: sum((r) => r.rd), wr: sum((r) => r.wr), mem: S.mem(to), lav: S.lav(tasks, to) };
    }

    // 上半分（システム全体）。行ごとに [ラベル, [[名前, 値], ...]]
    function system(s) {
        const { el, mem, net } = s, sys = Math.round(s.sys / el * 100), usr = Math.round(s.usr / el * 100), busy = sys + usr;
        const threads = s.rows.reduce((n, r) => n + r.threads, 0), run = s.rows.filter((r) => r.state === 'R').length;
        const nr = Math.round(s.rd / 16), nw = Math.round(s.wr / 8), pin = net.down / 700, pout = net.up / 420;
        return [
            ['PRC', [['sys', cpustr(s.sys)], ['user', cpustr(s.usr)], ['#proc', s.rows.length], ['#trun', run], ['#tslpi', threads - run], ['#tslpu', 0], ['#zombie', 0], ['clones', cnt(el / 500)], ['#exit', 0]]],
            ['CPU', [['sys', `${sys}%`], ['user', `${usr}%`], ['irq', '0%'], ['idle', `${100 - busy}%`], ['wait', '0%'], ['steal', '0%'], ['guest', '0%'], ['curf', '98MHz'], ['curscal', '100%']]],
            ['CPL', [['avg1', s.lav.toFixed(2)], ['avg5', '0.31'], ['avg15', '0.27'], ['csw', cnt(el * (180 + busy * 9))], ['intr', cnt(el * (260 + busy * 4))], ['numcpu', 1]]],
            ['MEM', [['tot', M(S.memK)], ['free', M(mem.free)], ['cache', M(mem.cached - 512)], ['buff', '0.5M'], ['slab', '4.1M'], ['shmem', '0.5M'], ['vmbal', '0.0M'], ['hptot', '0.0M']]],
            ['SWP', [['tot', '0.0M'], ['free', '0.0M'], null, ['vmcom', M(mem.used * 1.09)], ['vmlim', M(S.memK / 2)]]],
            ['DSK', [['', 'dome1'], ['busy', `${Math.min(100, Math.round((nr * 0.4 + nw * 0.6) / el / 10))}%`], ['read', cnt(nr)], ['write', cnt(nw)], ['KiB/r', nr ? 16 : 0], ['KiB/w', nw ? 8 : 0], ['MBr/s', (s.rd / 1024 / el).toFixed(1)], ['MBw/s', (s.wr / 1024 / el).toFixed(1)], ['avio', nr + nw ? '0.52 ms' : '0.00 ms']]],
            ['NET', [['transport', ''], ['tcpi', cnt(pin * 0.8)], ['tcpo', cnt(pout * 0.85)], ['udpi', cnt(pin * 0.2)], ['udpo', cnt(pout * 0.15)], ['tcpao', cnt(el / 600)], ['tcppo', 0], ['tcprs', 0]]],
            ['NET', [['network', ''], ['ipi', cnt(pin)], ['ipo', cnt(pout)], ['ipfrw', 0], ['deliv', cnt(pin)]]],
            ['NET', [['eth0', `${Math.round(Math.max(net.down, net.up) * 8 / el / 1e6)}%`], ['pcki', cnt(pin)], ['pcko', cnt(pout)], ['sp', '100 Mbps'], ['si', `${Math.round(net.down * 8 / el / 1000)} Kbps`], ['so', `${Math.round(net.up * 8 / el / 1000)} Kbps`], ['erri', 0], ['erro', 0], ['drpi', 0], ['drpo', 0]]],
        ];
    }
    // どの行も同じ幅のマスに入れる。マスが余ったら空けておき、null のところで間をあける
    const sysRow = ([label, cells], cols) => {
        const n = Math.max(1, Math.floor((cols - 5) / 15)), w = Math.floor((cols - 5) / n), lp = (w - 15) >> 1, real = cells.filter(Boolean);
        const shown = real.length <= n ? cells.flatMap((x) => x ? [x] : Array(n - real.length).fill(['', ''])) : real.slice(0, n);
        while (shown.length < n) shown.push(['', '']);
        return `${label} |` + shown.map(([name, value]) => `${pad(`${' '.repeat(lp + 1)}${name}${padL(String(value), Math.max(0, 12 - name.length))}`, w - 2).slice(0, w - 2)} |`).join('');
    };

    // 画面 1 枚ぶんを、[文字列, クラス] の並びの行として組み立てる
    function frame(s, ui, cols, rowsMax) {
        const out = [];
        const flags = [ui.all ? 'a' : '-', ui.user ? 'U' : '-', ui.name ? 'P' : '-', '-', ui.sort === 'A' ? 'A' : '-', '-', ui.paused ? 'z' : '-'].join('').padEnd(14, '-');
        let parts = [`ATOP - ${HOST}`, `${day(s.to)}  ${hms(s.to)}`, flags, `${span(s.el)} elapsed`];
        if (parts.join('   ').length > cols) parts.splice(2, 1);
        if (parts.join('  ').length > cols) parts[1] = hms(s.to);
        const gaps = parts.length - 1, room = Math.max(gaps, cols - parts.reduce((n, x) => n + x.length, 0));
        out.push([[parts.map((x, i) => (i ? ' '.repeat(Math.floor(room / gaps) + (i <= room % gaps)) : '') + x).join('')]]);
        let lines = system(s);
        if (rowsMax < 20) lines = lines.filter(([label, cells]) => label !== 'SWP' && cells[0][0] !== 'transport' && cells[0][0] !== 'network');
        if (rowsMax < 14) lines = lines.slice(0, 4);
        for (const l of lines) out.push([[sysRow(l, cols)]]);
        out.push(ui.prompt ? [[ui.prompt.text], [ui.prompt.buf], ['<span class="cur"> </span>', '', 1]] : [[ui.msg, 'bo']]);

        // プロセスの一覧
        const auto = ui.sort === 'A', [head, key] = SORTS[auto ? 'C' : ui.sort], io = s.rd + s.wr;
        const share = (r) => (head === 'CPU' ? (r.sys + r.usr) / s.el * 100 : head === 'MEM' ? r.rsize / S.memK * 100 : io ? (r.rd + r.wr) / io * 100 : 0);
        let list = s.rows.filter((r) => (ui.all || r.sys + r.usr >= 0.005 || r.rd + r.wr >= 0.5 || Math.abs(r.rgrow) >= 0.5) && (!ui.user || ui.user.test(r.user)) && (!ui.name || ui.name.test(r.name)));
        if (ui.view === 'u' || ui.view === 'p') {
            const groups = new Map();
            for (const r of list) {
                const k = ui.view === 'u' ? r.user : r.name, g = groups.get(k);
                if (!g) groups.set(k, { ...r }); else for (const f of ['n', 'sys', 'usr', 'rsize', 'rd', 'wr']) g[f] += r[f];
            }
            list = [...groups.values()];
        }
        list = list.map((r) => ({ ...r, pct: Math.round(share(r)) })).sort((a, b) => key(b) - key(a) || a.pid - b.pid);
        let on = VIEWS[ui.view].slice();
        const flex = COLS[on[on.length - 1]][0] === 0, fixed = () => on.reduce((n, id) => n + (COLS[id][0] ? COLS[id][0] + 1 : 0), 0);
        for (const id of DROP) { if (fixed() + (flex ? 12 : 0) <= cols) break; if (ui.view !== 'u' || id !== 'RUID') on = on.filter((x) => x !== id); }
        const body = Math.max(1, rowsMax - out.length - 1), pages = Math.max(1, Math.ceil(list.length / body));
        ui.page = Math.max(0, Math.min(ui.page, pages - 1));
        const mark = `${ui.page + 1}/${pages}`, rest = Math.max(0, cols - fixed());
        out.push(on.map((id) => {
            const [w, r] = COLS[id], name = id === 'PCT' ? (auto ? 'A' : '') + head : id;
            if (!w) return [pad(name, Math.max(0, rest - mark.length - 1)) + mark, 'bo'];
            return [`${r ? padL(name, w) : pad(name, w)} `, id === 'PCT' ? 'f14 bo' : 'bo'];
        }));
        if (!flex) out[out.length - 1].push([padL(mark, Math.max(0, rest - 1)), 'bo']);
        for (const r of list.slice(ui.page * body, ui.page * body + body)) out.push([[on.map((id) => { const [w, right, get] = COLS[id], v = String(get(r)); return !w ? v : `${right ? padL(v, w) : pad(v.slice(0, w), w)} `; }).join('')]]);
        return out;
    }
    const plain = (rows) => rows.map((segs) => segs.filter((x) => !x[2]).map((x) => x[0]).join('').trimEnd()).join('\n');

    function run(c, opt) {
        return new Promise((resolve) => {
            const scr = c.term.openScreen();
            const tasks = S.tasks(SELF, ['atop', ...c.args].join(' '));
            const ui = { view: opt.view, sort: opt.sort, all: opt.all, interval: opt.interval, page: 0, user: null, name: null, paused: false, msg: '', prompt: null, help: false };
            let now = measure(tasks, S.since, Date.now(), true), count = 1, timer = 0;

            const draw = () => {
                const cols = scr.cols, rows = scr.rows;
                let out;
                if (ui.help) {
                    out = [[[`atop ${VERSION}`, 'bo'], [' — 地学會ターミナル版（本物の atop を模したものです）']], [], ...HELP.map(([k, desc]) => [[` ${pad(k, 9)}`, 'f14 bo'], [desc]]), [],
                        [['上半分はシステム全体、下半分はプロセスごとの、計測の間隔のあいだの動きです。']], [['最初の画面だけは、起動してからの積算です。'], ['  なにかキーを押すと戻ります。', 'bo']]];
                } else out = frame(now, ui, cols, rows);
                const html = out.slice(0, rows).map((segs) => line(segs, cols));
                while (html.length < rows) html.push(line([], cols));
                if (!ui.prompt || ui.help) html[rows - 1] += '<span class="cur"></span>';
                scr.draw(html);
            };
            const quit = (code = 0, msg = '') => { clearInterval(timer); scr.close(); if (msg) c.err(msg); resolve(code); };
            const next = (boot = false) => {
                const t = Date.now();
                if (!boot && t - now.to < 1000) return;
                now = measure(tasks, boot ? S.since : now.to, t, boot);
                if (opt.samples && ++count > opt.samples) quit();
            };
            const ask = (text, done) => { ui.prompt = { text, buf: '', done }; };
            const regex = (v, name) => { try { ui[name] = v ? new RegExp(v) : null; } catch { ui.msg = 'Invalid regular expression!'; } ui.page = 0; };
            const kill = (pid, sig) => {
                if (!tasks.some((p) => p.pid === pid)) ui.msg = `kill: (${pid}) - そのようなプロセスはありません`;
                else if (pid !== SELF) ui.msg = `kill: (${pid}) - 許可されていない操作です`;
                else if (sig < 17) quit(128 + sig, { 1: 'ハングアップ\n', 9: '強制終了\n', 15: '終了しました\n' }[sig] || '');
            };
            const act = (key, k) => {
                if (key === '^c') return quit();
                if (ui.help) { ui.help = false; return; }
                const p = ui.prompt;
                if (p) {
                    if (key === 'Enter') { ui.prompt = null; p.done(p.buf.trim()); } else if (key === 'Escape') ui.prompt = null;
                    else if (key === 'Backspace') p.buf = [...p.buf].slice(0, -1).join('');
                    else if (k.text) p.buf += k.text;
                    return;
                }
                ui.msg = '';
                switch (key) {
                    case 'q': return quit();
                    case 'g': case 'm': case 'd': case 's': case 'v': case 'c': case 'u': case 'p':
                        ui.view = key; ui.page = 0;
                        if (ui.sort !== 'A' && 'gmd'.includes(key)) ui.sort = { g: 'C', m: 'M', d: 'D' }[key];
                        break;
                    case 'C': case 'M': case 'D': case 'A': ui.sort = key; ui.page = 0; break;
                    case 'n': case 'N': ui.msg = "Kernel module 'netatop' not active; request ignored!"; break;
                    case 'a': ui.all = !ui.all; ui.page = 0; break;
                    case 't': next(); break;
                    case 'r': next(true); break;
                    case 'z': ui.paused = !ui.paused; break;
                    case 'i': ask(`New interval in seconds (now ${ui.interval}): `, (v) => { if (/^\d+$/.test(v) && Number(v) > 0) ui.interval = Math.min(3600, Number(v)); else if (v) ui.msg = 'Invalid interval!'; }); break;
                    case 'U': ask('Username as regular expression (enter=all users): ', (v) => regex(v, 'user')); break;
                    case 'P': ask('Process-name as regular expression (enter=no regex): ', (v) => regex(v, 'name')); break;
                    case 'k': ask('Pid of process: ', (v) => { if (/^\d+$/.test(v)) ask('Signal [15]: ', (sig) => kill(Number(v), /^\d+$/.test(sig) ? Number(sig) : 15)); else if (v) ui.msg = 'Invalid PID!'; }); break;
                    case 'V': ui.msg = `Version: ${VERSION}（地学會ターミナル版）`; break;
                    case 'h': case '?': ui.help = true; break;
                    case 'Down': case 'PageDown': case '^f': ui.page++; break;
                    case 'Up': case 'PageUp': case '^b': ui.page--; break;
                    default:
                }
            };
            scr.onKey = (k) => { act(k.ctrl ? `^${k.key}` : k.key, k); draw(); };
            scr.onClick = () => { if (ui.help) { ui.help = false; draw(); } };
            scr.onWheel = (dir) => { ui.page += dir; draw(); };
            scr.onResize = () => draw();
            timer = setInterval(() => { if (!ui.paused && !ui.prompt && Date.now() - now.to >= ui.interval * 1000) { next(); draw(); } }, 200);
            draw();
        });
    }

    T.commands.atop = (c) => {
        const opt = { view: 'g', sort: 'C', all: false, interval: 10, samples: 0 };
        const nums = [];
        for (const a of c.args) {
            if (/^\d+$/.test(a) && Number(a) > 0) { nums.push(Number(a)); continue; }
            if (a === '-V') { c.out(`Version: ${VERSION}（地学會ターミナル版）\n`); return 0; }
            if (!/^-[agmdsvcupCMDA]+$/.test(a)) { c.err(USAGE); return a === '-h' || a === '--help' ? 0 : 1; }
            for (const f of a.slice(1)) { if (f === 'a') opt.all = true; else if ('CMDA'.includes(f)) opt.sort = f; else { opt.view = f; if (opt.sort !== 'A' && 'gmd'.includes(f)) opt.sort = { g: 'C', m: 'M', d: 'D' }[f]; } }
        }
        if (nums.length > 2) { c.err(USAGE); return 1; }
        if (nums[0]) opt.interval = Math.min(3600, nums[0]);
        if (nums[1]) opt.samples = nums[1];
        // 端末でなければ、起動してからの積算を 1 回だけ文字で出す
        if (!c.tty) { c.out(`${plain(frame(measure(S.tasks(SELF, 'atop'), S.since, Date.now(), true), { ...opt, page: 0, msg: '' }, 80, Infinity))}\n`); return 0; }
        return run(c, opt);
    };
    T.docs.atop = {
        names: ['atop'], usage: 'atop [-agmdsvcupCMDA] [間隔 [回数]]', desc: 'システムとプロセスの動きを、間隔ごとにまとめて見る',
        more: '上半分にシステム全体（PRC・CPU・CPL・MEM・SWP・DSK・NET）、下半分にプロセスごとの動きが出ます。\n最初の画面は起動してからの積算で、そのあとは間隔（既定は 10 秒）ごとの差分です。\n動きのなかったプロセスは出ません（a で全部）。\n\n  g 一般   m メモリ   d ディスク   s スケジューリング   v いろいろ   c コマンドライン   u ユーザー別   p プログラム別\n  C M D A 並べかえ   t すぐ計測   i 間隔   z 一時停止   r 積算にもどす   ↑↓ ページ   k シグナル   h ヘルプ   q 終了\n\nパイプにつなぐと、積算を 1 回だけ文字で出して終わります（例: atop | head -12）。\n\n本物の atop ではなく、よく使う操作を再現したものです。数字は btop・htop と同じものを見ています。',
    };
})();
