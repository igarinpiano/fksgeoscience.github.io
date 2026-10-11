// 地学會ターミナルのコマンド群。js/term.js のあとに読み込みます。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { HOME, USER, HOST, E, Interrupt } = T;
    const { width, cells, ansi, pad, padL, stripAnsi, columns } = T.util;
    const SINCE = Date.parse('2026-04-15T00:00:00+09:00');

    // def(名前, 書式, 一行説明, 実装, 補足)。書式と説明は man / help / --help が使う
    const def = (names, usage, desc, fn, more = '') => {
        names = [].concat(names);
        for (const n of names) T.commands[n] = fn;
        T.docs[names[0]] = { usage, desc, more, names };
    };
    // 短いオプションをまとめて解釈する。spec の "n:" は値を取るオプション
    function getopt(args, spec = '') {
        const o = {}, rest = [];
        const takes = new Set((spec.match(/(\w):/g) || []).map((s) => s[0]));
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '--') { rest.push(...args.slice(i + 1)); break; }
            if (a.startsWith('--') && a.length > 2) { const [k, v] = a.slice(2).split(/=(.*)/s); o[k] = v ?? true; continue; }
            if (a.startsWith('-') && a.length > 1) {
                for (let j = 1; j < a.length; j++) {
                    const f = a[j];
                    if (takes.has(f)) { o[f] = a.slice(j + 1) || args[++i] || ''; break; }
                    o[f] = true;
                }
                continue;
            }
            rest.push(a);
        }
        return { o, rest };
    }
    // ファイル（なければ標準入力）を読む。読めなかったものはエラーを出して飛ばす
    function inputs(c, files) {
        if (!files.length) return [{ name: '', data: c.stdin ?? '' }];
        const out = [];
        for (const f of files) {
            if (f === '-') { out.push({ name: '-', data: c.stdin ?? '' }); continue; }
            const abs = c.path(f), n = c.fs.get(abs);
            if (!n) c.err(`${c.name}: ${f}: ${E.NOENT}\n`);
            else if (n.t === 'd') c.err(`${c.name}: ${f}: ${E.ISDIR}\n`);
            else if (!c.fs.canRead(abs)) c.err(`${c.name}: ${f}: ${E.ACCES}\n`);
            else out.push({ name: f, data: n.url ? `[バイナリ: ${n.url} — open ${f} で開けます]\n` : n.data, bad: false });
        }
        return out;
    }
    const lines = (s) => { const a = s.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };
    const modeStr = (n) => (n.t === 'd' ? 'd' : '-') + [6, 3, 0].map((sh) => { const b = (n.mode >> sh) & 7; return (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-'); }).join('');
    const human = (n) => { if (n < 1024) return String(n); const u = 'KMGT'; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return (n < 10 ? n.toFixed(1) : Math.round(n)) + u[i]; };
    const p2 = (n) => String(n).padStart(2, '0');
    const lsDate = (ms) => { const d = new Date(ms); return Date.now() - ms > 180 * 864e5 ? `${padL(d.getMonth() + 1, 2)}月 ${padL(d.getDate(), 2)}  ${d.getFullYear()}` : `${padL(d.getMonth() + 1, 2)}月 ${padL(d.getDate(), 2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const paint = (name, n) => (n.t === 'd' ? `\x1b[1;34m${name}\x1b[0m` : n.mode & 0o111 ? `\x1b[1;32m${name}\x1b[0m` : /\.(png|jpe?g|gif|svg|pdf)$/i.test(name) ? `\x1b[1;35m${name}\x1b[0m` : name);
    const useColor = (c, o) => o.color === 'always' || (o.color && o.color !== 'never' && c.tty);
    const fullscreen = (c, setup) => new Promise((resolve) => { const scr = c.term.openScreen(); setup(scr, (code = 0) => { scr.close(); resolve(code); }); });
    // ANSI の色指定を保ったまま、表示幅で折り返す
    function wrap(line, cols) {
        const out = [];
        let cur = '', w = 0;
        for (const tok of line.match(/\x1b\[[0-9;]*m|[\s\S]/gu) || []) {
            if (tok.length > 1 && tok[0] === '\x1b') { cur += tok; continue; }
            const cw = T.util.cw(tok);
            if (w + cw > cols) { out.push(cur); cur = ''; w = 0; }
            cur += tok; w += cw;
        }
        out.push(cur);
        return out;
    }

    // ================= ファイル操作 =================
    def('ls', 'ls [-alAhRFtrS1d] [ファイル]...', 'ディレクトリの内容を一覧表示する', (c) => {
        const { o, rest } = getopt(c.args);
        const color = useColor(c, o);
        const targets = rest.length ? rest : ['.'];
        let code = 0, first = true;
        const show = (name, n) => (color ? paint(name, n) : name) + (o.F ? (n.t === 'd' ? '/' : n.mode & 0o111 ? '*' : '') : '');
        const order = (list) => {
            list.sort(([a, x], [b, y]) => (o.t ? y.mtime - x.mtime : o.S ? c.fs.size(y) - c.fs.size(x) : 0) || (a.replace(/^\./, '').toLowerCase() < b.replace(/^\./, '').toLowerCase() ? -1 : 1));
            return o.r ? list.reverse() : list;
        };
        const print = (list) => {
            if (!list.length) return;
            if (o.l) {
                const sz = list.map(([, n]) => (o.h ? human(c.fs.size(n)) : String(c.fs.size(n))));
                const w = Math.max(...sz.map((s) => s.length));
                c.out(list.map(([name, n], i) => `${modeStr(n)} ${n.t === 'd' ? 2 : 1} ${pad(n.owner, 4)} ${pad(n.owner, 4)} ${padL(sz[i], w)} ${lsDate(n.mtime)} ${show(name, n)}`).join('\n') + '\n');
            } else if (o['1'] || !c.tty) c.out(list.map(([name, n]) => show(name, n)).join('\n') + '\n');
            else c.out(columns(list.map(([name, n]) => show(name, n)), c.term.cols) + '\n');
        };
        const listDir = (label, abs, header) => {
            const dir = c.fs.get(abs);
            if (!c.fs.canRead(abs)) { c.err(`ls: ディレクトリ '${label}' を開くことが出来ません: ${E.ACCES}\n`); code = 2; return; }
            if (!first) c.out('\n');
            first = false;
            if (header) c.out(`${label}:\n`);
            let list = [...dir.c.entries()].filter(([n]) => o.a || o.A || !n.startsWith('.'));
            order(list);
            if (o.a) list = [['.', dir], ['..', c.fs.get(c.fs.split(abs)[0])], ...list];
            if (o.l) c.out(`合計 ${list.reduce((s, [, n]) => s + (n.t === 'd' ? 4 : Math.ceil(c.fs.size(n) / 4096) * 4), 0)}\n`);
            print(list);
            if (o.R) for (const [name, n] of list) if (n.t === 'd' && name !== '.' && name !== '..') listDir(`${label.replace(/\/$/, '')}/${name}`, `${abs === '/' ? '' : abs}/${name}`, true);
        };
        const files = [], dirs = [];
        for (const t of targets) {
            const abs = c.path(t), n = c.fs.get(abs);
            if (!n) { c.err(`ls: '${t}' にアクセスできません: ${E.NOENT}\n`); code = 2; } else if (n.t === 'd' && !o.d) dirs.push([t, abs]); else files.push([t, n]);
        }
        if (files.length) { print(order(files)); first = false; }
        for (const [t, abs] of dirs) listDir(t, abs, o.R || targets.length > 1);
        return code;
    });

    def('cat', 'cat [-n] [ファイル]...', 'ファイルを連結して標準出力に出す', (c) => {
        const { o, rest } = getopt(c.args);
        const ins = inputs(c, rest);
        let n = 0;
        for (const { data } of ins) c.out(o.n ? lines(data).map((l) => `${padL(++n, 6)}\t${l}`).join('\n') + (data ? '\n' : '') : data);
        return ins.length === Math.max(1, rest.length) ? 0 : 1;
    });
    def('tac', 'tac [ファイル]...', '行を逆順にして出力する', (c) => { for (const { data } of inputs(c, c.args)) c.out(lines(data).reverse().join('\n') + '\n'); });
    def('rev', 'rev [ファイル]...', '各行の文字を逆順にする', (c) => { for (const { data } of inputs(c, c.args)) c.out(lines(data).map((l) => [...l].reverse().join('')).join('\n') + '\n'); });
    def('nl', 'nl [ファイル]...', '行番号を付けて出力する', (c) => { let n = 0; for (const { data } of inputs(c, c.args)) c.out(lines(data).map((l) => (l ? `${padL(++n, 6)}\t${l}` : '')).join('\n') + '\n'); });
    const headTail = (tail) => (c) => {
        const { o, rest } = getopt(c.args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a)), 'n:');
        const n = o.n === undefined ? 10 : parseInt(o.n, 10);
        const ins = inputs(c, rest);
        ins.forEach(({ name, data }, i) => {
            if (rest.length > 1) c.out(`${i ? '\n' : ''}==> ${name} <==\n`);
            const ls = lines(data);
            const part = tail ? (String(o.n).startsWith('+') ? ls.slice(n - 1) : ls.slice(-n || ls.length)) : ls.slice(0, n);
            if (part.length) c.out(part.join('\n') + '\n');
        });
    };
    def('head', 'head [-n 行数] [ファイル]...', 'ファイルの先頭部分を出力する', headTail(false));
    def('tail', 'tail [-n 行数] [ファイル]...', 'ファイルの末尾部分を出力する', headTail(true));
    def('wc', 'wc [-lwcm] [ファイル]...', '行数・単語数・バイト数を数える', (c) => {
        const { o, rest } = getopt(c.args);
        const all = !(o.l || o.w || o.c || o.m);
        const rows = inputs(c, rest).map(({ name, data }) => [(data.match(/\n/g) || []).length, (data.match(/\S+/g) || []).length, new TextEncoder().encode(data).length, [...data].length, name]);
        if (rows.length > 1) rows.push([0, 1, 2, 3].map((i) => rows.reduce((s, r) => s + r[i], 0)).concat('合計'));
        for (const r of rows) c.out([(all || o.l) && r[0], (all || o.w) && r[1], (all || o.c) && r[2], o.m && r[3]].filter((v) => v !== false && v !== undefined).map((v) => padL(v, 7)).join(' ') + (r[4] ? ` ${r[4]}` : '') + '\n');
    });

    def('grep', 'grep [-invcrlwoEF] パターン [ファイル]...', 'パターンに一致する行を表示する', (c) => {
        const { o, rest } = getopt(c.args, 'e:');
        const pat = o.e ?? rest.shift();
        if (pat === undefined) { c.err('使用法: grep [OPTION]... PATTERNS [FILE]...\n詳細は `grep --help\' を実行して下さい。\n'); return 2; }
        let src = o.F ? pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : o.E ? pat : pat.replace(/\\([(){}|+?])|([(){}|+?])/g, (m, esc, raw) => esc ?? `\\${raw}`);
        if (o.w) src = `\\b(?:${src})\\b`;
        let re;
        try { re = new RegExp(src, o.i ? 'giu' : 'gu'); } catch { c.err(`grep: 正規表現が不正です: ${pat}\n`); return 2; }
        const color = useColor(c, o);
        let files = rest;
        if (o.r || o.R) {
            files = [];
            for (const t of rest.length ? rest : ['.']) c.fs.walk(c.path(t), (p, n) => { if (n.t === 'f' && !n.url) files.push(rest.length ? p.replace(c.path(t), t.replace(/\/$/, '')) : p.replace(`${c.path('.')}/`, '')); });
        }
        const multi = files.length > 1;
        let hits = 0;
        for (const { name, data } of inputs(c, files)) {
            let count = 0;
            const tag = multi ? (color ? `\x1b[35m${name}\x1b[36m:\x1b[0m` : `${name}:`) : '';
            lines(data).forEach((line, i) => {
                re.lastIndex = 0;
                const m = re.test(line);
                if (m === !!o.v) return;
                count++;
                if (o.c || o.l) return;
                const num = o.n ? (color ? `\x1b[32m${i + 1}\x1b[36m:\x1b[0m` : `${i + 1}:`) : '';
                if (o.o && !o.v) { for (const hit of line.match(re) || []) c.out(`${tag}${num}${color ? `\x1b[1;31m${hit}\x1b[0m` : hit}\n`); return; }
                c.out(`${tag}${num}${color && !o.v ? line.replace(re, (h) => (h ? `\x1b[1;31m${h}\x1b[0m` : h)) : line}\n`);
            });
            hits += count;
            if (o.c) c.out(`${multi ? `${name}:` : ''}${count}\n`);
            else if (o.l && count) c.out(`${name}\n`);
        }
        return hits ? 0 : 1;
    });

    def('sort', 'sort [-rnu] [ファイル]...', '行を並べ替える', (c) => {
        const { o, rest } = getopt(c.args);
        let ls = inputs(c, rest).flatMap(({ data }) => lines(data));
        ls.sort(o.n ? (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (o.u) ls = ls.filter((l, i) => i === 0 || l !== ls[i - 1]);
        if (o.r) ls.reverse();
        if (ls.length) c.out(ls.join('\n') + '\n');
    });
    def('uniq', 'uniq [-c] [ファイル]', '連続して重複する行をまとめる', (c) => {
        const { o, rest } = getopt(c.args);
        const out = [];
        for (const l of inputs(c, rest.slice(0, 1)).flatMap(({ data }) => lines(data))) { const last = out[out.length - 1]; if (last && last[0] === l) last[1]++; else out.push([l, 1]); }
        if (out.length) c.out(out.map(([l, n]) => (o.c ? `${padL(n, 7)} ${l}` : l)).join('\n') + '\n');
    });
    def('cut', 'cut -d 区切り -f 列 [ファイル]...', '各行から指定した列を切り出す', (c) => {
        const { o, rest } = getopt(c.args, 'd:f:c:');
        const pick = (arr, spec) => spec.split(',').flatMap((r) => { const [a, b] = r.split('-'); return r.includes('-') ? arr.slice((Number(a) || 1) - 1, b ? Number(b) : undefined) : [arr[Number(a) - 1]]; }).filter((v) => v !== undefined);
        if (!o.f && !o.c) { c.err('cut: バイト、文字、もしくはフィールドのリストを指定してください\n'); return 1; }
        for (const { data } of inputs(c, rest)) c.out(lines(data).map((l) => (o.c ? pick([...l], o.c).join('') : pick(l.split(o.d ?? '\t'), o.f).join(o.d ?? '\t'))).join('\n') + '\n');
    });
    def('tr', 'tr [-d] 文字集合1 [文字集合2]', '文字を置き換える・削除する', (c) => {
        const { o, rest } = getopt(c.args);
        const expand = (s) => [...(s || '').replace(/\[:upper:\]/g, 'A-Z').replace(/\[:lower:\]/g, 'a-z').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/(.)-(.)/gu, (m, a, b) => { let r = ''; for (let i = a.codePointAt(0); i <= b.codePointAt(0); i++) r += String.fromCodePoint(i); return r; })];
        const a = expand(rest[0]), b = expand(rest[1]);
        c.out([...(c.stdin ?? '')].map((ch) => { const i = a.indexOf(ch); return i < 0 ? ch : o.d ? '' : b[Math.min(i, b.length - 1)] ?? ch; }).join(''));
    });
    def('tee', 'tee [-a] ファイル...', '標準入力を標準出力とファイルの両方に書く', (c) => {
        const { o, rest } = getopt(c.args);
        for (const f of rest) { const fail = c.fs.write(c.path(f), c.stdin ?? '', { append: !!o.a }); if (fail) c.err(`tee: ${f}: ${fail}\n`); }
        c.out(c.stdin ?? '');
    });
    def('sed', "sed 's/パターン/置換/[g]' [ファイル]...", '行ごとに文字列を置換する（s コマンドのみ）', (c) => {
        const { o, rest } = getopt(c.args, 'e:');
        const script = o.e ?? rest.shift() ?? '';
        const m = script.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/);
        if (!m) { c.err(`sed: -e expression #1: 未知のコマンドです（この sed は s/…/…/ だけ対応）\n`); return 1; }
        let re;
        try { re = new RegExp(m[2].replace(/\\([()|+?])/g, '$1'), (m[4].includes('g') ? 'g' : '') + (m[4].includes('i') ? 'i' : '') + 'u'); } catch { c.err('sed: 正規表現が不正です\n'); return 1; }
        const rep = m[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&');
        for (const { data } of inputs(c, rest)) c.out(lines(data).map((l) => l.replace(re, rep)).join('\n') + (data ? '\n' : ''));
    });
    def('awk', "awk [-F 区切り] '{print $1, $2}' [ファイル]...", '列を取り出して表示する（print のみ）', (c) => {
        const { o, rest } = getopt(c.args, 'F:');
        const m = (rest.shift() || '').match(/^\s*\{\s*print\s*(.*?)\s*;?\s*\}\s*$/);
        if (!m) { c.err('awk: この awk は {print $N, ...} だけ対応しています\n'); return 2; }
        const items = m[1] ? m[1].split(/\s*,\s*/) : ['$0'];
        for (const { data } of inputs(c, rest)) c.out(lines(data).map((l) => { const f = o.F ? l.split(o.F) : l.trim().split(/\s+/); return items.map((it) => (it === '$0' ? l : it === '$NF' ? f[f.length - 1] : /^\$\d+$/.test(it) ? f[Number(it.slice(1)) - 1] ?? '' : it === 'NF' ? f.length : it.replace(/^"|"$/g, ''))).join(' '); }).join('\n') + '\n');
    });
    def('xargs', 'xargs コマンド [引数]...', '標準入力から引数を組み立ててコマンドを実行する', async (c) => {
        const words = (c.stdin ?? '').split(/\s+/).filter(Boolean).map((w) => `'${w.replace(/'/g, `'\\''`)}'`).join(' ');
        const buf = await c.sh.capture(`${c.args.length ? c.args.join(' ') : 'echo'} ${words}`);
        c.out(buf);
    });

    def('touch', 'touch ファイル...', 'ファイルの時刻を更新する（なければ空のファイルを作る）', (c) => {
        let code = 0;
        for (const f of getopt(c.args).rest) {
            const abs = c.path(f), n = c.fs.get(abs);
            if (n) { if (c.fs.canWrite(abs)) { n.mtime = Date.now(); n.u = n.u || n.t === 'f'; } else { c.err(`touch: '${f}' に touch できません: ${E.ACCES}\n`); code = 1; } continue; }
            const fail = c.fs.write(abs, '');
            if (fail) { c.err(`touch: '${f}' に touch できません: ${fail}\n`); code = 1; }
        }
        return code;
    });
    def('mkdir', 'mkdir [-p] ディレクトリ...', 'ディレクトリを作る', (c) => {
        const { o, rest } = getopt(c.args);
        if (!rest.length) { c.err('mkdir: オペランドがありません\n'); return 1; }
        let code = 0;
        for (const d of rest) {
            const abs = c.path(d), [parent] = c.fs.split(abs);
            const fail = c.fs.get(abs) ? (o.p ? null : E.EXIST) : !c.fs.canWrite(abs) ? E.ACCES : !o.p && !c.fs.get(parent) ? E.NOENT : null;
            if (fail) { c.err(`mkdir: ディレクトリ \`${d}' を作成できません: ${fail}\n`); code = 1; } else if (!c.fs.get(abs)) c.fs.mkdirp(abs, USER, true);
        }
        return code;
    });
    def('rmdir', 'rmdir ディレクトリ...', '空のディレクトリを削除する', (c) => {
        let code = 0;
        for (const d of c.args) {
            const abs = c.path(d), n = c.fs.get(abs);
            const fail = !n ? E.NOENT : n.t !== 'd' ? E.NOTDIR : n.c.size ? E.NOTEMPTY : c.fs.remove(abs);
            if (fail) { c.err(`rmdir: '${d}' を削除できません: ${fail}\n`); code = 1; }
        }
        return code;
    });
    def('rm', 'rm [-rf] ファイル...', 'ファイルやディレクトリを削除する', (c) => {
        const { o, rest } = getopt(c.args);
        const rec = o.r || o.R;
        if (!rest.length) { if (!o.f) c.err('rm: オペランドがありません\n'); return o.f ? 0 : 1; }
        let code = 0;
        for (const f of rest) {
            const abs = c.path(f), n = c.fs.get(abs);
            if (abs === '/') { c.err("rm: '/' に関して再帰的に操作することは危険です\nrm: --no-preserve-root を使用するとこの安全機能を無効にできます\n"); code = 1; continue; }
            const fail = !n ? (o.f ? null : E.NOENT) : n.t === 'd' && !rec ? E.ISDIR : c.fs.remove(abs);
            if (fail) { c.err(`rm: '${f}' を削除できません: ${fail}\n`); code = 1; }
        }
        return code;
    });
    const clone = (c, n) => (n.t === 'd' ? Object.assign(c.fs.dir(USER), { u: true, mtime: Date.now(), c: new Map([...n.c].map(([k, v]) => [k, clone(c, v)])) }) : Object.assign(c.fs.file(n.data, USER, n.mode), { u: true, mtime: Date.now(), url: n.url, size: n.size }));
    const cpmv = (move) => (c) => {
        const { o, rest } = getopt(c.args);
        const nm = move ? 'mv' : 'cp';
        if (rest.length < 2) { c.err(`${nm}: ${rest.length ? `'${rest[0]}' の後に宛先のファイルオペランドがありません` : 'ファイルオペランドがありません'}\n`); return 1; }
        const dest = rest.pop(), destAbs = c.path(dest), destNode = c.fs.get(destAbs);
        if (rest.length > 1 && destNode?.t !== 'd') { c.err(`${nm}: ターゲット '${dest}' はディレクトリではありません\n`); return 1; }
        let code = 0;
        for (const src of rest) {
            const abs = c.path(src), n = c.fs.get(abs);
            const to = destNode?.t === 'd' ? `${destAbs === '/' ? '' : destAbs}/${abs.split('/').pop()}` : destAbs;
            const [toDir, toName] = c.fs.split(to);
            const fail = !n ? E.NOENT : !move && n.t === 'd' && !(o.r || o.R || o.a) ? 'ディレクトリです（-r を指定してください）' : !c.fs.get(toDir) ? E.NOENT : !c.fs.canWrite(to) ? E.ACCES : move && !c.fs.canWrite(abs) ? E.ACCES : to === abs || to.startsWith(`${abs}/`) ? '自分自身の中にはコピー・移動できません' : null;
            if (fail) { c.err(`${nm}: '${src}' ${move ? 'を移動' : 'をコピー'}できません: ${fail}\n`); code = 1; continue; }
            if (move) c.fs.remove(abs);
            c.fs.get(toDir).c.set(toName, clone(c, n));
            c.fs.gone.delete(to);
        }
        return code;
    };
    def('cp', 'cp [-r] コピー元... コピー先', 'ファイルやディレクトリをコピーする', cpmv(false));
    def('mv', 'mv 移動元... 移動先', 'ファイルを移動する・名前を変える', cpmv(true));
    def('chmod', 'chmod モード ファイル...', 'ファイルのモードを変更する', (c) => {
        const [mode, ...files] = c.args;
        let code = 0;
        for (const f of files) {
            const abs = c.path(f), n = c.fs.get(abs);
            if (!n) { c.err(`chmod: '${f}' にアクセスできません: ${E.NOENT}\n`); code = 1; continue; }
            if (!c.fs.canWrite(abs)) { c.err(`chmod: '${f}' のパーミッションを変更しています: 許可されていない操作です\n`); code = 1; continue; }
            if (/^[0-7]{3,4}$/.test(mode)) n.mode = parseInt(mode, 8);
            else { const m = mode.match(/^([ugoa]*)([+-])([rwx]+)$/); if (!m) { c.err(`chmod: 無効なモード: '${mode}'\n`); return 1; } let bits = 0; for (const ch of m[3]) bits |= { r: 0o444, w: 0o200, x: 0o111 }[ch]; n.mode = m[2] === '+' ? n.mode | bits : n.mode & ~bits; }
            n.u = true;
        }
        return code;
    });
    def('stat', 'stat ファイル...', 'ファイルの状態を表示する', (c) => {
        for (const f of c.args) {
            const abs = c.path(f), n = c.fs.get(abs);
            if (!n) { c.err(`stat: '${f}' を stat できません: ${E.NOENT}\n`); return 1; }
            const d = new Date(n.mtime);
            c.out(`  File: ${f}\n  Size: ${c.fs.size(n)}\t${n.t === 'd' ? 'ディレクトリ' : '通常ファイル'}\nAccess: (0${n.mode.toString(8)}/${modeStr(n)})  Uid: (${n.owner === USER ? 1000 : 0}/${pad(n.owner, 4)})\nModify: ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} +0900\n`);
        }
    });
    def('file', 'file ファイル...', 'ファイルの種類を判定する', (c) => {
        for (const f of c.args) {
            const n = c.fs.get(c.path(f));
            c.out(`${f}: ${!n ? `cannot open \`${f}' (No such file or directory)` : n.t === 'd' ? 'directory' : /\.pdf$/i.test(f) ? 'PDF document' : /\.png$/i.test(f) ? 'PNG image data' : /\.jpe?g$/i.test(f) ? 'JPEG image data, JFIF standard 1.01' : !n.data ? 'empty' : n.mode & 0o111 ? 'ELF 64-bit LSB executable, x86-64' : 'Unicode text, UTF-8 text'}\n`);
        }
    });
    def('du', 'du [-sh] [ファイル]...', 'ディスク使用量を表示する', (c) => {
        const { o, rest } = getopt(c.args);
        for (const t of rest.length ? rest : ['.']) {
            const base = c.path(t);
            if (!c.fs.get(base)) { c.err(`du: '${t}' にアクセスできません: ${E.NOENT}\n`); return 1; }
            const total = (abs) => { const n = c.fs.get(abs); let s = Math.ceil(c.fs.size(n) / 1024) || (n.t === 'd' ? 4 : 0); if (n.t === 'd') for (const k of n.c.keys()) { const sub = total(`${abs === '/' ? '' : abs}/${k}`); s += sub; } if (n.t === 'd' && !o.s && abs !== base) c.out(`${o.h ? human(s * 1024) : s}\t${abs.replace(base, t.replace(/\/$/, ''))}\n`); return s; };
            const s = total(base);
            c.out(`${o.h ? human(s * 1024) : s}\t${t}\n`);
        }
    });
    def('find', 'find [パス] [-name パターン] [-type f|d]', 'ファイルを探す', (c) => {
        const args = c.args.slice();
        const roots = [];
        while (args.length && !args[0].startsWith('-')) roots.push(args.shift());
        let name = null, type = null, icase = false;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-name' || args[i] === '-iname') { icase = args[i] === '-iname'; name = args[++i]; } else if (args[i] === '-type') type = args[++i]; else { c.err(`find: 不明な述語 \`${args[i]}'\n`); return 1; }
        }
        const re = name && new RegExp(`^${name.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, icase ? 'i' : '');
        let code = 0;
        for (const r of roots.length ? roots : ['.']) {
            const base = c.path(r);
            if (!c.fs.get(base)) { c.err(`find: \`${r}': ${E.NOENT}\n`); code = 1; continue; }
            c.fs.walk(base, (p, n) => {
                if (!c.fs.canRead(p)) return;
                if (type && n.t !== type) return;
                if (re && !re.test(p.split('/').pop())) return;
                c.out(`${r.replace(/\/$/, '')}${p.slice(base === '/' ? 0 : base.length)}\n` || '/\n');
            });
        }
        return code;
    });
    def('tree', 'tree [-a] [ディレクトリ]', 'ディレクトリを木の形で表示する', (c) => {
        const { o, rest } = getopt(c.args);
        const color = c.tty;
        let dirs = 0, files = 0;
        for (const t of rest.length ? rest : ['.']) {
            const root = c.fs.get(c.path(t));
            if (!root || root.t !== 'd') { c.out(`${t} [error opening dir]\n`); continue; }
            c.out(`${color ? paint(t, root) : t}\n`);
            const rec = (node, prefix) => {
                const list = [...node.c.entries()].filter(([n]) => o.a || !n.startsWith('.')).sort(([a], [b]) => (a < b ? -1 : 1));
                list.forEach(([name, n], i) => {
                    const last = i === list.length - 1;
                    c.out(`${prefix}${last ? '└── ' : '├── '}${color ? paint(name, n) : name}\n`);
                    if (n.t === 'd') { dirs++; rec(n, prefix + (last ? '    ' : '│   ')); } else files++;
                });
            };
            rec(root, '');
        }
        c.out(`\n${dirs} directories, ${files} files\n`);
    });
    def('basename', 'basename パス', 'パスからファイル名の部分を取り出す', (c) => { c.out(`${(c.args[0] || '').replace(/\/+$/, '').split('/').pop()}\n`); });
    def('dirname', 'dirname パス', 'パスからディレクトリの部分を取り出す', (c) => { const p = (c.args[0] || '').replace(/\/+$/, ''); c.out(`${p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.'}\n`); });
    def('realpath', 'realpath パス...', '絶対パスを表示する', (c) => { for (const a of c.args) c.out(`${c.path(a)}\n`); });

    // ================= シェル組み込み =================
    def('cd', 'cd [ディレクトリ]', 'カレントディレクトリを変更する', (c) => {
        const arg = c.args[0] ?? HOME;
        const abs = arg === '-' ? c.sh.prev : c.path(arg), n = c.fs.get(abs);
        const fail = !n ? E.NOENT : n.t !== 'd' ? E.NOTDIR : !c.fs.canRead(abs) ? E.ACCES : null;
        if (fail) { c.err(`-bash: cd: ${arg}: ${fail}\n`); return 1; }
        if (arg === '-') c.out(`${abs}\n`);
        c.sh.prev = c.sh.cwd; c.sh.cwd = abs;
        c.sh.env.OLDPWD = c.sh.prev; c.sh.env.PWD = abs;
    });
    def('pwd', 'pwd', 'カレントディレクトリの名前を表示する', (c) => { c.out(`${c.sh.cwd}\n`); });
    const unescape = (s) => s.replace(/\\(n|t|e|033|x1b|\\|a|r)/g, (m, k) => ({ n: '\n', t: '\t', e: '\x1b', '033': '\x1b', x1b: '\x1b', '\\': '\\', a: '', r: '\r' }[k]));
    def('echo', 'echo [-ne] [文字列]...', '文字列を表示する', (c) => {
        const args = c.args.slice();
        let nl = true, esc = false;
        while (/^-[neE]+$/.test(args[0] || '')) { const f = args.shift(); if (f.includes('n')) nl = false; if (f.includes('e')) esc = true; }
        const s = args.join(' ');
        c.out((esc ? unescape(s) : s) + (nl ? '\n' : ''));
    });
    def('printf', 'printf 書式 [引数]...', '書式に従って表示する', (c) => {
        const [fmt = '', ...args] = c.args;
        let i = 0;
        c.out(unescape(fmt).replace(/%(-?\d*)([sd%])/g, (m, w, k) => { if (k === '%') return '%'; const v = String(k === 'd' ? parseInt(args[i++] || '0', 10) || 0 : args[i++] ?? ''); return w.startsWith('-') ? pad(v, -w) : padL(v, Number(w) || 0); }));
    });
    def('export', 'export [名前[=値]]...', '環境変数を設定する', (c) => {
        if (!c.args.length) { for (const [k, v] of Object.entries(c.sh.env).sort()) if (k !== '?') c.out(`declare -x ${k}="${v}"\n`); return; }
        for (const a of c.args) { const m = a.match(/^([A-Za-z_]\w*)=(.*)$/s); if (m) c.sh.env[m[1]] = m[2]; }
    });
    def('unset', 'unset 名前...', '変数を削除する', (c) => { for (const a of c.args) delete c.sh.env[a]; });
    def(['env', 'printenv'], 'env', '環境変数を一覧表示する', (c) => {
        if (c.name === 'printenv' && c.args[0]) { c.out(`${c.sh.env[c.args[0]] ?? ''}\n`); return c.sh.env[c.args[0]] === undefined ? 1 : 0; }
        for (const [k, v] of Object.entries(c.sh.env)) if (k !== '?') c.out(`${k}=${v}\n`);
    });
    def('alias', "alias [名前='値']...", 'エイリアスを定義・表示する', (c) => {
        if (!c.args.length) { for (const [k, v] of Object.entries(c.sh.aliases).sort()) c.out(`alias ${k}='${v}'\n`); return; }
        for (const a of c.args) { const m = a.match(/^([^=]+)=(.*)$/s); if (m) c.sh.aliases[m[1]] = m[2]; else if (c.sh.aliases[a]) c.out(`alias ${a}='${c.sh.aliases[a]}'\n`); else { c.err(`-bash: alias: ${a}: 見つかりません\n`); return 1; } }
    });
    def('unalias', 'unalias 名前...', 'エイリアスを削除する', (c) => { for (const a of c.args) delete c.sh.aliases[a]; });
    def('history', 'history [-c]', 'コマンドの履歴を表示する', (c) => {
        if (c.args[0] === '-c') { c.sh.history.length = 0; return; }
        c.out(c.sh.history.map((h, i) => `${padL(i + 1, 5)}  ${h}`).join('\n') + '\n');
    });
    const where = (name) => (T.commands[name] ? `${T.games.has(name) ? '/usr/games' : '/usr/bin'}/${name}` : null);
    def('which', 'which コマンド...', 'コマンドの場所を表示する', (c) => { let code = 0; for (const a of c.args) { const w = where(a); if (w) c.out(`${w}\n`); else code = 1; } return code; });
    def('type', 'type 名前...', '名前がどう解釈されるかを表示する', (c) => {
        let code = 0;
        for (const a of c.args) {
            if (c.sh.aliases[a]) c.out(`${a} は \`${c.sh.aliases[a]}' のエイリアスです\n`);
            else if (['cd', 'pwd', 'echo', 'export', 'unset', 'alias', 'unalias', 'history', 'type', 'exit', 'logout'].includes(a)) c.out(`${a} はシェル組み込み関数です\n`);
            else if (where(a)) c.out(`${a} は ${where(a)} です\n`);
            else { c.err(`-bash: type: ${a}: 見つかりません\n`); code = 1; }
        }
        return code;
    });
    def('clear', 'clear', '端末の画面を消去する', (c) => { c.term.clear(); });
    def('true', 'true', '何もせず、成功を返す', () => 0);
    def('false', 'false', '何もせず、失敗を返す', () => 1);
    def('sleep', 'sleep 秒数', '指定した時間だけ待つ', async (c) => { await c.sleep((parseFloat(c.args[0]) || 0) * 1000); });
    def('seq', 'seq [最初] 最後', '連続した数を表示する', (c) => { const [a, b] = c.args.length > 1 ? c.args.map(Number) : [1, Number(c.args[0])]; const out = []; for (let i = a; i <= b && out.length < 10000; i++) out.push(i); c.out(out.join('\n') + (out.length ? '\n' : '')); });
    def('yes', 'yes [文字列]', '止められるまで文字列を出力し続ける', async (c) => {
        const s = `${c.args.join(' ') || 'y'}\n`;
        if (!c.tty) { c.out(s.repeat(1000)); return; }
        for (;;) { c.out(s.repeat(8)); await c.sleep(40); }
    });
    def(['exit', 'logout'], 'exit', 'シェルを終了する', async (c) => {
        if (c.name === 'exit' && c.tty) c.out('logout\n');
        if (c.sh.opts.onExit) { c.sh.done = true; await c.sh.opts.onExit(); }
    });

    // ================= ページャとマニュアル =================
    function pager(c, text, label) {
        if (!c.tty) { c.out(text); return 0; }
        return fullscreen(c, (scr, quit) => {
            let rowsAll = [], top = 0, search = null, typing = null, note = '';
            const build = () => { rowsAll = lines(text).flatMap((l) => wrap(l, scr.cols)); };
            const page = () => scr.rows - 1;
            const maxTop = () => Math.max(0, rowsAll.length - page());
            const draw = () => {
                top = Math.max(0, Math.min(maxTop(), top));
                const view = rowsAll.slice(top, top + page()).map((l) => ansi(search ? l.replace(search, (h) => (h ? `\x1b[7m${h}\x1b[27m` : h)) : l));
                while (view.length < page()) view.push('<span class="f4 bo">~</span>');
                const end = top >= maxTop();
                view.push(typing !== null ? `/${cells(typing)}<span class="cur"> </span>` : `<span class="iv">${cells(note || (end ? `${label ? `${label} ` : ''}(END)` : label ? `${label} ${Math.round((top + page()) / rowsAll.length * 100)}%` : ':'))}</span><span class="cur"> </span>`);
                note = '';
                scr.draw(view);
            };
            const find = (from, dir = 1) => { for (let i = from; i >= 0 && i < rowsAll.length; i += dir) { search.lastIndex = 0; if (search.test(stripAnsi(rowsAll[i]))) { top = i; return; } } note = 'パターンが見つかりません  (press RETURN)'; };
            scr.onResize = () => { build(); draw(); };
            scr.onKey = (k) => {
                if (typing !== null) {
                    if (k.key === 'Enter') { try { search = typing ? new RegExp(typing, 'giu') : search; } catch { search = null; } typing = null; if (search) find(top + 1); } else if (k.key === 'Escape' || (k.ctrl && k.key === 'c')) typing = null; else if (k.key === 'Backspace') typing = typing.slice(0, -1); else if (k.text) typing += k.text;
                    return draw();
                }
                const key = k.ctrl ? `^${k.key}` : k.key;
                if (key === 'q' || key === 'Q' || key === '^c') return quit();
                if (key === 'j' || key === 'Down' || key === 'Enter' || key === '^e' || key === '^n') top++;
                else if (key === 'k' || key === 'Up' || key === '^y' || key === '^p') top--;
                else if (key === ' ' || key === 'f' || key === 'PageDown' || key === '^f') top += page();
                else if (key === 'b' || key === 'PageUp' || key === '^b') top -= page();
                else if (key === 'd' || key === '^d') top += page() >> 1;
                else if (key === 'u' || key === '^u') top -= page() >> 1;
                else if (key === 'g' || key === 'Home' || key === '<') top = 0;
                else if (key === 'G' || key === 'End' || key === '>') top = maxTop();
                else if (key === '/') typing = '';
                else if (key === 'n' && search) find(top + 1);
                else if (key === 'N' && search) find(top - 1, -1);
                else if (key === 'h') note = 'j/k:1行  SPACE/b:1画面  g/G:先頭/末尾  /:検索  n:次  q:終了';
                draw();
            };
            build(); draw();
        });
    }
    def(['less', 'more'], 'less [ファイル]', 'テキストを1画面ずつ表示する', (c) => {
        const { rest } = getopt(c.args);
        if (!rest.length && c.stdin === null) { c.err('Missing filename ("less --help" for help)\n'); return 1; }
        const ins = inputs(c, rest);
        if (!ins.length) return 1;
        return pager(c, ins.map((i) => i.data).join(''), rest[0] || '');
    });
    def('man', 'man コマンド', 'マニュアルページを表示する', (c) => {
        const name = c.args[0];
        if (!name) { c.err('どのマニュアルページが必要ですか？\n例: man man\n'); return 1; }
        const d = T.docs[name] || Object.values(T.docs).find((x) => x.names.includes(name));
        if (!d) { c.err(`${name} というマニュアルはありません\n`); return 16; }
        const B = (s) => `\x1b[1m${s}\x1b[0m`;
        const head = `${d.names[0].toUpperCase()}(${T.games.has(d.names[0]) ? 6 : 1})`;
        const text = [
            `${head}${' '.repeat(Math.max(2, Math.floor((c.term.cols - head.length * 2 - 18) / 2)))}地学會コマンドマニュアル${' '.repeat(Math.max(2, Math.ceil((c.term.cols - head.length * 2 - 18) / 2) - 6))}${head}`, '',
            B('名前'), `       ${d.names.join(', ')} - ${d.desc}`, '', B('書式'), `       ${B(d.usage)}`, '',
            ...(d.more ? [B('説明'), ...d.more.split('\n').map((l) => `       ${l}`), ''] : []),
            B('関連項目'), '       help(1), man(1)', '', `地学會 GNU/Linux${' '.repeat(Math.max(2, c.term.cols - 16 - 12 - head.length))}2026-10-11  ${head}`, '',
        ].join('\n');
        return pager(c, text, `Manual page ${d.names[0]}(1)`);
    }, 'q で終了、j/k または矢印キーでスクロール、/ で検索します。');
    def(['whatis', 'apropos'], 'whatis コマンド', 'コマンドの一行説明を表示する', (c) => {
        let code = 1;
        for (const a of c.args) for (const d of Object.values(T.docs)) if (c.name === 'whatis' ? d.names.includes(a) : (d.names.join(' ') + d.desc).includes(a)) { c.out(`${pad(`${d.names[0]} (1)`, 20)} - ${d.desc}\n`); code = 0; }
        if (code) c.err(`${c.args[0] || ''}: 適切なものはありません。\n`);
        return code;
    });
    def('help', 'help', '使えるコマンドの一覧を表示する', (c) => {
        const names = Object.values(T.docs).map((d) => d.names[0]).sort();
        c.out(`地学會ターミナルで使えるコマンド（${names.length} 個）:\n\n${columns(names, c.term.cols)}\n\n使いかたは \x1b[1mman コマンド名\x1b[0m、Tab で補完、↑↓ で履歴、Ctrl+C で中断。\nパイプ (|)、リダイレクト (> >> <)、&& || ; 、$変数、$(コマンド)、* ? も使えます。\n`);
    });

    // ================= システム =================
    const DOW = '日月火水木金土';
    def('date', 'date [+書式]', '日付と時刻を表示する', (c) => {
        const d = new Date();
        const f = c.args.find((a) => a.startsWith('+'));
        const map = { Y: d.getFullYear(), m: p2(d.getMonth() + 1), d: p2(d.getDate()), H: p2(d.getHours()), M: p2(d.getMinutes()), S: p2(d.getSeconds()), s: Math.floor(d / 1000), a: DOW[d.getDay()], A: `${DOW[d.getDay()]}曜日`, y: p2(d.getFullYear() % 100), j: Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 864e5), n: '\n', '%': '%' };
        map.F = `${map.Y}-${map.m}-${map.d}`; map.T = `${map.H}:${map.M}:${map.S}`;
        c.out(`${f ? f.slice(1).replace(/%(.)/g, (m, k) => map[k] ?? m) : `${map.Y}年 ${d.getMonth() + 1}月 ${d.getDate()}日 ${map.A} ${map.T} JST`}\n`);
    });
    def('cal', 'cal', '今月のカレンダーを表示する', (c) => {
        const now = new Date(), y = now.getFullYear(), m = now.getMonth();
        const title = `${m + 1}月 ${y}`;
        const out = [' '.repeat(Math.max(0, Math.floor((20 - width(title)) / 2))) + title, [...DOW].join(' ')];
        let row = '   '.repeat(new Date(y, m, 1).getDay());
        for (let day = 1; day <= new Date(y, m + 1, 0).getDate(); day++) {
            row += (day === now.getDate() ? `\x1b[7m${padL(day, 2)}\x1b[0m` : padL(day, 2)) + ' ';
            if (new Date(y, m, day).getDay() === 6) { out.push(row.trimEnd()); row = ''; }
        }
        if (row) out.push(row.trimEnd());
        c.out(out.join('\n') + '\n');
    });
    const upDays = () => Math.floor((Date.now() - SINCE) / 864e5);
    def('uptime', 'uptime', 'システムの稼働時間を表示する', (c) => { const d = new Date(); c.out(` ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} up ${upDays()} days, ${padL(d.getHours(), 2)}:${p2(d.getMinutes())},  1 user,  load average: 0.45, 0.31, 0.27\n`); });
    def('whoami', 'whoami', '現在のユーザー名を表示する', (c) => { c.out(`${USER}\n`); });
    def('id', 'id', 'ユーザーとグループの情報を表示する', (c) => { c.out(`uid=1000(${USER}) gid=1000(${USER}) groups=1000(${USER}),45(m45),150(dome)\n`); });
    def('groups', 'groups', '所属グループを表示する', (c) => { c.out(`${USER} m45 dome\n`); });
    def('hostname', 'hostname', 'ホスト名を表示する', (c) => { c.out(`${HOST}\n`); });
    def(['w', 'who'], 'w', 'ログイン中のユーザーを表示する', (c) => { const d = new Date(); c.out(c.name === 'who' ? `${USER}      tty1         ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}\n` : ` ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} up ${upDays()} days,  1 user,  load average: 0.45, 0.31, 0.27\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n${USER}      tty1     地学教室         ${p2(d.getHours())}:${p2(d.getMinutes())}    0.00s  0.04s  0.00s w\n`); });
    def('uname', 'uname [-a]', 'システム情報を表示する', (c) => { const { o } = getopt(c.args); c.out(o.a ? `Linux ${HOST} 6.1.0-fks #1 SMP PREEMPT_DYNAMIC 地学會 6.1.98-1 (2026-04-15) x86_64 GNU/Linux\n` : o.r ? '6.1.0-fks\n' : o.n ? `${HOST}\n` : o.m ? 'x86_64\n' : 'Linux\n'); });
    const DISKS = [['/dev/dome1', 98e6, 45e6, '/'], ['tmpfs', 49e6, 0, '/tmp'], ['/dev/sda1', 512e3, 126e3, '/mnt/cansat']];
    def('df', 'df [-h]', 'ファイルシステムの使用量を表示する', (c) => {
        const { o } = getopt(c.args);
        const f = (n) => (o.h ? human(n) : String(Math.round(n / 1024)));
        c.out(`${pad('ファイルシス', 14)} ${padL(o.h ? 'サイズ' : '1K-ブロック', 11)} ${padL('使用', 7)} ${padL('残り', 7)} 使用% マウント位置\n` + DISKS.map(([d, s, u, m]) => `${pad(d, 14)} ${padL(f(s), 11)} ${padL(f(u), 7)} ${padL(f(s - u), 7)} ${padL(Math.round(u / s * 100), 4)}% ${m}`).join('\n') + '\n');
    }, '主記憶 98 MB は、ドームの計算機に入っている OS の名前にちなんでいます。');
    def('free', 'free [-h]', 'メモリの使用量を表示する', (c) => { const { o } = getopt(c.args); const f = (n) => padL(o.h ? `${human(n * 1024)}i` : n, 11); c.out(`               total        used        free      shared  buff/cache   available\nMem:     ${f(100352)} ${f(65536)} ${f(8192)} ${f(512)} ${f(26624)} ${f(31744)}\nSwap:    ${f(0)} ${f(0)} ${f(0)}\n`); });
    const PROCS = [
        [1, 'root', 0.0, 1.2, '/sbin/init'], [98, 'root', 0.0, 0.8, '/usr/sbin/sshd -D'], [150, 'root', 0.3, 2.1, 'temma500d --mount EM500'],
        [245, USER, 0.1, 3.4, 'planetariumd --dome 3m --room 245'], [600, USER, 0.0, 1.9, 'fukasis-stack --resolution R600'], [678, USER, 1.2, 6.5, 'asicap --camera ASI678MC'],
        [1050, USER, 0.4, 2.2, 'sunspotd --at lunch'], [2025, USER, 0.0, 1.1, 'meteor-watch --visual'], [4126, USER, 0.0, 1.4, '-bash'],
    ];
    // btop（js/btop.js）も同じ表を使う
    T.sys = { since: SINCE, procs: PROCS, disks: DISKS };
    def('ps', 'ps [aux]', '実行中のプロセスを表示する', (c) => {
        const all = /[aexu]/.test(c.args.join(''));
        if (!all) { c.out('    PID TTY          TIME CMD\n   4126 tty1     00:00:00 bash\n   4127 tty1     00:00:00 ps\n'); return; }
        c.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n' + [...PROCS, [4127, USER, 0.0, 0.9, 'ps aux']].map(([pid, u, cpu, mem, cmd]) => `${pad(u, 8)} ${padL(pid, 7)} ${padL(cpu.toFixed(1), 4)} ${padL(mem.toFixed(1), 4)} ${padL(Math.round(mem * 4100), 6)} ${padL(Math.round(mem * 980), 5)} ${pid > 4000 ? 'tty1    ' : '?       '} ${pid > 4126 ? 'R+  ' : 'Ss  '} 4月15   0:0${pid % 10} ${cmd}`).join('\n') + '\n');
    });
    def('top', 'top', 'プロセスの状況をリアルタイムに表示する', (c) => {
        if (!c.tty) { c.err('top: failed tty get\n'); return 1; }
        return fullscreen(c, (scr, quit) => {
            const draw = () => {
                const d = new Date();
                const rows = PROCS.map(([pid, u, cpu, mem, cmd]) => [pid, u, Math.max(0, cpu + (Math.random() - 0.4) * (cpu + 0.3) * 2), mem, cmd]).concat([[4128, USER, 0.7, 1.0, 'top']]).sort((a, b) => b[2] - a[2]);
                const total = rows.reduce((s, r) => s + r[2], 0);
                const view = [
                    `top - ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} up ${upDays()} days,  1 user,  load average: 0.45, 0.31, 0.27`,
                    `Tasks: ${padL(rows.length, 3)} total,   1 running, ${padL(rows.length - 1, 3)} sleeping,   0 stopped,   0 zombie`,
                    `%Cpu(s): ${padL(total.toFixed(1), 4)} us,  0.3 sy,  0.0 ni, ${padL((99.7 - total).toFixed(1), 4)} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st`,
                    'MiB Mem :     98.0 total,      8.0 free,     64.0 used,     26.0 buff/cache', 'MiB Swap:      0.0 total,      0.0 free,      0.0 used.     31.0 avail Mem', '',
                ].map(cells);
                view.push(`<span class="iv">${cells(pad('    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND', scr.cols))}</span>`);
                for (const [pid, u, cpu, mem, cmd] of rows) view.push(cells(`${padL(pid, 7)} ${pad(u, 8)}  20   0 ${padL(Math.round(mem * 4100), 7)} ${padL(Math.round(mem * 980), 6)} ${padL(Math.round(mem * 300), 6)} ${pid === 4128 ? 'R' : 'S'} ${padL(cpu.toFixed(1), 5)} ${padL(mem.toFixed(1), 5)}   0:0${pid % 10}.${p2(pid % 60)} ${cmd}`.slice(0, scr.cols)));
                view[view.length - 1] += '<span class="cur"> </span>';
                scr.draw(view.slice(0, scr.rows));
            };
            const timer = setInterval(draw, 1500);
            scr.onKey = (k) => { if (k.key === 'q' || (k.ctrl && k.key === 'c')) { clearInterval(timer); quit(); } else draw(); };
            scr.onResize = draw;
            draw();
        });
    });
    def('kill', 'kill [-シグナル] PID...', 'プロセスにシグナルを送る', (c) => { let code = 0; for (const a of c.args.filter((x) => !x.startsWith('-'))) { c.err(PROCS.some((p) => String(p[0]) === a) ? `-bash: kill: (${a}) - 許可されていない操作です\n` : `-bash: kill: (${a}) - そのようなプロセスはありません\n`); code = 1; } return code; });
    T.bootLog = [
        '[    0.000000] Linux version 6.1.0-fks (bucho@chigaku-kyoshitsu) (gcc 12.2.0) #1 SMP 2026-04-15',
        '[    0.000000] Command line: BOOT_IMAGE=/vmlinuz-6.1.0-fks root=/dev/dome1 ro quiet',
        '[    0.004126] DMI: 松本深志高校 地学會 / 天体ドーム（約直径5 m）',
        '[    0.098000] smpboot: CPU0: タカハシ 計算機 (family: 0x6, model: 0x98, stepping: 0x3)',
        '[    0.150106] Memory: 98304K/100352K available',
        '[    0.245000] ACPI: 2棟4階 地学教室 を検出しました',
        '[    0.678001] usb 1-1: new high-speed USB device: ZWO ASI678MC',
        '[    0.810115] usb 1-2: FTDI USB Serial Device converter now attached to ttyUSB0',
        '[    1.050000] scsi 0:0:0:0: BITRAN BJ-30L 冷却モノクロCCD',
        '[    1.500150] EM500: Temma500 を検出しました（詳細は謎です）',
        '[    2.004500] EXT4-fs (dome1): mounted filesystem with ordered data mode',
    ];
    const UNITS = [
        ['sunspotd.service', 'active', 'running', '黒点観測（当番制・毎日昼休み）'], ['meteor-watch.service', 'active', 'running', '流星群観測会（眼視観測）'],
        ['meteor-radio.service', 'failed', 'failed', '流星の電波観測'], ['temma500.service', 'active', 'running', '赤道儀 タカハシ EM500 Temma500'],
        ['planetarium.service', 'inactive', 'dead', '地学會プラネタリウム（とんぼ祭）'], ['m45-editor.service', 'active', 'running', '部誌「M45」の執筆'],
        ['recruit.service', 'active', 'running', '新入部員の募集（学年を問わず、いつでも）'],
    ];
    T.units = UNITS;
    def('dmesg', 'dmesg', 'カーネルのメッセージを表示する', (c) => { c.out(T.bootLog.join('\n') + '\n'); });
    def('systemctl', 'systemctl [status|list-units|--failed] [ユニット]', 'サービスの状態を調べる', (c) => {
        const { o, rest } = getopt(c.args);
        const [sub = 'list-units', unit] = rest;
        const dot = (st) => (st === 'active' ? '\x1b[1;32m●\x1b[0m' : st === 'failed' ? '\x1b[1;31m×\x1b[0m' : '○');
        if (sub === 'status' && unit) {
            const u = UNITS.find((x) => x[0] === unit || x[0] === `${unit}.service`);
            if (!u) { c.err(`Unit ${unit}.service could not be found.\n`); return 4; }
            c.out(`${dot(u[1])} ${u[0]} - ${u[3]}\n     Loaded: loaded (/etc/systemd/system/${u[0]}; enabled)\n     Active: ${u[1] === 'active' ? '\x1b[1;32mactive (running)\x1b[0m' : u[1] === 'failed' ? '\x1b[1;31mfailed\x1b[0m (Result: exit-code)' : 'inactive (dead)'} since 水 2026-04-15 12:00:00 JST\n${u[1] === 'failed' ? '\n 4月 15 12:00:01 dome meteor-radio[1397]: 電波観測の機材もありますが、未だ運用に成功していません。\n' : u[0] === 'planetarium.service' ? '\n 7月 29 00:00:00 dome planetarium[245]: 第79回とんぼ祭は終了いたしました。\n' : ''}`);
            return u[1] === 'active' ? 0 : 3;
        }
        if (['start', 'stop', 'restart', 'enable', 'disable'].includes(sub)) { c.err(`Failed to ${sub} ${unit || ''}: Interactive authentication required.\nSee system logs and 'systemctl status ${unit || ''}' for details.\n`); return 1; }
        const list = UNITS.filter((u) => !o.failed || u[1] === 'failed');
        c.out(`  ${pad('UNIT', 24)} LOAD   ${pad('ACTIVE', 8)} ${pad('SUB', 8)} DESCRIPTION\n` + list.map((u) => `${dot(u[1])} ${pad(u[0], 24)} loaded ${pad(u[1], 8)} ${pad(u[2], 8)} ${u[3]}`).join('\n') + `\n\n${list.length} loaded units listed.\n`);
    });
    def('lsusb', 'lsusb', 'USB 機器を一覧表示する', (c) => { c.out('Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\nBus 001 Device 002: ID 03c3:678c ZWO ASI678MC\nBus 001 Device 003: ID 0403:6001 FTDI FT232 Serial (UART) IC  [缶サット地上局]\nBus 001 Device 004: ID 0547:1002 Vixen C10-4M\n'); });
    def('sudo', 'sudo コマンド', '別のユーザーとしてコマンドを実行する', async (c) => {
        if (!c.args.length) { c.err('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command\n'); return 1; }
        if (!c.sh.lectured) { c.sh.lectured = true; c.err('\nあなたはシステム管理者から通常の講習を受けたはずです。\nこれは通常、以下の3点に要約されます:\n\n    #1) 他人のプライバシーを尊重すること。\n    #2) タイプする前に考えること。\n    #3) 大いなる力には大いなる責任が伴うこと。\n\n'); }
        const pw = await c.term.readLine(`[sudo] ${USER} のパスワード: `, { mask: true });
        if (pw === null || c.sig.aborted) return 1;
        await c.sleep(900);
        c.err(`${USER} は sudoers ファイル内にありません。この事象は記録・報告されます。\n`);
        return 1;
    });
    def('su', 'su [ユーザー]', 'ユーザーを切り替える', async (c) => { const pw = await c.term.readLine('パスワード: ', { mask: true }); if (pw !== null) { await c.sleep(1200); c.err('su: 認証失敗\n'); } return 1; });
    const power = (kind) => async (c) => {
        const res = await c.sh.opts.onPower?.(kind, c);
        if (res === false || res === undefined) { c.err(`${c.name}: この端末からはできません\n`); return 1; }
        if (typeof res === 'string') { c.out(`${res}\n`); return 1; }
        c.sh.done = true;
    };
    def(['shutdown', 'poweroff', 'halt'], 'shutdown [-h now]', 'システムを停止して、モダン版にもどる', power('poweroff'));
    def('reboot', 'reboot', 'システムを再起動する', power('reboot'));
    def('startx', 'startx', 'X Window System（地学會 XP）を起動する', power('startx'), 'ターミナル版から地学會 XP に切り替えます。XP の中のターミナルでは、すでに動いているので何もしません。');
    def(['init', 'telinit'], 'init ランレベル', 'ランレベルを切り替える（0:停止 3:ターミナル版 5:XP 6:再起動）', (c) => { const kind = { 0: 'poweroff', 3: 'console', 5: 'startx', 6: 'reboot' }[c.args[0]]; if (!kind) { c.err('init: ランレベルを 0, 3, 5, 6 から指定してください\n'); return 1; } return power(kind)(c); });

    // ================= ネットワーク =================
    const siteFile = (url) => { const m = url.match(/^(?:https?:\/\/)?(?:(?:www\.)?fksgeoscience\.github\.io|localhost|dome)(?:\/(.*))?$/) || url.match(/^\.?\/?([\w./-]+\.(?:html?|css|js|svg|png|jpg|pdf))$/); return m ? m[1] || 'index.htm' : null; };
    const hostOf = (url) => (url.match(/^(?:https?:\/\/)?([^/:]+)/) || [])[1] || url;
    def('ping', 'ping [-c 回数] ホスト', 'ホストに ICMP ECHO_REQUEST を送る', async (c) => {
        const { o, rest } = getopt(c.args, 'c:');
        const host = rest[0];
        if (!host) { c.err('ping: usage error: 宛先アドレスが必要です\n'); return 2; }
        const known = { localhost: ['127.0.0.1', 0.04], [HOST]: ['127.0.1.1', 0.05], 'fksgeoscience.github.io': ['185.199.108.153', 12], 'github.com': ['20.27.177.113', 18], m45: ['3h47m +24°07′', 0] };
        const k = known[host];
        if (!k) { await c.sleep(600); c.err(`ping: ${host}: 名前またはサービスが不明です\n`); return 2; }
        c.out(`PING ${host} (${k[0]}) 56(84) bytes of data.\n`);
        let sent = 0, got = 0;
        const times = [];
        const stats = () => c.out(`\n--- ${host} ping 統計 ---\n送信パケット数 ${sent}, 受信パケット数 ${got}, パケット損失 ${sent ? Math.round((1 - got / sent) * 100) : 0}%\n${times.length ? `rtt min/avg/max = ${Math.min(...times).toFixed(3)}/${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)}/${Math.max(...times).toFixed(3)} ms\n` : ''}`);
        try {
            for (let n = Number(o.c) || 30; sent < n;) {
                sent++;
                if (host === 'm45') { await c.sleep(1000); if (sent === 1) c.out('（プレアデス星団までは約440光年。返事が届くのは880年ほど先です）\n'); continue; }
                const t = k[1] * (0.8 + Math.random() * 0.5);
                times.push(t); got++;
                c.out(`64 バイト応答 送信元 ${host} (${k[0]}): icmp_seq=${sent} ttl=64 時間=${t.toFixed(t < 1 ? 3 : 1)} ミリ秒\n`);
                if (sent < n) await c.sleep(1000);
            }
        } catch (err) { if (!(err instanceof Interrupt)) throw err; c.out('^C'); c.sig.aborted = false; }
        stats();
        return got ? 0 : 1;
    });
    const fetchSite = async (c, url) => {
        const file = siteFile(url);
        if (!file) { await c.sleep(500); return { fail: `Could not resolve host: ${hostOf(url)}` }; }
        try { const res = await fetch(`./${file}`); return res.ok ? { file, res, body: await res.text() } : { fail: `The requested URL returned error: ${res.status}`, status: res.status }; } catch { return { fail: `Failed to connect to ${hostOf(url)}` }; }
    };
    def('curl', 'curl [-sI] [-o ファイル] URL', 'URL の内容を取得する', async (c) => {
        const { o, rest } = getopt(c.args, 'o:');
        if (!rest[0]) { c.err("curl: try 'curl --help' for more information\n"); return 2; }
        const r = await fetchSite(c, rest[0]);
        if (r.fail) { c.err(`curl: (${r.status ? 22 : 6}) ${r.fail}\n`); return r.status ? 22 : 6; }
        if (o.I) { c.out(`HTTP/2 200 \ncontent-type: ${r.res.headers.get('content-type') || 'text/html'}\n${r.res.headers.get('last-modified') ? `last-modified: ${r.res.headers.get('last-modified')}\n` : ''}content-length: ${new TextEncoder().encode(r.body).length}\nserver: GitHub.com\n\n`); return 0; }
        if (o.o) { const fail = c.fs.write(c.path(o.o), r.body); if (fail) { c.err(`curl: (23) Failure writing output to destination: ${fail}\n`); return 23; } } else c.out(r.body.endsWith('\n') ? r.body : `${r.body}\n`);
    }, 'このターミナルから届くのは、地学會のホームページ（fksgeoscience.github.io）だけです。');
    def('wget', 'wget URL', 'URL の内容をファイルに保存する', async (c) => {
        const url = getopt(c.args).rest[0];
        if (!url) { c.err('wget: URL がありません\n使い方: wget [オプション]... [URL]...\n'); return 1; }
        const d = new Date();
        c.err(`--${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}--  ${url}\n${hostOf(url)} をDNSに問いあわせています... `);
        const r = await fetchSite(c, url);
        if (r.fail) { c.err(`失敗しました: 名前またはサービスが不明です.\nwget: ホストアドレス \`${hostOf(url)}' を解決できませんでした。\n`); return 4; }
        const name = r.file.split('/').pop(), size = new TextEncoder().encode(r.body).length;
        c.err(`185.199.108.153\n接続しています... 接続しました。\nHTTP による接続要求を送信しました、応答を待っています... 200 OK\n長さ: ${size} (${human(size)}) [text/html]\n\`${name}' に保存中\n\n`);
        for (let i = 1; i <= 10; i++) { c.err(`\r${pad(name, 18)} ${padL(i * 10, 3)}%[${'='.repeat(i * 2 - 1)}>${' '.repeat(20 - i * 2)}] ${padL(human(size * i / 10), 7)}`); await c.sleep(60); }
        const fail = c.fs.write(c.path(name), r.body);
        c.err(fail ? `\n${name}: ${fail}\n` : `\n\n\`${name}' へ保存完了 [${size}/${size}]\n\n`);
        return fail ? 3 : 0;
    });
    def('ssh', 'ssh [ユーザー@]ホスト', '別の計算機にログインする', async (c) => {
        const host = (c.args.find((a) => !a.startsWith('-')) || '').split('@').pop();
        if (!host) { c.err('usage: ssh [user@]hostname\n'); return 255; }
        if (host === HOST || host === 'localhost') { c.out(`すでに ${HOST} にログインしています。\n`); return 0; }
        await c.sleep(2500);
        c.err(`ssh: connect to host ${host} port 22: Connection timed out\n`);
        return 255;
    });
    def(['ip', 'ifconfig'], 'ip a', 'ネットワークの設定を表示する', (c) => { c.out('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\n    inet 192.168.24.5/24 brd 192.168.24.255 scope global eth0\n'); });
    const OPEN = { '': 'index.htm', top: 'index.htm', index: 'index.htm', news: 'index.htm', about: 'about.htm', works: 'result.htm', result: 'result.htm', tombo: 'fes.htm', tombo79: 'fes.htm', fes: 'fes.htm', contact: 'contact.htm' };
    def(['open', 'xdg-open'], 'open [ページ名|ファイル|URL]', 'ページや画像を開く', (c) => {
        const arg = c.args[0] || '';
        const node = c.fs.get(c.path(arg || '.'));
        const key = arg.replace(/^.*\//, '').replace(/\.(md|htm|html)$/, '');
        const target = /^https?:\/\//.test(arg) ? arg : node?.url ? node.url : key in OPEN ? `./${OPEN[key]}` : null;
        if (!target) { c.err(`open: ${arg}: 開けるのは top / about / works / tombo79 / contact と、photos・m45 の中のファイルです\n`); return 1; }
        if (!c.sh.opts.onOpen?.(target, arg)) window.open(target, '_blank', 'noopener');
    }, '例: open about    open photos/dome2.jpg    open m45/M45_2026_2.pdf');
    def('git', 'git サブコマンド', '分散バージョン管理システム', async (c) => {
        const sub = c.args[0];
        if (!sub || sub === '--help') { c.out('使用方法: git [-v | --version] [-h | --help] <command> [<args>]\n'); return 1; }
        if (sub === '--version' || sub === '-v') { c.out('git version 2.39.5\n'); return 0; }
        if (sub === 'clone') { c.out(`Cloning into '${(c.args[1] || 'repo').replace(/\.git$/, '').split('/').pop()}'...\n`); await c.sleep(1500); c.err(`fatal: unable to access '${c.args[1] || ''}': Could not resolve host: github.com\nヒント: このホームページのリポジトリは https://github.com/fksgeoscience にあります\n`); return 128; }
        c.err('fatal: not a git repository (or any of the parent directories): .git\n');
        return 128;
    });
    def(['apt', 'apt-get'], 'apt install パッケージ', 'パッケージを管理する', (c) => { c.err(/^(install|remove|update|upgrade)$/.test(c.args[0] || '') ? 'E: ロックファイル /var/lib/dpkg/lock-frontend をオープンできません - open (13: 許可がありません)\nE: dpkg フロントエンドロック (/var/lib/dpkg/lock-frontend) を取得できません。root 権限で実行していますか?\n' : 'apt 2.6.1 (amd64)\n使用方法: apt [オプション] コマンド\n'); return 100; });
    def(['nano', 'emacs'], 'nano', '（入っていません）', (c) => { c.err(`-bash: ${c.name}: コマンドが見つかりません\nこの計算機に入っているエディタは vim です。 vim ${c.args[0] || 'README.md'} をどうぞ。\n`); return 127; });

    // ================= あそび =================
    const game = (name) => T.games.add(name);
    def('neofetch', 'neofetch', 'システム情報をロゴと一緒に表示する', (c) => {
        const logo = ['          _.._', "       .-'    '-.   /", '      /   .--.   \\ /', '     |   /    \\   X', "     |__|      |_/ |", '    [==============]', '     |  _      _  |', '     | |_|    |_| |', '     |     __     |', '     |____|  |____|', '', ''];
        const k = (s) => `\x1b[1;33m${s}\x1b[0m`;
        const info = [
            `\x1b[1;33m${USER}\x1b[0m@\x1b[1;33m${HOST}\x1b[0m`, '--------', `${k('OS')}: 地学會 GNU/Linux 2026.10 (Pleiades) x86_64`, `${k('Host')}: 天体ドーム（約直径5 m）`, `${k('Kernel')}: 6.1.0-fks`,
            `${k('Uptime')}: ${upDays()} days（since 2026-04-15）`, `${k('Shell')}: bash 5.2.15`, `${k('Terminal')}: 地学會ターミナル ${c.term.cols}x${c.term.rows}`, `${k('CPU')}: タカハシ 計算機 (1) @ 0.098GHz`,
            `${k('Memory')}: 64MiB / 98MiB`, `${k('主砲')}: タカハシ FCT-150`, `${k('活動日')}: 毎週 火曜・金曜`,
        ];
        const rows = Math.max(logo.length, info.length);
        let out = '\n';
        for (let i = 0; i < rows; i++) out += `\x1b[1;36m${pad(logo[i] || '', 26)}\x1b[0m${info[i] || ''}\n`;
        out += `\n${' '.repeat(26)}${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `\x1b[4${n}m   `).join('')}\x1b[0m\n${' '.repeat(26)}${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `\x1b[10${n}m   `).join('')}\x1b[0m\n\n`;
        c.out(out);
    });
    const QUOTES = [
        '「なにをするところ？」\n「………さあ？」\n\t\t-- 26年度部長', '資料整理は偉業。', '地学は、おもしろいよ！\n\t\t-- 地学会員Pちゃん', 'Temma500は謎です。', '昔は松本も空が暗かったんだなぁ',
        '予備機をつくった　その予備機はちゃんと大会前日に壊れた\n\t\t-- 缶サット Fks-B-I', '予備機は壊れなかった\n\t\t-- 缶サット Fks-B-II', '制御うまくいかない\n\t\t-- 缶サット Fks-A',
        '電波観測の機材もありますが、未だ運用に成功していません。', '大会の2日前にラップトップが壊れる　一千円のジャンクPCで大会に参加する羽目に\n\t\t-- 缶サット Fks-B-I',
        '満点の星空が，あなたをお待ちしています', '学年を問わず、いつでも新入部員を募集しています！', '十字のスケールがついています。用途は分かりません…\n\t\t-- タカハシ LG5mm',
    ];
    def('fortune', 'fortune', '地学會のホームページから、ひとことを選んで表示する', (c) => { c.out(`${QUOTES[Math.floor(Math.random() * QUOTES.length)].replace(/\t/g, '    ')}\n`); });
    game('fortune');
    def('cowsay', 'cowsay [ことば]', 'ゴンザレス（公式マスコット）にしゃべらせる', (c) => {
        const text = (c.args.join(' ') || (c.stdin ?? '').trim() || 'もー').replace(/\t/g, '    ');
        const ls = text.split('\n').flatMap((l) => wrap(l, 38));
        const w = Math.max(...ls.map(width));
        const box = ls.length === 1 ? [`< ${ls[0]} >`] : ls.map((l, i) => `${i === 0 ? '/' : i === ls.length - 1 ? '\\' : '|'} ${pad(l, w)} ${i === 0 ? '\\' : i === ls.length - 1 ? '/' : '|'}`);
        c.out([` ${'_'.repeat(w + 2)}`, ...box, ` ${'-'.repeat(w + 2)}`, '      \\         o', '       \\        |', "        \\    .--'--.", '           _/  ^ ^  \\_', "        .-'    \\_/    '-.", "       '-----------------'", '            |       |', '            d       b', ''].join('\n'));
    }, '牛のかわりに、地学會公式マスコットキャラクター「ゴンザレス」が出てきます。');
    game('cowsay');
    def('m45', 'm45', 'プレアデス星団の星図を表示する', (c) => {
        const stars = [[0, 0, 'Alcyone', 1], [23, -3, 'Atlas', 0], [-35.6, 1, 'Electra', 0], [-22.6, 16, 'Maia', 0], [-15.8, -9, 'Merope', 0], [-31.3, 22, 'Taygeta', 0], [23.3, 5, 'Pleione', 0], [-36.8, 11, 'Celaeno', 0], [-21.7, 27, 'Asterope', 0]];
        const W = 62, Hh = 17, grid = Array.from({ length: Hh }, () => Array(W).fill(' '));
        for (let i = 0; i < 26; i++) grid[(i * 7 + 3) % Hh][(i * 23 + 5) % W] = '.';
        for (const [e, n, name, big] of stars) {
            const x = Math.round(30 - e * 0.62), y = Math.round(11 - n * 0.36);
            grid[y][x] = big ? '@' : '*';
            [...name].forEach((ch, i) => { if (x + 2 + i < W) grid[y][x + 2 + i] = ch; });
        }
        c.out(`\n${grid.map((r) => `  ${r.join('')}`.replace(/[@*]/g, (s) => `\x1b[1;36m${s}\x1b[0m`)).join('\n')}\n\n  \x1b[1mM45 プレアデス星団（すばる）\x1b[0m  赤経 3h47m  赤緯 +24°07′  ※東が左\n  地学會の部誌とおなじ名前の星団です。 open m45/M45_2026_2.pdf\n\n`);
    });
    game('m45');
    def('sl', 'sl', '汽車が走る', async (c) => {
        if (!c.tty) return 0;
        const art = ['      ooO', '    oO      ____', '   _][__   |[][]|_____________________', '  |     |==|    |  地  学  會  号     |', '  |_____|__|____|_____________________|', "  'oo-OO-OO-oo' ~~ 'oo---oo'  'oo---oo'"];
        const smoke = [['      ooO', '    oO'], ['     oOo ', '   Oo  '], ['    o oO ', '  oO   ']];
        const w = Math.max(...art.map(width));
        // 本物の sl と同じく、Ctrl+C では止まりません
        await new Promise((resolve) => fullscreen(c, (scr, quit) => {
            let x = scr.cols, tick = 0;
            scr.onKey = () => {};
            const step = () => {
                const top = Math.max(0, Math.floor((scr.rows - art.length) / 2));
                const view = Array(scr.rows).fill('');
                art.forEach((line, i) => {
                    const src = i < 2 ? smoke[Math.floor(tick / 3) % 3][i] : line;
                    const row = x >= 0 ? ' '.repeat(x) + src : [...src].slice(Math.ceil(-x / 1)).join('');
                    let cut = '', n = 0;
                    for (const ch of row) { const cwid = T.util.cw(ch); if (n + cwid > scr.cols) break; cut += ch; n += cwid; }
                    view[top + i] = cells(cut);
                });
                view[scr.rows - 1] = '<span class="cur"> </span>';
                scr.draw(view);
                x -= 2; tick++;
                if (x < -w - 2) { quit(); resolve(); } else setTimeout(step, 55);
            };
            step();
        }));
    }, 'ls と打ちまちがえたときのためのコマンドです。走りきるまで止まりません。');
    game('sl');
    def('cmatrix', 'cmatrix', '緑の文字が降ってくる', (c) => {
        if (!c.tty) return 0;
        return fullscreen(c, (scr, quit) => {
            const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789M45';
            let drops = [], grid = [];
            const reset = () => { drops = Array.from({ length: scr.cols }, () => -Math.floor(Math.random() * scr.rows)); grid = Array.from({ length: scr.rows }, () => Array(scr.cols).fill(null)); };
            const step = () => {
                for (const row of grid) for (let x = 0; x < row.length; x++) if (row[x]) { row[x][1]--; if (row[x][1] <= 0) row[x] = null; }
                drops.forEach((y, x) => { if (y >= 0 && y < scr.rows) grid[y][x] = [glyphs[Math.floor(Math.random() * glyphs.length)], 14]; drops[x] = y > scr.rows + Math.random() * 20 ? -Math.floor(Math.random() * 10) : y + 1; });
                scr.draw(grid.map((row, y) => row.map((cell, x) => (!cell ? ' ' : `<span class="${drops[x] - 1 === y ? 'f15 bo' : cell[1] > 8 ? 'f10' : 'f2 di'}">${cell[0]}</span>`)).join('') + (y === scr.rows - 1 ? '<span class="cur"></span>' : '')));
            };
            const timer = setInterval(step, 70);
            scr.onResize = reset;
            scr.onKey = (k) => { if (k.key === 'q' || k.key === 'Escape' || (k.ctrl && k.key === 'c')) { clearInterval(timer); quit(); } };
            reset();
        });
    }, 'q か Ctrl+C で終了します。');
    game('cmatrix');
    def('saver', 'saver', 'あのスクリーンセーバー', (c) => {
        if (!c.tty) return 0;
        return fullscreen(c, (scr, quit) => {
            const text = 'マルチな部活', w = width(text);
            let x = 2, y = 1, vx = 1, vy = 1, color = 14;
            const step = () => {
                x += vx; y += vy;
                if (x <= 0 || x + w >= scr.cols) { vx = -vx; x = Math.max(0, Math.min(scr.cols - w, x)); color = 9 + ((color - 8) % 6); }
                if (y <= 0 || y >= scr.rows - 1) { vy = -vy; y = Math.max(0, Math.min(scr.rows - 1, y)); color = 9 + ((color - 8) % 6); }
                const view = Array(scr.rows).fill('');
                view[y] = `${' '.repeat(x)}<span class="f${color} bo">${cells(text)}</span><span class="cur"></span>`;
                scr.draw(view);
            };
            const timer = setInterval(step, 110);
            scr.onKey = () => { clearInterval(timer); quit(); };
            step();
        });
    }, 'ドームの Windows 98 機のスクリーンセーバーを模倣した「マルチな部活」です。何かキーを押すと終了します。');
    game('saver');
    def(['mines', 'minesweeper'], 'mines', 'マインスイーパ', (c) => {
        if (!c.tty) return 0;
        return fullscreen(c, (scr, quit) => {
            const N = 9, M = 10, COLORS = [0, 12, 2, 9, 4, 1, 6, 15, 8];
            let mines, open, flag, cx = 4, cy = 4, state, t0, now;
            const idx = (x, y) => y * N + x;
            const around = (i) => { const x = i % N, y = Math.floor(i / N), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < N && ny < N) out.push(idx(nx, ny)); } return out; };
            const reset = () => { mines = null; open = new Set(); flag = new Set(); state = 'play'; t0 = 0; now = 0; };
            const reveal = (i) => {
                if (state !== 'play' || open.has(i) || flag.has(i)) return;
                if (!mines) { mines = new Set(); while (mines.size < M) { const r = Math.floor(Math.random() * N * N); if (r !== i) mines.add(r); } t0 = Date.now(); }
                if (mines.has(i)) { state = 'lost'; open.add(i); return; }
                const q = [i];
                while (q.length) { const k = q.pop(); if (open.has(k) || flag.has(k)) continue; open.add(k); if (!around(k).some((a) => mines.has(a))) q.push(...around(k)); }
                if (open.size === N * N - M) state = 'won';
            };
            const draw = () => {
                if (state === 'play' && t0) now = Math.floor((Date.now() - t0) / 1000);
                const face = state === 'won' ? 'B-)' : state === 'lost' ? 'X-(' : ':-)';
                const view = ['', `  <span class="bo">マインスイーパ</span>   <span class="f9 bo">${String(M - flag.size).padStart(3, '0')}</span>  <span class="f11 bo">${face}</span>  <span class="f9 bo">${String(Math.min(999, now)).padStart(3, '0')}</span>`, `  +${'-'.repeat(N * 2 + 1)}+`];
                for (let y = 0; y < N; y++) {
                    let row = '  | ';
                    for (let x = 0; x < N; x++) {
                        const i = idx(x, y), here = x === cx && y === cy;
                        const n = mines ? around(i).filter((a) => mines.has(a)).length : 0;
                        let ch = '#', cls = 'f7 di';
                        if (flag.has(i)) { ch = 'P'; cls = 'f9 bo'; }
                        if (state !== 'play' && mines?.has(i)) { ch = '*'; cls = state === 'won' ? 'f10 bo' : open.has(i) ? 'g1 f15 bo' : 'f15 bo'; } else if (open.has(i)) { ch = n ? String(n) : '.'; cls = n ? `f${COLORS[n]} bo` : 'f8'; }
                        row += `<span class="${here ? 'cur ' : ''}${cls}">${ch}</span> `;
                    }
                    view.push(`${row}|`);
                }
                view.push(`  +${'-'.repeat(N * 2 + 1)}+`, '', cells(state === 'won' ? '  クリア！  r:もう一度  q:終了' : state === 'lost' ? '  どかーん。  r:もう一度  q:終了' : '  矢印/hjkl:移動  SPACE:開く  f:旗  r:やりなおす  q:終了'));
                scr.draw(view);
            };
            const timer = setInterval(() => { if (state === 'play' && t0) draw(); }, 1000);
            scr.onResize = draw;
            scr.onKey = (k) => {
                const key = k.ctrl ? `^${k.key}` : k.key;
                if (key === 'q' || key === '^c') { clearInterval(timer); return quit(); }
                if (key === 'h' || key === 'Left') cx = Math.max(0, cx - 1);
                else if (key === 'l' || key === 'Right') cx = Math.min(N - 1, cx + 1);
                else if (key === 'k' || key === 'Up') cy = Math.max(0, cy - 1);
                else if (key === 'j' || key === 'Down') cy = Math.min(N - 1, cy + 1);
                else if (key === ' ' || key === 'Enter') reveal(idx(cx, cy));
                else if (key === 'f' && state === 'play' && !open.has(idx(cx, cy))) { const i = idx(cx, cy); if (flag.has(i)) flag.delete(i); else flag.add(i); }
                else if (key === 'r') reset();
                draw();
            };
            reset(); draw();
        });
    }, '9×9 に地雷が 10 個。矢印キーか hjkl で移動、スペースで開く、f で旗を立てます。');
    game('mines');
})();
