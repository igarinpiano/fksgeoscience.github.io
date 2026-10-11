// 地学會ターミナルの vim。本物の Vim ではなく、よく使う操作を JavaScript で再現したものです。
// モード（ノーマル・挿入・ビジュアル・置換・コマンドライン）、オペレータ＋モーション、テキストオブジェクト、
// カウント、ドットリピート、アンドゥ、検索と置換、主な ex コマンドに対応しています。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { cells, pad, padL } = T.util;
    const cwOf = T.util.cw;
    const OPEN = '([{<', CLOSE = ')]}>';

    // 文字の種類（w/b/e の単語境界に使う）: 0 空白, 1 単語, 2 記号, 3 かな・漢字など
    function cls(ch, big) {
        if (ch === undefined || /\s/.test(ch)) return 0;
        if (big) return 1;
        if (/[A-Za-z0-9_]/.test(ch)) return 1;
        const cp = ch.charCodeAt(0);
        if (cp >= 0x3040 && !(cp >= 0xff00 && cp <= 0xff0f) && !(cp >= 0xff1a && cp <= 0xff20)) return cp < 0x30a0 ? 3 : cp < 0x3100 ? 4 : 5;
        return 2;
    }
    // Vim の正規表現（magic）を JavaScript の正規表現に直す
    function vimRe(src, ic) {
        let out = '', i = 0, icase = ic, very = false;
        while (i < src.length) {
            const c = src[i];
            if (c === '\\') {
                const n = src[i + 1];
                i += 2;
                if (n === 'c') icase = true; else if (n === 'C') icase = false; else if (n === 'v') very = true;
                else if (n === '<' || n === '>') out += '\\b';
                else if (n === '=') out += '?';
                else if ('(){}|+?'.includes(n)) out += very ? `\\${n}` : n;
                else if (n === undefined) out += '\\\\';
                else out += `\\${n}`;
                continue;
            }
            if (!very && '(){}|+?'.includes(c)) out += `\\${c}`; else if (very && (c === '<' || c === '>')) out += '\\b'; else out += c;
            i++;
        }
        try { return new RegExp(out, icase ? 'gi' : 'g'); } catch { return null; }
    }

    class Vim {
        constructor(c, scr, quit, opts) {
            Object.assign(this, { c, scr, quit, fs: c.fs });
            this.lines = ['']; this.cy = 0; this.cx = 0; this.want = 0; this.top = 0;
            this.mode = 'n'; this.count = ''; this.op = null; this.pend = null; this.vs = null;
            this.reg = { text: '', line: false }; this.undo = []; this.redo = []; this.marks = {};
            this.search = null; this.hlOff = false; this.lastF = null; this.cmd = null; this.cmdHist = [];
            this.o = { nu: false, rnu: false, ic: false, hls: false, ts: 8, sw: 4, et: true, ai: true };
            this.msg = ''; this.err = false; this.page = null;
            this.file = null; this.abs = null; this.modified = false; this.ro = !!opts.readonly;
            this.tick = 0; this.rec = null; this.last = null; this.replaying = false; this.insText = null;
            for (const l of (this.fs.get(`${T.HOME}/.vimrc`)?.data || '').split('\n')) { const m = l.match(/^\s*set?\s+(.+)$/); if (m) this.set(m[1], true); }
            if (opts.file) this.edit(opts.file); else this.intro = true;
            scr.onKey = (k) => { this.feed(k); this.render(); };
            scr.onResize = () => this.render();
            this.render();
        }

        // ---------- ファイル ----------
        edit(file) {
            this.file = file; this.abs = this.c.path(file);
            const n = this.fs.get(this.abs);
            this.undo = []; this.redo = []; this.cy = this.cx = this.top = 0; this.modified = false; this.intro = false;
            if (n && n.t === 'd') { this.lines = ['']; this.say(`"${file}" はディレクトリです`, true); return; }
            if (!n) { this.lines = ['']; this.say(`"${file}" [新ファイル]`); return; }
            const data = n.url ? `[バイナリファイル: ${n.url}]\n` : n.data;
            this.lines = data.split('\n');
            if (this.lines.length > 1 && this.lines[this.lines.length - 1] === '') this.lines.pop();
            if (!this.fs.canWrite(this.abs) || n.url) this.ro = true;
            this.say(`"${file}"${this.ro ? ' [読込専用]' : ''} ${this.lines.length}L, ${this.fs.size(n)}B`);
        }
        write(file, force) {
            const name = file || this.file;
            if (!name) return this.say('E32: ファイル名がありません', true), false;
            const abs = this.c.path(name);
            if (this.ro && !force && abs === this.abs) return this.say("E45: 'readonly' オプションが設定されています (! を追加で上書き)", true), false;
            const data = `${this.lines.join('\n')}\n`;
            const fail = this.fs.write(abs, data);
            if (fail) return this.say(`"${name}" E212: 書込み用にファイルを開けません`, true), false;
            this.fs.save();
            if (!this.file) { this.file = name; this.abs = abs; }
            if (abs === this.abs) this.modified = false;
            this.say(`"${name}" ${this.lines.length}L, ${new TextEncoder().encode(data).length}B 書込み`);
            return true;
        }
        say(msg, err = false) { this.msg = msg; this.err = err; }

        // ---------- 編集の土台 ----------
        snap() {
            const last = this.undo[this.undo.length - 1];
            if (last && last.lines.length === this.lines.length && last.lines.every((l, i) => l === this.lines[i])) return;
            this.undo.push({ lines: this.lines.slice(), cy: this.cy, cx: this.cx });
            if (this.undo.length > 300) this.undo.shift();
            this.redo = [];
        }
        touch() { this.modified = true; this.tick++; }
        len(y = this.cy) { return this.lines[y].length; }
        clamp() {
            this.cy = Math.max(0, Math.min(this.lines.length - 1, this.cy));
            const max = this.mode === 'n' ? Math.max(0, this.len() - 1) : this.len();
            this.cx = Math.max(0, Math.min(max, this.cx));
        }
        col(y, x) { let col = 0; const l = this.lines[y]; for (let i = 0; i < x && i < l.length; i++) col += l[i] === '\t' ? this.o.ts - (col % this.o.ts) : cwOf(l[i]); return col; }
        xAt(y, col) { let c = 0; const l = this.lines[y]; for (let i = 0; i < l.length; i++) { const w = l[i] === '\t' ? this.o.ts - (c % this.o.ts) : cwOf(l[i]); if (c + w > col) return i; c += w; } return Math.max(0, l.length - (this.mode === 'n' || this.op ? 1 : 0)); }
        indent(y) { return this.lines[y].match(/^[ \t]*/)[0]; }
        firstNonBlank(y) { return this.indent(y).length; }

        // ---------- モーション ----------
        ch(y, x, big) { return x >= this.lines[y].length ? 0 : cls(this.lines[y][x], big); }
        wordFwd({ y, x }, big) {
            const L = this.lines, k = this.ch(y, x, big);
            if (k) while (x < L[y].length && this.ch(y, x, big) === k) x++;
            for (;;) {
                while (x < L[y].length && this.ch(y, x, big) === 0) x++;
                if (x < L[y].length) break;
                if (y >= L.length - 1) { x = L[y].length; break; }
                y++; x = 0;
                if (!L[y].length) break;
            }
            return { y, x };
        }
        wordEnd({ y, x }, big) {
            const L = this.lines;
            x++;
            for (;;) {
                while (x < L[y].length && this.ch(y, x, big) === 0) x++;
                if (x < L[y].length) break;
                if (y >= L.length - 1) return { y, x: Math.max(0, L[y].length - 1) };
                y++; x = 0;
            }
            const k = this.ch(y, x, big);
            while (x + 1 < L[y].length && this.ch(y, x + 1, big) === k) x++;
            return { y, x };
        }
        wordBack({ y, x }, big) {
            const L = this.lines;
            x--;
            for (;;) {
                while (x >= 0 && this.ch(y, x, big) === 0) x--;
                if (x >= 0) break;
                if (y === 0) return { y: 0, x: 0 };
                y--; x = L[y].length - 1;
                if (!L[y].length) return { y, x: 0 };
            }
            const k = this.ch(y, x, big);
            while (x > 0 && this.ch(y, x - 1, big) === k) x--;
            return { y, x };
        }
        matchPair() {
            const l = this.lines[this.cy];
            let x = this.cx;
            while (x < l.length && !OPEN.includes(l[x]) && !CLOSE.includes(l[x])) x++;
            if (x >= l.length) return null;
            const a = l[x], fwd = OPEN.includes(a), b = fwd ? CLOSE[OPEN.indexOf(a)] : OPEN[CLOSE.indexOf(a)];
            let depth = 0, y = this.cy;
            for (;;) {
                const line = this.lines[y];
                for (; x >= 0 && x < line.length; x += fwd ? 1 : -1) {
                    if (line[x] === a) depth++; else if (line[x] === b && --depth === 0) return { y, x, incl: true };
                }
                y += fwd ? 1 : -1;
                if (y < 0 || y >= this.lines.length) return null;
                x = fwd ? 0 : this.lines[y].length - 1;
            }
        }
        findChar(kind, chr, cnt) {
            const l = this.lines[this.cy], fwd = kind === 'f' || kind === 't';
            let x = this.cx;
            for (let i = 0; i < cnt; i++) {
                x = fwd ? l.indexOf(chr, x + 1 + (i === 0 && kind === 't' && l[x + 1] === chr ? 1 : 0)) : l.lastIndexOf(chr, x - 1 - (i === 0 && kind === 'T' && l[x - 1] === chr ? 1 : 0));
                if (x < 0) return null;
            }
            if (kind === 't') x--; else if (kind === 'T') x++;
            return { y: this.cy, x, incl: fwd };
        }
        doSearch(dir, cnt = 1, from = { y: this.cy, x: this.cx }) {
            const s = this.search;
            if (!s) { this.say('E35: 前回の正規表現がありません', true); return null; }
            this.hlOff = false;
            let { y, x } = from, wrapped = false;
            const fwd = (s.back ? -1 : 1) * dir > 0;
            const hits = (line) => { const out = []; s.re.lastIndex = 0; for (let m; (m = s.re.exec(line));) { out.push(m.index); if (!m[0].length) s.re.lastIndex++; } return out; };
            for (let n = 0; n < cnt; n++) {
                let found = null;
                for (let i = 0; i <= this.lines.length && !found; i++) {
                    const ly = ((y + (fwd ? i : -i)) % this.lines.length + this.lines.length) % this.lines.length;
                    const hs = hits(this.lines[ly]).filter((h) => (i === 0 ? (fwd ? h > x : h < x) : i === this.lines.length ? (fwd ? h <= x : h >= x) : true));
                    if (hs.length) { found = { y: ly, x: fwd ? hs[0] : hs[hs.length - 1] }; if (fwd ? ly < y || (ly === y && found.x <= x) : ly > y || (ly === y && found.x >= x)) wrapped = true; }
                }
                if (!found) { this.say(`E486: パターンは見つかりませんでした: ${s.src}`, true); return null; }
                ({ y, x } = found);
            }
            if (wrapped) this.say(fwd ? '下まで検索したので上に戻ります' : '上まで検索したので下に戻ります', true);
            return { y, x };
        }
        // テキストオブジェクト（iw aw i" a( など）の範囲
        textObject(kind, chr) {
            const y = this.cy, l = this.lines[y], x = this.cx;
            if (chr === 'w' || chr === 'W') {
                const big = chr === 'W', k = this.ch(y, x, big);
                let a = x, b = x;
                while (a > 0 && this.ch(y, a - 1, big) === k) a--;
                while (b + 1 < l.length && this.ch(y, b + 1, big) === k) b++;
                if (kind === 'a') { const b0 = b; while (b + 1 < l.length && this.ch(y, b + 1, big) === 0) b++; if (b === b0) while (a > 0 && this.ch(y, a - 1, big) === 0) a--; }
                return [{ y, x: a }, { y, x: b, incl: true }];
            }
            if ('"\'`'.includes(chr)) {
                // 行内の引用符を前から2つずつ組にして、カーソルを含む組（なければ次の組）を選ぶ
                const at = [];
                for (let i = l.indexOf(chr); i >= 0; i = l.indexOf(chr, i + 1)) if (l[i - 1] !== '\\') at.push(i);
                let a = -1, b = -1;
                for (let i = 0; i + 1 < at.length; i += 2) if (x <= at[i + 1]) { a = at[i]; b = at[i + 1]; break; }
                if (a < 0) return null;
                return kind === 'i' ? (b - a > 1 ? [{ y, x: a + 1 }, { y, x: b - 1, incl: true }] : [{ y, x: b }, { y, x: b }]) : [{ y, x: a }, { y, x: b, incl: true }];
            }
            if (chr === 'p') {
                const blank = (i) => !this.lines[i].trim();
                let a = y, b = y;
                const k = blank(y);
                while (a > 0 && blank(a - 1) === k) a--;
                while (b < this.lines.length - 1 && blank(b + 1) === k) b++;
                if (kind === 'a') while (b < this.lines.length - 1 && blank(b + 1) !== k) b++;
                return [{ y: a, x: 0 }, { y: b, x: 0, linewise: true }];
            }
            const pair = { '(': '()', ')': '()', b: '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}', B: '{}', '<': '<>', '>': '<>' }[chr];
            if (!pair) return null;
            const scan = (dir) => {
                let depth = 0, py = y, px = x;
                const self = dir < 0 ? pair[0] : pair[1], other = dir < 0 ? pair[1] : pair[0];
                if (this.lines[py][px] === self) return { y: py, x: px };
                for (;;) {
                    px += dir;
                    while (px < 0 || px >= this.lines[py].length) { py += dir; if (py < 0 || py >= this.lines.length) return null; px = dir < 0 ? this.lines[py].length - 1 : 0; if (this.lines[py].length) break; }
                    const chh = this.lines[py][px];
                    if (chh === other) depth++; else if (chh === self) { if (depth === 0) return { y: py, x: px }; depth--; }
                }
            };
            const a = scan(-1), b = scan(1);
            if (!a || !b) return null;
            if (kind === 'a') return [a, { ...b, incl: true }];
            const s = a.x + 1 >= this.lines[a.y].length && a.y < b.y ? { y: a.y + 1, x: 0 } : { y: a.y, x: a.x + 1 };
            return [s, { y: b.y, x: b.x }];
        }

        // ---------- オペレータ ----------
        // a から b まで（b.incl なら b の文字を含む）に op を適用する
        operate(op, a, b, linewise) {
            if (a.y > b.y || (a.y === b.y && a.x > b.x)) [a, b] = [{ ...b, incl: a.incl }, { ...a, incl: b.incl }];
            const L = this.lines;
            const bx = linewise ? 0 : Math.min(L[b.y].length, b.x + (b.incl ? 1 : 0));
            const text = linewise ? L.slice(a.y, b.y + 1).join('\n') : a.y === b.y ? L[a.y].slice(a.x, bx) : [L[a.y].slice(a.x), ...L.slice(a.y + 1, b.y), L[b.y].slice(0, bx)].join('\n');
            const count = b.y - a.y + 1;
            if (op === 'y') {
                this.reg = { text, line: linewise };
                this.cy = a.y; if (!linewise) this.cx = a.x;
                if (count > 2) this.say(`${count} 行がヤンクされました`);
                return;
            }
            if (op === '>' || op === '<') {
                this.snap();
                for (let y = a.y; y <= b.y; y++) { if (op === '>') { if (L[y]) L[y] = ' '.repeat(this.o.sw) + L[y]; } else L[y] = L[y].replace(new RegExp(`^( {1,${this.o.sw}}|\t)`), ''); }
                this.cy = a.y; this.cx = this.firstNonBlank(a.y); this.touch();
                if (count > 2) this.say(`${count} 行を ${op} で1回処理しました`);
                return;
            }
            if (op === '~' || op === 'u' || op === 'U') {
                this.snap();
                const conv = (s) => (op === 'u' ? s.toLowerCase() : op === 'U' ? s.toUpperCase() : [...s].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''));
                for (let y = a.y; y <= b.y; y++) { const s = linewise || y > a.y ? 0 : a.x, e = linewise || y < b.y ? L[y].length : bx; L[y] = L[y].slice(0, s) + conv(L[y].slice(s, e)) + L[y].slice(e); }
                this.cy = a.y; this.cx = linewise ? this.cx : a.x; this.touch();
                return;
            }
            // d と c
            this.snap();
            this.reg = { text, line: linewise };
            if (linewise) {
                if (op === 'c') { L.splice(a.y, count, this.o.ai ? this.indent(a.y) : ''); this.cy = a.y; this.cx = L[a.y].length; } else {
                    L.splice(a.y, count);
                    if (!L.length) L.push('');
                    this.cy = Math.min(a.y, L.length - 1); this.cx = this.firstNonBlank(this.cy);
                    if (count > 2) this.say(`${count} 行が削除されました`);
                }
            } else { L.splice(a.y, count, L[a.y].slice(0, a.x) + L[b.y].slice(bx)); this.cy = a.y; this.cx = a.x; }
            this.touch();
            if (op === 'c') this.insert(true); else this.clamp();
        }
        insert(noSnap = false) { if (!noSnap) this.snap(); this.mode = 'i'; this.intro = false; }
        put(before, cnt) {
            if (!this.reg.text) return;
            this.snap();
            const L = this.lines;
            if (this.reg.line) {
                const add = Array(cnt).fill(this.reg.text.split('\n')).flat();
                const at = before ? this.cy : this.cy + 1;
                L.splice(at, 0, ...add);
                this.cy = at; this.cx = this.firstNonBlank(at);
                if (add.length > 2) this.say(`${add.length} 行追加しました`);
            } else {
                const text = this.reg.text.repeat(cnt), l = L[this.cy];
                const at = before || !l.length ? this.cx : this.cx + 1;
                const parts = (l.slice(0, at) + text + l.slice(at)).split('\n');
                L.splice(this.cy, 1, ...parts);
                if (parts.length > 1) { this.cx = at; } else this.cx = at + text.length - 1;
            }
            this.touch(); this.clamp();
        }
        join(cnt) {
            this.snap();
            for (let i = 0; i < Math.max(1, cnt - 1) && this.cy < this.lines.length - 1; i++) {
                const a = this.lines[this.cy].replace(/\s+$/, ''), b = this.lines[this.cy + 1].replace(/^\s+/, '');
                this.cx = a.length;
                this.lines.splice(this.cy, 2, a + (a && b && !b.startsWith(')') && cwOf(a[a.length - 1]) === 1 ? ' ' : '') + b);
            }
            this.touch(); this.clamp();
        }

        // ---------- キーの受け口 ----------
        feed(k) {
            const name = k.ctrl ? `C-${k.key}` : k.key;
            if (!this.replaying) {
                if (this.mode === 'n' && !this.busy()) { this.rec = []; this.recTick = this.tick; this.noRepeat = false; }
                this.rec?.push(k);
            }
            if (this.page) { this.page = null; this.msg = ''; if (name !== ':') { return; } }
            if (this.mode === 'c') this.cmdKey(name, k);
            else if (this.mode === 'i' || this.mode === 'R') this.insertKey(name, k);
            else { if (!this.pend && !this.count && !this.op) this.msg = ''; this.normalKey(name, k); }
            if (this.mode === 'n' && !this.busy() && !this.replaying) {
                if (this.rec && this.tick !== this.recTick && !this.noRepeat) this.last = this.rec;
                this.rec = null;
            }
        }
        busy() { return !!(this.op || this.count || this.pend); }
        reset() { this.count = ''; this.op = null; this.pend = null; }

        insertKey(name, k) {
            const L = this.lines, l = L[this.cy], x = this.cx;
            const put = (s) => {
                if (this.mode === 'R' && s !== '\n') L[this.cy] = l.slice(0, x) + s + l.slice(x + [...s].length);
                else L[this.cy] = l.slice(0, x) + s + l.slice(x);
                this.cx += s.length; this.touch();
            };
            switch (name) {
                case 'Escape': case 'C-c': case 'C-[':
                    this.mode = 'n'; this.cx = Math.max(0, this.cx - 1); this.clamp(); return;
                case 'Enter': case 'C-j': case 'C-m': {
                    const ind = this.o.ai ? this.indent(this.cy).slice(0, x) : '';
                    L.splice(this.cy, 1, l.slice(0, x), ind + l.slice(x).replace(this.o.ai ? /^[ \t]+/ : /^/, ''));
                    this.cy++; this.cx = ind.length; this.touch(); return;
                }
                case 'Backspace': case 'C-h':
                    if (this.mode === 'R') { this.cx = Math.max(0, x - 1); return; }
                    if (x > 0) { const n = this.o.et && /^ +$/.test(l.slice(0, x)) ? ((x - 1) % this.o.sw) + 1 : 1; L[this.cy] = l.slice(0, x - n) + l.slice(x); this.cx -= n; this.touch(); } else if (this.cy > 0) { this.cx = L[this.cy - 1].length; L.splice(this.cy - 1, 2, L[this.cy - 1] + l); this.cy--; this.touch(); }
                    return;
                case 'Delete': if (x < l.length) L[this.cy] = l.slice(0, x) + l.slice(x + 1); else if (this.cy < L.length - 1) L.splice(this.cy, 2, l + L[this.cy + 1]); this.touch(); return;
                case 'Tab': return put(this.o.et ? ' '.repeat(this.o.sw - (this.col(this.cy, x) % this.o.sw)) : '\t');
                case 'C-w': { let p = x; while (p && /\s/.test(l[p - 1])) p--; const kk = cls(l[p - 1]); while (p && cls(l[p - 1]) === kk) p--; L[this.cy] = l.slice(0, p) + l.slice(x); this.cx = p; this.touch(); return; }
                case 'C-u': L[this.cy] = l.slice(x); this.cx = 0; this.touch(); return;
                case 'C-t': L[this.cy] = ' '.repeat(this.o.sw) + l; this.cx += this.o.sw; this.touch(); return;
                case 'C-d': { const cut = Math.min(this.o.sw, this.indent(this.cy).length); L[this.cy] = l.slice(cut); this.cx = Math.max(0, x - cut); this.touch(); return; }
                case 'Left': this.cx = Math.max(0, x - 1); return;
                case 'Right': this.cx = Math.min(l.length, x + 1); return;
                case 'Up': if (this.cy > 0) { this.cy--; this.cx = Math.min(this.len(), x); } return;
                case 'Down': if (this.cy < L.length - 1) { this.cy++; this.cx = Math.min(this.len(), x); } return;
                case 'Home': this.cx = 0; return;
                case 'End': this.cx = l.length; return;
                default: if (k.text) put(k.text);
            }
        }

        normalKey(name, k) {
            if (this.pend) { const p = this.pend; this.pend = null; return p(name, k); }
            const visual = this.mode === 'v' || this.mode === 'V';
            if (name === 'Escape' || name === 'C-c' || name === 'C-[') { this.reset(); if (visual) this.mode = 'n'; this.clamp(); return; }
            if (/^[1-9]$/.test(name) || (name === '0' && this.count)) { this.count += name; return; }
            const given = this.count ? parseInt(this.count, 10) : null;
            const cnt = (given ?? 1) * (this.op?.n ?? 1);
            const L = this.lines, here = { y: this.cy, x: this.cx };
            const last = L.length - 1;
            const go = (t, linewise = false, keepWant = false) => {
                // モーションの結果 t を、移動またはオペレータの対象として使う
                if (!t) { this.reset(); return; }
                if (this.op) {
                    const op = this.op.k;
                    this.reset();
                    this.operate(op, here, t, linewise || !!t.linewise);
                    if (op === 'y' && visual) this.mode = 'n';
                    return;
                }
                this.count = '';
                this.cy = t.y; this.cx = t.x; this.clamp();
                if (!keepWant) this.want = this.col(this.cy, this.cx);
            };
            const vert = (dy) => { const y = Math.max(0, Math.min(last, this.cy + dy)); if (!this.op && y === this.cy && dy) { this.count = ''; return; } go({ y, x: this.xAt(y, this.want) }, true, true); };
            const jump = () => { if (!this.op) this.marks["'"] = this.marks['`'] = { ...here }; };
            const lineTo = (y) => go({ y: Math.max(0, Math.min(last, y)), x: this.firstNonBlank(Math.max(0, Math.min(last, y))) }, true);
            const repeat = (fn) => { let p = here; for (let i = 0; i < cnt; i++) p = fn(p); return p; };
            const page = Math.max(1, this.scr.rows - 2);
            const startOp = (key) => {
                if (visual) {
                    const [a, b] = this.selection();
                    this.mode = 'n'; this.count = '';
                    this.operate(key, a, { ...b, incl: true }, !!b.linewise);
                    return;
                }
                if (this.op) { if (this.op.k === key) { const y2 = Math.min(last, this.cy + cnt - 1); const op = key; this.reset(); this.operate(op, here, { y: y2, x: 0 }, true); } else this.reset(); return; }
                this.op = { k: key, n: given }; this.count = '';
            };
            const enter = (fn) => { this.count = ''; this.snap(); fn(); this.insert(true); };

            switch (name) {
                // --- モーション ---
                case 'h': case 'Left': case 'Backspace': case 'C-h': return go({ y: this.cy, x: Math.max(0, this.cx - cnt) });
                case 'l': case 'Right': case ' ': return go({ y: this.cy, x: Math.min(this.len() - (this.op || visual ? 0 : 1), this.cx + cnt) });
                case 'j': case 'Down': case 'C-n': case 'C-j': return vert(cnt);
                case 'k': case 'Up': case 'C-p': return vert(-cnt);
                case 'Enter': case '+': return lineTo(this.cy + cnt);
                case '-': return lineTo(this.cy - cnt);
                case '0': case 'Home': return go({ y: this.cy, x: 0 });
                case '^': case '_': return go({ y: this.cy, x: this.firstNonBlank(this.cy) });
                case '$': case 'End': { const y = Math.min(last, this.cy + cnt - 1); this.want = 1e9; return go({ y, x: Math.max(0, L[y].length - 1), incl: true }, false, true); }
                case '|': return go({ y: this.cy, x: this.xAt(this.cy, cnt - 1) });
                case 'w': case 'W': {
                    const big = name === 'W';
                    if (this.op?.k === 'c' && this.ch(this.cy, this.cx, big)) { const t = repeat((p) => (p === here && this.ch(p.y, p.x + 1, big) !== this.ch(p.y, p.x, big) ? p : this.wordEnd(p === here ? { y: p.y, x: p.x - 1 } : p, big))); return go({ ...t, incl: true }); }
                    let t = repeat((p) => this.wordFwd(p, big));
                    if (this.op && t.y > this.cy) t = { y: this.cy, x: L[this.cy].length };
                    return go(t);
                }
                case 'b': case 'B': return go(repeat((p) => this.wordBack(p, name === 'B')));
                case 'e': case 'E': return go({ ...repeat((p) => this.wordEnd(p, name === 'E')), incl: true });
                case 'G': jump(); return lineTo(given === null ? last : given - 1);
                case '%': jump(); return go(this.matchPair());
                case '{': case '}': {
                    const dir = name === '}' ? 1 : -1;
                    let y = this.cy;
                    for (let i = 0; i < cnt; i++) { while (y + dir >= 0 && y + dir <= last && !L[y].trim()) y += dir; while (y + dir >= 0 && y + dir <= last && L[y].trim()) y += dir; }
                    return go({ y, x: dir > 0 && y === last ? L[y].length : 0 });
                }
                case 'H': return lineTo(this.top + cnt - 1);
                case 'L': return lineTo(this.bottom - cnt + 1);
                case 'M': return lineTo(Math.floor((this.top + this.bottom) / 2));
                case 'f': case 'F': case 't': case 'T':
                    this.pend = (n2, k2) => { if (!k2.text) return this.reset(); this.lastF = [name, k2.text]; go(this.findChar(name, k2.text, cnt)); };
                    return;
                case ';': case ',': {
                    if (!this.lastF) return this.reset();
                    const flip = { f: 'F', F: 'f', t: 'T', T: 't' };
                    return go(this.findChar(name === ';' ? this.lastF[0] : flip[this.lastF[0]], this.lastF[1], cnt));
                }
                case 'n': case 'N': jump(); return go(this.doSearch(name === 'n' ? 1 : -1, cnt));
                case '*': case '#': {
                    const obj = this.textObject('i', 'w');
                    const word = obj && L[this.cy].slice(obj[0].x, obj[1].x + 1);
                    if (!word || !word.trim()) { this.say('E348: カーソルの下に文字列がありません', true); return this.reset(); }
                    const src = /^\w+$/.test(word) ? `\\<${word}\\>` : word.replace(/[.*[\]^$\\~/]/g, '\\$&');
                    this.search = { re: vimRe(src, this.o.ic), src, back: name === '#' };
                    return go(this.doSearch(1, cnt, { y: this.cy, x: obj[0].x }));
                }
                case 'C-f': case 'PageDown': this.top = Math.min(last, this.top + page); return go({ y: Math.min(last, Math.max(this.cy + page, this.top)), x: 0 }, true);
                case 'C-b': case 'PageUp': this.top = Math.max(0, this.top - page); return go({ y: Math.max(0, this.cy - page), x: 0 }, true);
                case 'C-d': return vert(given ?? Math.ceil(page / 2));
                case 'C-u': return vert(-(given ?? Math.ceil(page / 2)));
                case 'C-e': this.count = ''; this.top = Math.min(last, this.top + cnt); if (this.cy < this.top) this.cy = this.top; return;
                case 'C-y': this.count = ''; this.top = Math.max(0, this.top - cnt); return;
                case 'g':
                    this.pend = (n2) => {
                        if (n2 === 'g') { jump(); return lineTo(given === null ? 0 : given - 1); }
                        if (n2 === 'j' || n2 === 'k') return vert(n2 === 'j' ? cnt : -cnt);
                        if (n2 === '_') return go({ y: this.cy, x: Math.max(0, L[this.cy].replace(/\s+$/, '').length - 1), incl: true });
                        if (n2 === 'e' || n2 === 'E') return go({ ...repeat((p) => { const b = this.wordBack(p, n2 === 'E'); return b.y === p.y && this.ch(p.y, p.x, n2 === 'E') && b.x < p.x && this.ch(b.y, b.x, n2 === 'E') === this.ch(p.y, p.x, n2 === 'E') ? this.wordEnd(this.wordBack(b, n2 === 'E'), n2 === 'E') : this.wordEnd(this.wordBack(b, n2 === 'E'), n2 === 'E'); }), incl: true });
                        if ('~uU'.includes(n2)) return startOp(n2);
                        if (n2 === 'J') { this.count = ''; this.snap(); if (this.cy < last) { L.splice(this.cy, 2, L[this.cy] + L[this.cy + 1]); this.touch(); } return; }
                        if (n2 === 'v' && this.lastVis) { this.count = ''; [this.vs, this.mode] = [this.lastVis.vs, this.lastVis.mode]; this.cy = this.lastVis.y; this.cx = this.lastVis.x; return; }
                        this.reset();
                    };
                    return;
                case "'": case '`':
                    this.pend = (n2) => { const m = this.marks[n2]; if (m) jump(); if (!m) { this.say('E20: マークは設定されていません', true); return this.reset(); } go(name === "'" ? { y: Math.min(last, m.y), x: this.firstNonBlank(Math.min(last, m.y)) } : { y: Math.min(last, m.y), x: m.x }, name === "'"); };
                    return;
                // --- テキストオブジェクト（オペレータ待ち・ビジュアル中の i / a） ---
                case 'i': case 'a':
                    if (this.op || visual) {
                        this.pend = (n2, k2) => {
                            const r = k2.text && this.textObject(name, k2.text);
                            if (!r) return this.reset();
                            if (visual) { this.vs = r[0]; this.cy = r[1].y; this.cx = r[1].x; if (r[1].linewise) this.mode = 'V'; this.count = ''; return; }
                            const op = this.op.k;
                            this.reset();
                            this.operate(op, r[0], r[1], !!r[1].linewise);
                        };
                        return;
                    }
                    break;
                default:
            }
            if (this.op && !'dcy<>~uU'.includes(name)) return this.reset();

            switch (name) {
                // --- オペレータ ---
                case 'd': case 'c': case 'y': case '<': case '>': return startOp(name);
                case 'x': case 'Delete': if (visual) return startOp('d'); if (!this.len()) return this.reset(); this.count = ''; return this.operate('d', here, { y: this.cy, x: Math.min(this.len(), this.cx + cnt) }, false);
                case 'X': if (visual) { this.mode = 'V'; return startOp('d'); } this.count = ''; if (this.cx) this.operate('d', { y: this.cy, x: Math.max(0, this.cx - cnt) }, here, false); return;
                case 's': if (visual) return startOp('c'); this.count = ''; return this.operate('c', here, { y: this.cy, x: Math.min(this.len(), this.cx + cnt) }, false);
                case 'S': if (visual) { this.mode = 'V'; return startOp('c'); } this.count = ''; return this.operate('c', here, { y: Math.min(last, this.cy + cnt - 1), x: 0 }, true);
                case 'D': if (visual) { this.mode = 'V'; return startOp('d'); } this.count = ''; return this.operate('d', here, { y: Math.min(last, this.cy + cnt - 1), x: 1e9 }, false);
                case 'C': if (visual) { this.mode = 'V'; return startOp('c'); } this.count = ''; return this.operate('c', here, { y: Math.min(last, this.cy + cnt - 1), x: 1e9 }, false);
                case 'Y': if (visual) { this.mode = 'V'; return startOp('y'); } this.count = ''; return this.operate('y', here, { y: Math.min(last, this.cy + cnt - 1), x: 0 }, true);
                case '~': if (visual) return startOp('~'); this.count = ''; this.operate('~', here, { y: this.cy, x: Math.min(this.len(), this.cx + cnt) }, false); this.cx = Math.min(Math.max(0, this.len() - 1), here.x + cnt); return;
                case 'u': if (visual) return startOp('u'); this.count = ''; this.noRepeat = true; for (let i = 0; i < cnt; i++) { const s = this.undo.pop(); if (!s) { this.say('既に一番古い変更です'); break; } this.redo.push({ lines: L.slice(), cy: this.cy, cx: this.cx }); this.lines = s.lines; this.cy = s.cy; this.cx = s.cx; this.modified = true; } this.clamp(); return;
                case 'U': if (visual) return startOp('U'); this.count = ''; return;
                case 'C-r': this.count = ''; this.noRepeat = true; for (let i = 0; i < cnt; i++) { const s = this.redo.pop(); if (!s) { this.say('既に一番新しい変更です'); break; } this.undo.push({ lines: this.lines.slice(), cy: this.cy, cx: this.cx }); this.lines = s.lines; this.cy = s.cy; this.cx = s.cx; this.modified = true; } this.clamp(); return;
                case '.': {
                    this.count = ''; this.noRepeat = true;
                    if (!this.last) return;
                    const keys = this.last;
                    this.replaying = true;
                    for (let i = 0; i < cnt; i++) for (const kk of keys) this.feed(kk);
                    this.replaying = false;
                    return;
                }
                case 'p': case 'P':
                    if (visual) { const keep = this.reg; const [a, b] = this.selection(); this.mode = 'n'; this.operate('d', a, { ...b, incl: true }, !!b.linewise); this.reg = keep; this.count = ''; return this.put(true, 1); }
                    this.count = ''; return this.put(name === 'P', cnt);
                case 'J': if (visual) { const [a, b] = this.selection(); this.mode = 'n'; this.cy = a.y; this.count = ''; return this.join(b.y - a.y + 1); } this.count = ''; return this.join(cnt);
                case 'r':
                    this.pend = (n2, k2) => {
                        const chh = n2 === 'Enter' ? '\n' : k2.text;
                        if (!chh || this.cx + cnt > this.len()) return this.reset();
                        this.count = ''; this.snap();
                        const l = L[this.cy];
                        if (chh === '\n') { L.splice(this.cy, 1, l.slice(0, this.cx), l.slice(this.cx + cnt)); this.cy++; this.cx = 0; } else { L[this.cy] = l.slice(0, this.cx) + chh.repeat(cnt) + l.slice(this.cx + cnt); this.cx += cnt - 1; }
                        this.touch();
                    };
                    return;
                // --- 挿入モードへ ---
                case 'i': case 'Insert': return enter(() => {});
                case 'a': return enter(() => { this.cx = Math.min(this.len(), this.cx + 1); });
                case 'I': return enter(() => { this.cx = this.firstNonBlank(this.cy); });
                case 'A': return enter(() => { this.cx = this.len(); });
                case 'o': return enter(() => { const ind = this.o.ai ? this.indent(this.cy) : ''; L.splice(this.cy + 1, 0, ind); this.cy++; this.cx = ind.length; this.touch(); });
                case 'O': return enter(() => { const ind = this.o.ai ? this.indent(this.cy) : ''; L.splice(this.cy, 0, ind); this.cx = ind.length; this.touch(); });
                case 'R': this.count = ''; this.snap(); this.mode = 'R'; return;
                // --- ビジュアル ---
                case 'v': case 'V':
                    this.count = '';
                    if (this.mode === name) this.mode = 'n'; else { if (!visual) this.vs = { ...here }; this.mode = name; }
                    return;
                case 'o': break;
                // --- そのほか ---
                case ':': this.cmd = { type: ':', text: visual ? "'<,'>" : given ? `.,.+${given - 1}` : '', hi: this.cmdHist.length }; if (visual) this.keepVisual(); this.mode = 'c'; this.count = ''; return;
                case '/': case '?': this.cmd = { type: name, text: '', hi: 0 }; this.back = this.mode; this.mode = 'c'; return;
                case 'm': this.pend = (n2) => { if (/^[a-zA-Z]$/.test(n2)) this.marks[n2] = { ...here }; this.count = ''; }; return;
                case '"': this.pend = () => {}; return;
                case 'Z': this.pend = (n2) => { this.count = ''; if (n2 === 'Z') this.ex('x'); else if (n2 === 'Q') this.ex('q!'); }; return;
                case 'z': this.pend = (n2) => { this.count = ''; const r = this.scr.rows - 2; this.top = Math.max(0, n2 === 't' || n2 === 'Enter' ? this.cy : n2 === 'b' || n2 === '-' ? this.cy - r : n2 === 'z' || n2 === '.' ? this.cy - (r >> 1) : this.top); this.scrollLock = true; }; return;
                case 'C-g': this.count = ''; this.say(`"${this.file || '[無名]'}"${this.modified ? ' [変更あり]' : ''} ${L.length} 行 --${Math.round((this.cy + 1) / L.length * 100)}%--`); return;
                case 'C-l': this.count = ''; this.scr.cache = []; return;
                case '&': this.count = ''; return this.ex('s');
                default: this.reset();
            }
            if (name === 'o' && visual) { const s = this.vs; this.vs = { y: this.cy, x: this.cx }; this.cy = s.y; this.cx = s.x; this.count = ''; }
        }
        selection() {
            let a = this.vs, b = { y: this.cy, x: this.cx };
            if (a.y > b.y || (a.y === b.y && a.x > b.x)) [a, b] = [b, a];
            this.keepVisual();
            return this.mode === 'V' ? [{ y: a.y, x: 0 }, { y: b.y, x: 0, linewise: true }] : [a, b];
        }
        keepVisual() { this.lastVis = { vs: { ...this.vs }, mode: this.mode, y: this.cy, x: this.cx }; let a = this.vs.y, b = this.cy; if (a > b) [a, b] = [b, a]; this.marks['<'] = { y: a, x: 0 }; this.marks['>'] = { y: b, x: 0 }; }

        // ---------- コマンドライン（: / ?） ----------
        cmdKey(name, k) {
            const cmd = this.cmd;
            const leave = () => { this.mode = cmd.type === ':' ? 'n' : this.back === 'c' ? 'n' : this.back || 'n'; this.cmd = null; };
            if (name === 'Escape' || name === 'C-c' || name === 'C-[') { leave(); if (cmd.type === ':') this.mode = 'n'; return; }
            if (name === 'Backspace' || name === 'C-h') { if (!cmd.text) { leave(); this.mode = cmd.type === ':' ? 'n' : this.mode; return; } cmd.text = cmd.text.slice(0, -1); return; }
            if (name === 'C-u') { cmd.text = ''; return; }
            if (name === 'C-w') { cmd.text = cmd.text.replace(/\S+\s*$/, ''); return; }
            if (cmd.type === ':' && (name === 'Up' || name === 'Down')) { cmd.hi = Math.max(0, Math.min(this.cmdHist.length, cmd.hi + (name === 'Up' ? -1 : 1))); cmd.text = this.cmdHist[cmd.hi] ?? ''; return; }
            if (name === 'Enter') {
                const text = cmd.text;
                leave();
                if (cmd.type === ':') { this.mode = 'n'; if (text.trim()) { this.cmdHist.push(text); this.ex(text); } return; }
                const src = text || this.search?.src;
                if (!src) return;
                const re = vimRe(src, this.o.ic);
                if (!re) { this.say(`E486: パターンは見つかりませんでした: ${src}`, true); return; }
                this.search = { re, src, back: cmd.type === '?' };
                const t = this.doSearch(1);
                if (t) { this.cy = t.y; this.cx = t.x; this.clamp(); this.want = this.col(this.cy, this.cx); }
                return;
            }
            if (name === 'Tab' && cmd.type === ':') {
                const m = cmd.text.match(/^(\s*(?:e|w|r|edit|write|read|sp|vs)!?\s+)(\S*)$/);
                if (m) { const res = this.c.sh.complete(`cat ${m[2]}`); if (res?.list.length === 1) cmd.text = m[1] + res.list[0]; }
                return;
            }
            if (k.text) cmd.text += k.text;
        }
        set(arg, quiet = false) {
            for (const item of arg.split(/\s+/).filter(Boolean)) {
                const m = item.match(/^(no)?(\w+?)(!|\?)?(?:=(\S+))?$/);
                const alias = { number: 'nu', nu: 'nu', relativenumber: 'rnu', rnu: 'rnu', ignorecase: 'ic', ic: 'ic', hlsearch: 'hls', hls: 'hls', tabstop: 'ts', ts: 'ts', shiftwidth: 'sw', sw: 'sw', expandtab: 'et', et: 'et', autoindent: 'ai', ai: 'ai' };
                const key = m && alias[m[2]];
                if (!key) { if (!quiet && !/^(wrap|ruler|showcmd|incsearch|is|smartcase|scs|syntax|encoding|enc|fileencoding|fenc|nocompatible|cp|laststatus|ls|mouse|background|bg|list|cursorline|cul)$/.test(m?.[2] || '')) this.say(`E518: 未知のオプションです: ${item}`, true); continue; }
                if (m[3] === '?') { this.say(typeof this.o[key] === 'boolean' ? `${this.o[key] ? '  ' : 'no'}${m[2]}` : `  ${m[2]}=${this.o[key]}`); continue; }
                if (typeof this.o[key] === 'number') { if (m[4]) this.o[key] = Math.max(1, parseInt(m[4], 10) || this.o[key]); else this.say(`  ${m[2]}=${this.o[key]}`); } else this.o[key] = m[3] === '!' ? !this.o[key] : !m[1];
            }
        }
        // 行アドレス（12 . $ '< '> +3 など）を読む
        addr(s) {
            const m = s.match(/^(\d+|\.|\$|'[<>a-zA-Z])?((?:[+-]\d*)*)/);
            if (!m[0]) return [null, s];
            let y = m[1] === undefined || m[1] === '.' ? this.cy : m[1] === '$' ? this.lines.length - 1 : m[1][0] === "'" ? this.marks[m[1][1]]?.y ?? this.cy : parseInt(m[1], 10) - 1;
            for (const off of m[2].match(/[+-]\d*/g) || []) y += (off[0] === '+' ? 1 : -1) * (parseInt(off.slice(1), 10) || 1);
            return [Math.max(0, Math.min(this.lines.length - 1, y)), s.slice(m[0].length)];
        }
        substitute(a, b, arg) {
            let pat, rep, flags;
            if (!arg) { if (!this.lastSub) return this.say('E35: 前回の正規表現がありません', true); ({ pat, rep, flags } = this.lastSub); } else {
                const d = arg[0], parts = [''];
                for (let i = 1; i < arg.length; i++) { if (arg[i] === '\\' && arg[i + 1] === d) { parts[parts.length - 1] += d; i++; } else if (arg[i] === d && parts.length < 3) parts.push(''); else parts[parts.length - 1] += arg[i]; }
                [pat, rep = '', flags = ''] = parts;
                if (!pat) pat = this.search?.src || '';
                this.lastSub = { pat, rep, flags };
            }
            const re0 = vimRe(pat, this.o.ic || flags.includes('i'));
            if (!re0) return this.say(`E486: パターンは見つかりませんでした: ${pat}`, true);
            const re = new RegExp(re0.source, re0.flags.replace('g', '') + (flags.includes('g') ? 'g' : ''));
            const to = rep.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/\\&/g, '\x00').replace(/&/g, '$$&').replace(/\x00/g, '&').replace(/\\n/g, '\x01').replace(/\\r/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
            this.search = { re: new RegExp(re0.source, re0.flags), src: pat, back: false };
            this.hlOff = false;
            let n = 0, lineCount = 0, lastY = -1;
            const out = [];
            this.lines.forEach((l, y) => {
                if (y < a || y > b) { out.push(l); return; }
                const hits = l.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
                if (!hits) { out.push(l); return; }
                n += flags.includes('g') ? hits.length : 1; lineCount++;
                if (flags.includes('n')) { out.push(l); return; }
                const parts = l.replace(re, to).split('\n');
                lastY = out.length + parts.length - 1;
                out.push(...parts);
            });
            if (!n) return this.say(`E486: パターンは見つかりませんでした: ${pat}`, true);
            if (flags.includes('n')) return this.say(`${n} 箇所該当しました (計 ${lineCount} 行内)`);
            this.snap();
            this.lines = out; this.cy = lastY; this.cx = this.firstNonBlank(lastY); this.touch();
            if (n > 2 || lineCount > 1) this.say(`${n} 箇所置換しました (計 ${lineCount} 行内)`);
        }
        ex(line) {
            line = line.trim().replace(/^:+/, '');
            let a = null, b = null, rest = line;
            if (rest.startsWith('%')) { a = 0; b = this.lines.length - 1; rest = rest.slice(1); } else {
                [a, rest] = this.addr(rest);
                if (rest.startsWith(',')) { [b, rest] = this.addr(rest.slice(1)); b ??= this.cy; a ??= this.cy; }
            }
            rest = rest.trim();
            if (!rest) { if (a !== null) { this.cy = b ?? a; this.cx = this.firstNonBlank(this.cy); } return; }
            const hasRange = a !== null;
            if (a === null) a = this.cy;
            if (b === null) b = a;
            if (a > b) [a, b] = [b, a];
            let m;
            if ((m = rest.match(/^s(?:ubstitute)?([^a-zA-Z0-9\s\\|"].*)?$/)) && (m[1] || /^s(ubstitute)?$/.test(rest))) return this.substitute(a, b, m[1]);
            if ((m = rest.match(/^(g|global|v|vglobal)(!?)\s*(\W)(.*?)\3\s*(.*)$/))) {
                const re = vimRe(m[4], this.o.ic), inv = m[1][0] === 'v' || m[2] === '!';
                if (!re) return this.say(`E486: パターンは見つかりませんでした: ${m[4]}`, true);
                if (!hasRange) { a = 0; b = this.lines.length - 1; }
                const hit = (l) => { re.lastIndex = 0; return re.test(l) !== inv; };
                if (/^d(elete)?$/.test(m[5])) {
                    this.snap();
                    const before = this.lines.length;
                    this.lines = this.lines.filter((l, y) => y < a || y > b || !hit(l));
                    if (!this.lines.length) this.lines = [''];
                    this.touch(); this.clamp();
                    return this.say(`${before - this.lines.length} 行が削除されました`);
                }
                if (!m[5] || m[5] === 'p') return this.show(this.lines.filter((l, y) => y >= a && y <= b && hit(l)));
                return this.say('E492: :g で使えるのは d と p だけです', true);
            }
            m = rest.match(/^([a-zA-Z]+|[!<>=&])(!?)\s*(.*)$/s);
            if (!m) return this.say(`E492: エディタのコマンドではありません: ${line}`, true);
            const [, name, bang, arg] = m;
            const is = (full, min = 1) => full.startsWith(name) && name.length >= min;
            const leave = () => this.quit(0);
            if (is('write') || is('update', 2)) return void this.write(arg, !!bang);
            if (is('wq', 2) || is('xit') || is('exit', 3)) { if ((name[0] === 'w' || this.modified || arg) ? this.write(arg, !!bang) : true) leave(); return; }
            if (is('quit') || is('qall', 2) || is('close', 3)) { if (this.modified && !bang) return this.say('E37: 最後の変更が保存されていません (! を追加で変更を破棄)', true); return leave(); }
            if (is('edit')) {
                if (this.modified && !bang) return this.say('E37: 最後の変更が保存されていません (! を追加で変更を破棄)', true);
                if (!arg && !this.file) return this.say('E32: ファイル名がありません', true);
                this.ro = false;
                return this.edit(arg || this.file);
            }
            if (is('read')) {
                const n = this.fs.get(this.c.path(arg));
                if (!n || n.t !== 'f') return this.say(`E484: ファイル "${arg}" を開けません`, true);
                const add = n.data.replace(/\n$/, '').split('\n');
                this.snap(); this.lines.splice(b + 1, 0, ...add); this.cy = b + 1; this.cx = 0; this.touch();
                return;
            }
            if (is('delete')) { this.cy = a; return this.operate('d', { y: a, x: 0 }, { y: b, x: 0 }, true); }
            if (is('yank')) { const keep = [this.cy, this.cx]; this.operate('y', { y: a, x: 0 }, { y: b, x: 0 }, true); [this.cy, this.cx] = keep; return; }
            if (name === '>' || name === '<') { this.cy = a; return this.operate(name, { y: a, x: 0 }, { y: b, x: 0 }, true); }
            if (is('join')) { this.cy = a; return this.join(Math.max(2, b - a + 1)); }
            if (is('move')) { const [dst] = this.addr(arg); if (dst === null) return this.say('E14: 無効なアドレスです', true); this.snap(); const cut = this.lines.splice(a, b - a + 1); const at = dst >= b ? dst - cut.length + 1 : dst + 1; this.lines.splice(arg.trim() === '0' ? 0 : at, 0, ...cut); this.cy = (arg.trim() === '0' ? 0 : at) + cut.length - 1; this.touch(); return; }
            if (is('copy', 2) || name === 't') { const [dst] = this.addr(arg); if (dst === null) return this.say('E14: 無効なアドレスです', true); this.snap(); const cp = this.lines.slice(a, b + 1); this.lines.splice(arg.trim() === '0' ? 0 : dst + 1, 0, ...cp); this.cy = (arg.trim() === '0' ? 0 : dst + 1) + cp.length - 1; this.touch(); return; }
            if (is('sort', 3)) { if (!hasRange) { a = 0; b = this.lines.length - 1; } this.snap(); let part = this.lines.slice(a, b + 1).sort(/n/.test(arg) ? (p, q) => (parseFloat(p.match(/-?\d+(\.\d+)?/)?.[0]) || 0) - (parseFloat(q.match(/-?\d+(\.\d+)?/)?.[0]) || 0) : undefined); if (bang) part.reverse(); if (/u/.test(arg)) part = part.filter((l, i) => !i || l !== part[i - 1]); this.lines.splice(a, b - a + 1, ...part); this.cy = a; this.touch(); return; }
            if (is('normal', 4)) { for (let y = a; y <= b && y < this.lines.length; y++) { if (hasRange) { this.cy = y; this.cx = 0; } const was = this.replaying; this.replaying = true; for (const chh of arg) this.feed({ key: chh, text: chh }); if (this.mode !== 'n') this.feed({ key: 'Escape' }); this.replaying = was; } return; }
            if (is('set', 2)) { if (!arg) return this.show(Object.entries(this.o).map(([k, v]) => (typeof v === 'boolean' ? `${v ? '  ' : 'no'}${k}` : `  ${k}=${v}`))); return this.set(arg); }
            if (is('nohlsearch', 3)) { this.hlOff = true; return; }
            if (is('registers', 3) || is('display', 2)) return this.show(['--- レジスタ ---', `""   ${this.reg.text.replace(/\n/g, '^J').slice(0, 60)}`]);
            if (is('marks', 5)) return this.show(['mark 行   列', ...Object.entries(this.marks).map(([k, v]) => ` ${k} ${padL(v.y + 1, 5)} ${padL(v.x, 4)}`)]);
            if (is('version', 2)) return this.show(['VIM - Vi IMproved 風（地学會ターミナル版）', 'JavaScript で書かれた再現で、本物の Vim ではありません。', '', '対応: ノーマル / 挿入 / ビジュアル / 置換 / コマンドライン', '      オペレータ d c y > < g~ gu gU、テキストオブジェクト、カウント、.、u、Ctrl-R', '      / ? n N * #、:s :g :w :q :e :r :set :sort :normal :! ほか']);
            if (is('help') || name === 'h') return this.show(HELP);
            if (is('smile', 3)) return this.show(['', '        .  *  .      ', '     *    M45    *   ', '        .  *  .      ', '', '   :smile は地学會版では星団になります。']);
            if (is('syntax', 2) || is('colorscheme', 4) || is('filetype', 5) || is('source', 2) || is('highlight', 2)) return;
            if (name === '!') { this.c.sh.capture(arg.replace(/%/g, this.file || '')).then((out) => { this.show(['', ...out.replace(/\n$/, '').split('\n').map(T.util.stripAnsi)]); this.render(); }); return; }
            if (name === '=') return this.say(String(b + 1));
            this.say(`E492: エディタのコマンドではありません: ${line}`, true);
        }
        show(rows) { this.page = rows; }

        // ---------- 描画 ----------
        wrapRows(l, tw) {
            const rows = [];
            let start = 0, w = 0, col = 0;
            for (let i = 0; i < l.length; i++) {
                const cw2 = l[i] === '\t' ? this.o.ts - (col % this.o.ts) : cwOf(l[i]);
                if (w + cw2 > tw && i > start) { rows.push([start, i]); start = i; w = 0; }
                w += cw2; col += cw2;
            }
            rows.push([start, l.length]);
            return rows;
        }
        render() {
            const { rows, cols } = this.scr;
            const view = [];
            const textRows = rows - 1;
            if (this.page) {
                const body = this.page.flatMap((l) => this.wrapRows(l, cols).map(([s, e]) => cells(l.slice(s, e).replace(/\t/g, '    '))));
                for (const r of body.slice(-(textRows))) view.push(r);
                while (view.length < textRows) view.unshift('');
                view.push('<span class="f10">続けるにはENTERを押すかコマンドを入力してください</span><span class="cur"> </span>');
                return this.scr.draw(view);
            }
            const L = this.lines;
            const nu = this.o.nu || this.o.rnu;
            const numw = nu ? Math.max(3, String(L.length).length) + 1 : 0;
            const tw = Math.max(4, cols - numw);
            if (this.mode !== 'i' && this.mode !== 'R' && this.mode !== 'c') this.clamp();
            // カーソルが画面に入るように先頭行を決める
            if (this.cy < this.top) this.top = this.cy;
            const cursorRow = () => this.wrapRows(L[this.cy], tw).findIndex(([s, e], i, all) => this.cx >= s && (this.cx < e || i === all.length - 1));
            for (;;) {
                let used = 0;
                for (let y = this.top; y < this.cy; y++) used += this.wrapRows(L[y], tw).length;
                if (used + cursorRow() < textRows || this.top >= this.cy) break;
                this.top++;
            }
            let sel = null;
            if (this.mode === 'v' || this.mode === 'V') { let a = this.vs, b = { y: this.cy, x: this.cx }; if (a.y > b.y || (a.y === b.y && a.x > b.x)) [a, b] = [b, a]; sel = { a, b, line: this.mode === 'V' }; }
            const hl = this.o.hls && this.search && !this.hlOff ? this.search.re : null;
            const showCursor = this.mode !== 'c';
            let y = this.top;
            for (; y < L.length && view.length < textRows; y++) {
                const l = L[y];
                const segs = this.wrapRows(l, tw);
                if (view.length + segs.length > textRows && y !== this.top && y !== this.cy) { while (view.length < textRows) view.push('<span class="f12 bo">@</span>'); break; }
                const marks = new Uint8Array(l.length + 1);
                if (hl) { hl.lastIndex = 0; for (let m; (m = hl.exec(l));) { if (!m[0].length) { hl.lastIndex++; continue; } marks.fill(1, m.index, m.index + m[0].length); } }
                if (sel && y >= sel.a.y && y <= sel.b.y) { const s = sel.line || y > sel.a.y ? 0 : sel.a.x, e = sel.line || y < sel.b.y ? l.length + 1 : sel.b.x + 1; for (let i = s; i < e && i <= l.length; i++) marks[i] |= 2; }
                segs.forEach(([s, e], si) => {
                    let html = '';
                    if (nu) { const num = this.o.rnu && y !== this.cy ? Math.abs(y - this.cy) : y + 1; html += `<span class="f3">${si ? ' '.repeat(numw) : `${padL(num, numw - 1)} `}</span>`; }
                    let col = this.col(y, s), run = '', runCls = '';
                    const flush = () => { if (run) html += runCls ? `<span class="${runCls}">${cells(run)}</span>` : cells(run); run = ''; };
                    for (let i = s; i < e; i++) {
                        const cur = showCursor && y === this.cy && i === this.cx;
                        const k = cur ? 'cur' : marks[i] & 2 ? 'iv' : marks[i] & 1 ? 'g3 f0' : '';
                        if (k !== runCls) { flush(); runCls = k; }
                        if (l[i] === '\t') { const n = this.o.ts - (col % this.o.ts); run += ' '.repeat(n); col += n; } else { run += l[i]; col += cwOf(l[i]); }
                    }
                    flush();
                    if (si === segs.length - 1) {
                        if (showCursor && y === this.cy && this.cx >= l.length) html += '<span class="cur"> </span>';
                        else if (marks[l.length] & 2 && sel && (sel.line || y < sel.b.y)) html += '<span class="iv"> </span>';
                    }
                    if (view.length < textRows) view.push(html);
                });
            }
            this.bottom = Math.max(this.top, y - 1);
            while (view.length < textRows) view.push('<span class="f12 bo">~</span>');
            if (this.intro && L.length === 1 && !L[0] && this.mode === 'n') {
                const text = ['VIM - Vi IMproved 風', '', '地学會ターミナル版', 'JavaScript による再現です', '', '終了するには           :q<Enter>       ', '保存するには           :w<Enter>       ', 'ヘルプは               :help<Enter>    ', '挿入モードに入るには   i               '];
                const at = Math.max(1, Math.floor((textRows - text.length) / 2));
                text.forEach((t, i) => { if (at + i < textRows) view[at + i] = `<span class="f12 bo">~</span>${' '.repeat(Math.max(0, Math.floor((cols - T.util.width(t)) / 2) - 1))}${cells(t)}`; });
            }
            // 最下行：メッセージ／モード表示と、右端のルーラ
            let left;
            if (this.mode === 'c') left = `${cells(this.cmd.type + this.cmd.text)}<span class="cur"> </span>`;
            else if (this.msg) left = this.err ? `<span class="g1 f15">${cells(this.msg)}</span>` : cells(this.msg);
            else { const label = { i: '-- 挿入 --', R: '-- 置換 --', v: '-- ビジュアル --', V: '-- ビジュアル 行 --' }[this.mode]; left = label ? `<span class="bo">${cells(label)}</span>` : ''; }
            const plain = this.mode === 'c' ? this.cmd.type + this.cmd.text + ' ' : this.msg || { i: '-- 挿入 --', R: '-- 置換 --', v: '-- ビジュアル --', V: '-- ビジュアル 行 --' }[this.mode] || '';
            const pendKeys = (this.count || '') + (this.op ? this.op.k : '');
            const pos = L.length <= textRows && this.top === 0 ? '全て' : this.top === 0 ? '先頭' : this.bottom >= L.length - 1 ? '末尾' : `${Math.round(this.top / Math.max(1, L.length - textRows) * 100)}%`;
            const ruler = `${pad(pendKeys, 8)} ${pad(`${this.cy + 1},${this.len() ? this.cx + 1 : '0-1'}`, 12)}${pos}`;
            const room = cols - T.util.width(plain) - T.util.width(ruler) - 1;
            view.push(room >= 0 && this.mode !== 'c' ? `${left}${' '.repeat(room)}${cells(ruler)}` : left);
            this.scr.draw(view);
        }
    }

    const HELP = [
        '地学會ターミナルの vim ─ よく使う操作', '',
        '  移動      h j k l  w b e  0 ^ $  gg G  {数}G  f{字} t{字} ; ,  %  { }  H M L  Ctrl-F/B/D/U',
        '  挿入      i a I A o O  →  Esc でノーマルモードへ',
        '  編集      x  dd  dw  d$  D  cc  cw  C  s  r{字}  R  J  ~  >>  <<  .（くり返し）',
        '  コピペ    yy  yw  y$  p  P',
        '  対象      iw aw  i" a"  i( a(  i{ a{  ip ap   例: ciw  di"  ya(',
        '  取り消し  u   やり直し Ctrl-R',
        '  選択      v（文字）  V（行）  →  d y c > < ~ J  など',
        '  検索      /語  ?語  n N  * #    :noh で強調を消す',
        '  置換      :s/旧/新/   :%s/旧/新/g   :10,20s/旧/新/g',
        '  ファイル  :w  :w 名前  :q  :q!  :wq  :x  ZZ  :e 名前  :r 名前',
        '  その他    :set nu / nonu / rnu / hls / ic / sw=4   :{行番号}   :g/語/d   :sort   :!コマンド',
        '', '  数を前につけるとくり返します（3dd, 5j, 2dw）。',
    ];

    T.vim = (c) => {
        const args = c.args.filter((a) => !a.startsWith('-') && !a.startsWith('+'));
        if (!c.tty) { c.err('Vim: 警告: 端末への出力ではありません\n'); return 1; }
        return new Promise((resolve) => {
            const scr = c.term.openScreen();
            const vim = new Vim(c, scr, (code) => { scr.close(); resolve(code); }, { file: args[0], readonly: c.name === 'view' || c.args.includes('-R') });
            const plus = c.args.find((a) => /^\+\d+$/.test(a));
            if (plus) { vim.ex(plus.slice(1)); vim.render(); }
        });
    };
    for (const n of ['vim', 'vi', 'view']) T.commands[n] = T.vim;
    T.docs.vim = { names: ['vim', 'vi', 'view'], usage: 'vim [ファイル]', desc: 'Vi IMproved 風のテキストエディタ', more: 'モードのあるエディタです。起動直後はノーマルモードで、i で挿入モード、Esc でノーマルモードにもどります。\n保存して終了は :wq、保存せずに終了は :q! です。\n操作の一覧は、vim の中で :help と打つと出ます。\n\n本物の Vim ではなく、よく使う操作を再現したものです。\nホームディレクトリ以下のファイルは書きかえて保存できます（このブラウザの中に残ります）。' };
})();
