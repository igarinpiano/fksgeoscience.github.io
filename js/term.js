// 地学會ターミナル：端末（表示とキー入力）・仮想ファイルシステム・シェル。
// XPモードのウィンドウ（xp.js）と、ターミナル版（term.htm）の両方から使います。
// コマンドは js/term-cmds.js、btop は js/btop.js、Vim は js/vim.js が FksTerm に登録します。
(() => {
    'use strict';

    const HOME = '/home/fks', USER = 'fks', HOST = 'dome';
    const BASE_TIME = Date.parse('2026-04-15T12:00:00+09:00');
    const STORE = 'fks-term-fs-v1';
    const E = {
        NOENT: 'そのようなファイルやディレクトリはありません', ACCES: '許可がありません', ISDIR: 'ディレクトリです',
        NOTDIR: 'ディレクトリではありません', EXIST: 'ファイルが存在します', NOTEMPTY: 'ディレクトリは空ではありません',
    };
    class Interrupt extends Error {}

    // ================= 文字幅と表示 =================
    // 日本語の端末と同じく、全角・曖昧幅の文字は2桁ぶんとして扱う。
    // 表示側でも全角文字を 2ch 幅の箱に入れるので、フォントが何であっても桁がそろう。
    const LATIN_WIDE = new Set([0xa7, 0xa8, 0xb0, 0xb1, 0xb4, 0xb6, 0xd7, 0xf7]);
    function cw(ch) {
        const cp = ch.codePointAt(0);
        if (cp < 0xa0) return 1;
        if (cp >= 0x1100) return (cp >= 0xff61 && cp <= 0xffdc) || (cp >= 0xffe8 && cp <= 0xffee) ? 1 : 2;
        if (cp >= 0x370 && cp <= 0x451) return 2;
        return LATIN_WIDE.has(cp) ? 2 : 1;
    }
    const width = (s) => { let n = 0; for (const ch of s) n += cw(ch); return n; };
    const escHtml = (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c);
    function cells(s) {
        let out = '';
        for (const ch of s) {
            const cp = ch.codePointAt(0);
            if (cp < 0x20 || cp === 0x7f) continue;
            out += cw(ch) === 2 ? `<i>${ch}</i>` : escHtml(ch);
        }
        return out;
    }
    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
    const padL = (s, n) => ' '.repeat(Math.max(0, n - width(String(s)))) + s;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

    // ANSI の色指定（SGR）を span に変換する
    function sgrClass(codes) {
        const st = { f: -1, g: -1, b: 0, d: 0, u: 0, v: 0, i: 0 };
        for (const c of codes) {
            if (c === 0) Object.assign(st, { f: -1, g: -1, b: 0, d: 0, u: 0, v: 0, i: 0 });
            else if (c === 1) st.b = 1; else if (c === 2) st.d = 1; else if (c === 3) st.i = 1; else if (c === 4) st.u = 1; else if (c === 7) st.v = 1;
            else if (c === 22) st.b = st.d = 0; else if (c === 24) st.u = 0; else if (c === 27) st.v = 0;
            else if (c >= 30 && c <= 37) st.f = c - 30; else if (c >= 90 && c <= 97) st.f = c - 82; else if (c === 39) st.f = -1;
            else if (c >= 40 && c <= 47) st.g = c - 40; else if (c >= 100 && c <= 107) st.g = c - 92; else if (c === 49) st.g = -1;
        }
        return [st.f >= 0 && `f${st.f}`, st.g >= 0 && `g${st.g}`, st.b && 'bo', st.d && 'di', st.u && 'ul', st.v && 'iv', st.i && 'it'].filter(Boolean).join(' ');
    }
    function ansi(s, codes = []) {
        let out = '', open = false;
        const parts = s.split(/\x1b\[([0-9;]*)m/);
        const start = (cls) => { if (open) out += '</span>'; open = !!cls; if (cls) out += `<span class="${cls}">`; };
        start(sgrClass(codes));
        for (let i = 0; i < parts.length; i++) {
            if (i % 2) {
                for (const c of (parts[i] || '0').split(';')) { const n = Number(c) || 0; if (n === 0) codes.length = 0; else codes.push(n); }
                start(sgrClass(codes));
            } else out += cells(parts[i]);
        }
        if (open) out += '</span>';
        return out;
    }

    // ================= 仮想ファイルシステム =================
    class FS {
        constructor() { this.root = this.dir('root'); this.gone = new Set(); }
        dir(owner = 'root', mode = 0o755) { return { t: 'd', c: new Map(), mode, owner, mtime: BASE_TIME }; }
        file(data = '', owner = 'root', mode = 0o644) { return { t: 'f', data, mode, owner, mtime: BASE_TIME }; }
        norm(path, cwd = '/') {
            if (!path.startsWith('/')) path = `${cwd}/${path}`;
            const out = [];
            for (const seg of path.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
            return `/${out.join('/')}`;
        }
        get(abs) {
            let n = this.root;
            if (abs === '/') return n;
            for (const seg of abs.slice(1).split('/')) { if (n.t !== 'd') return null; n = n.c.get(seg); if (!n) return null; }
            return n;
        }
        split(abs) { const i = abs.lastIndexOf('/'); return [abs.slice(0, i) || '/', abs.slice(i + 1)]; }
        canRead(abs) { return !(abs === '/root' || abs.startsWith('/root/')); }
        canWrite(abs) { return abs === '/dev/null' || abs === HOME || abs.startsWith(`${HOME}/`) || abs === '/tmp' || abs.startsWith('/tmp/'); }
        mkdirp(abs, owner = 'root', user = false) {
            let n = this.root;
            for (const seg of abs.split('/').filter(Boolean)) {
                let next = n.c.get(seg);
                if (!next) { next = this.dir(owner); next.u = user; if (user) next.mtime = Date.now(); n.c.set(seg, next); }
                n = next;
            }
            return n;
        }
        // 読み書きは失敗理由を文字列で返す（null なら成功）
        write(abs, data, { user = true, append = false, owner = USER, mode } = {}) {
            if (abs === '/dev/null') return null;
            const [dirPath, name] = this.split(abs);
            const parent = this.get(dirPath);
            if (!parent) return E.NOENT;
            if (parent.t !== 'd') return E.NOTDIR;
            if (user && !this.canWrite(abs)) return E.ACCES;
            let node = parent.c.get(name);
            if (node && node.t === 'd') return E.ISDIR;
            if (!node) { node = this.file('', owner, mode ?? 0o644); parent.c.set(name, node); }
            node.data = append ? node.data + data : data;
            delete node.url;
            if (user) { node.mtime = Date.now(); node.u = true; this.gone.delete(abs); }
            return null;
        }
        remove(abs) {
            const [dirPath, name] = this.split(abs);
            const parent = this.get(dirPath);
            const node = parent?.c.get(name);
            if (!node) return E.NOENT;
            if (!this.canWrite(abs)) return E.ACCES;
            parent.c.delete(name);
            parent.mtime = Date.now();
            this.gone.add(abs);
            return null;
        }
        size(node) { return node.t === 'd' ? 4096 : node.size ?? new TextEncoder().encode(node.data).length; }
        walk(abs, fn) {
            const node = this.get(abs);
            if (!node) return;
            fn(abs, node);
            if (node.t === 'd') for (const name of [...node.c.keys()].sort()) this.walk(abs === '/' ? `/${name}` : `${abs}/${name}`, fn);
        }
        // ユーザーが作った・書き換えたものだけをブラウザに保存する
        save() {
            const files = [], dirs = [];
            for (const top of [HOME, '/tmp']) this.walk(top, (p, n) => { if (!n.u) return; if (n.t === 'd') dirs.push(p); else files.push([p, n.data, n.mtime, n.mode]); });
            try { localStorage.setItem(STORE, JSON.stringify({ files, dirs, gone: [...this.gone] })); } catch { /* 保存できなくても動く */ }
        }
        load() {
            let saved;
            try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { saved = null; }
            if (!saved) return;
            for (const p of saved.gone || []) { const [d, name] = this.split(p); this.get(d)?.c.delete(name); this.gone.add(p); }
            for (const p of saved.dirs || []) this.mkdirp(p, USER, true);
            for (const [p, data, mtime, mode] of saved.files || []) {
                this.mkdirp(this.split(p)[0], USER, true);
                if (!this.write(p, data, { mode })) { const n = this.get(p); n.mtime = mtime; }
            }
        }
    }

    // ================= 端末 =================
    class Terminal {
        constructor(root, opts = {}) {
            this.root = root;
            this.opts = opts;
            root.classList.add('term');
            root.innerHTML = `
                <div class="term__scroll"><div class="term__out"></div><div class="term__line"></div></div>
                <div class="term__screen" hidden></div>
                <textarea class="term__in" rows="1" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="ターミナル"></textarea>
                <div class="term__keys" hidden>${[['Escape', 'Esc'], ['Tab', 'Tab'], ['ctrl', 'Ctrl'], ['Left', '←'], ['Down', '↓'], ['Up', '↑'], ['Right', '→'], ['|', '|'], ['/', '/'], ['-', '-'], [':', ':'], ['~', '~']]
                    .map(([k, label]) => `<button type="button" data-k="${k}" tabindex="-1">${label}</button>`).join('')}</div>
                <span class="term__probe" aria-hidden="true">0</span>`;
            const q = (s) => root.querySelector(s);
            this.scrollEl = q('.term__scroll'); this.outEl = q('.term__out'); this.lineEl = q('.term__line');
            this.screenEl = q('.term__screen'); this.input = q('.term__in'); this.keysEl = q('.term__keys'); this.probe = q('.term__probe');
            this.curEl = null; this.curRaw = ''; this.sgr = [];
            this.rl = null; this.scr = null; this.ctrlNext = false; this.composing = false;
            this.cols = 80; this.rows = 24;
            if (matchMedia('(pointer: coarse)').matches) this.keysEl.hidden = false;
            this.bind();
            this.measure();
            new ResizeObserver(() => this.measure()).observe(root);
            document.fonts?.ready.then(() => this.measure());
        }

        measure() {
            const r = this.probe.getBoundingClientRect();
            if (!r.width) return;
            const box = this.scr ? this.screenEl : this.scrollEl;
            const cs = getComputedStyle(box);
            const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            const cols = Math.max(20, Math.floor(w / r.width)), rows = Math.max(6, Math.floor(h / r.height));
            if (cols === this.cols && rows === this.rows) return;
            this.cols = cols; this.rows = rows;
            if (this.scr) { this.buildScreen(); this.scr.onResize?.(); }
        }

        // ---------- 出力 ----------
        write(s) {
            s = String(s);
            if (!s) return;
            const lines = s.split('\n');
            lines.forEach((part, i) => {
                if (i > 0) this.newline();
                if (!part) return;
                const cr = part.lastIndexOf('\r');
                if (cr >= 0) { this.curRaw = ''; part = part.slice(cr + 1); }
                if (!this.curEl) { this.curEl = document.createElement('div'); this.outEl.append(this.curEl); this.lineSgr = this.sgr.slice(); }
                this.curRaw += part;
                this.sgr = this.lineSgr.slice();
                this.curEl.innerHTML = ansi(this.curRaw, this.sgr);
            });
            while (this.outEl.childElementCount > 1500) this.outEl.firstElementChild.remove();
            this.toEnd();
        }
        newline() {
            if (!this.curEl) this.outEl.append(document.createElement('div'));
            this.curEl = null; this.curRaw = '';
        }
        clear() { this.outEl.replaceChildren(); this.curEl = null; this.curRaw = ''; this.sgr = []; }
        toEnd() { this.scrollEl.scrollTop = this.scrollEl.scrollHeight; }

        // ---------- 1行入力（readline 相当） ----------
        readLine(prompt, { history = [], complete = null, mask = false } = {}) {
            return new Promise((resolve) => {
                if (this.curEl) this.newline();
                this.rl = { prompt, buf: [], pos: 0, history, hi: history.length, stash: '', complete, mask, resolve, tabs: 0 };
                this.drawLine();
                const ahead = this.ahead || [];
                this.ahead = [];
                while (ahead.length) { const k = ahead.shift(); if (this.rl || this.scr) this.key(k); else { this.ahead = [k, ...ahead]; break; } }
            });
        }
        drawLine() {
            const rl = this.rl;
            if (!rl) { this.lineEl.innerHTML = ''; return; }
            const shown = rl.mask ? [] : rl.buf;
            const at = rl.mask ? 0 : rl.pos;
            this.lineEl.innerHTML = `${ansi(rl.prompt)}${cells(shown.slice(0, at).join(''))}<span class="cur">${cells(shown[at] ?? ' ')}</span>${cells(shown.slice(at + 1).join(''))}`;
            this.toEnd();
            this.placeInput();
        }
        endLine(result, echo = '') {
            const rl = this.rl;
            this.rl = null;
            this.lineEl.innerHTML = '';
            this.write(`${rl.prompt}${rl.mask ? '' : rl.buf.join('')}${echo}\n`);
            rl.resolve(result);
        }
        lineKey(k) {
            const rl = this.rl;
            const set = (text) => { rl.buf = [...text]; rl.pos = rl.buf.length; };
            if (k.key !== 'Tab') rl.tabs = 0;
            if (k.ctrl) {
                switch (k.key) {
                    case 'c': return this.endLine('', '^C');
                    case 'd': if (!rl.buf.length) return this.endLine(null); rl.buf.splice(rl.pos, 1); break;
                    case 'a': rl.pos = 0; break;
                    case 'e': rl.pos = rl.buf.length; break;
                    case 'b': rl.pos = Math.max(0, rl.pos - 1); break;
                    case 'f': rl.pos = Math.min(rl.buf.length, rl.pos + 1); break;
                    case 'u': rl.buf.splice(0, rl.pos); rl.pos = 0; break;
                    case 'k': rl.buf.splice(rl.pos); break;
                    case 'h': if (rl.pos) rl.buf.splice(--rl.pos, 1); break;
                    case 'w': { let p = rl.pos; while (p && rl.buf[p - 1] === ' ') p--; while (p && rl.buf[p - 1] !== ' ') p--; rl.buf.splice(p, rl.pos - p); rl.pos = p; break; }
                    case 'l': this.clear(); break;
                    case 'p': return this.lineKey({ key: 'Up' });
                    case 'n': return this.lineKey({ key: 'Down' });
                    default: return;
                }
                return this.drawLine();
            }
            switch (k.key) {
                case 'Enter': return this.endLine(rl.buf.join(''));
                case 'Backspace': if (rl.pos) rl.buf.splice(--rl.pos, 1); break;
                case 'Delete': rl.buf.splice(rl.pos, 1); break;
                case 'Left': rl.pos = Math.max(0, rl.pos - 1); break;
                case 'Right': rl.pos = Math.min(rl.buf.length, rl.pos + 1); break;
                case 'Home': rl.pos = 0; break;
                case 'End': rl.pos = rl.buf.length; break;
                case 'Up': if (rl.hi > 0) { if (rl.hi === rl.history.length) rl.stash = rl.buf.join(''); set(rl.history[--rl.hi]); } break;
                case 'Down': if (rl.hi < rl.history.length) { rl.hi++; set(rl.hi === rl.history.length ? rl.stash : rl.history[rl.hi]); } break;
                case 'Tab': this.completeLine(); return;
                case 'Escape': return;
                default: if (k.text) { rl.buf.splice(rl.pos, 0, k.text); rl.pos++; }
            }
            this.drawLine();
        }
        completeLine() {
            const rl = this.rl;
            if (!rl.complete || rl.mask) return;
            const head = rl.buf.slice(0, rl.pos).join('');
            const res = rl.complete(head);
            if (!res || !res.list.length) return;
            const { word, list } = res;
            let common = list[0];
            for (const c of list) { let i = 0; while (i < common.length && common[i] === c[i]) i++; common = common.slice(0, i); }
            const add = list.length === 1 ? list[0] + (list[0].endsWith('/') ? '' : ' ') : common;
            if (add.length > word.length) {
                const ins = [...add.slice(word.length)];
                rl.buf.splice(rl.pos, 0, ...ins); rl.pos += ins.length; rl.tabs = 0;
                return this.drawLine();
            }
            if (list.length > 1 && ++rl.tabs >= 2) {
                // 候補を一覧して、入力中の行はそのまま続ける
                const keep = rl;
                this.rl = null;
                this.lineEl.innerHTML = '';
                this.write(`${keep.prompt}${keep.buf.join('')}\n${columns(list.map((c) => c.split('/').filter(Boolean).pop() + (c.endsWith('/') ? '/' : '')), this.cols)}\n`);
                this.rl = keep;
                this.drawLine();
            }
        }

        // ---------- 全画面アプリ（vim, less など） ----------
        openScreen() {
            const scr = { onKey: null, onResize: null, onClick: null, onWheel: null, cache: [], closed: false };
            scr.draw = (rows) => {
                if (scr.closed) return;
                for (let i = 0; i < this.rows; i++) {
                    const html = rows[i] ?? '';
                    if (scr.cache[i] !== html) { scr.cache[i] = html; this.screenEl.children[i].innerHTML = html; }
                }
                this.placeInput();
            };
            scr.close = () => {
                if (scr.closed) return;
                scr.closed = true;
                this.scr = null;
                this.screenEl.hidden = true; this.scrollEl.hidden = false;
                this.measure(); this.toEnd(); this.placeInput();
            };
            Object.defineProperties(scr, { rows: { get: () => this.rows }, cols: { get: () => this.cols } });
            this.scr = scr;
            this.scrollEl.hidden = true; this.screenEl.hidden = false;
            this.buildScreen();
            this.measure();
            return scr;
        }
        buildScreen() {
            this.screenEl.replaceChildren(...Array.from({ length: this.rows }, () => document.createElement('div')));
            if (this.scr) this.scr.cache = [];
        }

        // ---------- キー入力 ----------
        key(k) {
            if (this.ctrlNext && k.text) { k = { key: k.key.toLowerCase(), ctrl: true }; this.setCtrl(false); }
            if (this.scr) return this.scr.onKey?.(k);
            if (this.rl) return this.lineKey(k);
            if (k.ctrl && k.key === 'c') { this.ahead = []; this.onInterrupt?.(); } else if ((this.ahead ??= []).length < 256) this.ahead.push(k);
        }
        text(s) {
            for (const ch of s.replace(/\r\n?/g, '\n')) {
                if (ch === '\n') this.key({ key: 'Enter' });
                else if (ch === '\t') this.key({ key: 'Tab' });
                else this.key({ key: ch, text: ch });
            }
        }
        setCtrl(on) { this.ctrlNext = on; this.keysEl.querySelector('[data-k="ctrl"]').classList.toggle('is-on', on); }
        focus() { this.input.focus({ preventScroll: true }); }
        placeInput() {
            // 変換中の文字や候補ウィンドウがカーソルの位置に出るよう、入力欄を重ねておく
            const cur = (this.scr ? this.screenEl : this.lineEl).querySelector('.cur');
            if (!cur) return;
            const a = cur.getBoundingClientRect(), b = this.root.getBoundingClientRect();
            this.input.style.left = `${Math.max(0, Math.min(a.left - b.left, b.width - 40))}px`;
            this.input.style.top = `${Math.max(0, a.top - b.top)}px`;
        }
        bind() {
            const NAMES = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Esc: 'Escape' };
            const SPECIAL = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown']);
            const ta = this.input;
            ta.addEventListener('keydown', (ev) => {
                if (ev.isComposing || this.composing || ev.keyCode === 229) return;
                const name = NAMES[ev.key] || ev.key;
                if (ev.metaKey) return;
                if (ev.ctrlKey && name.length === 1) {
                    // コピー（選択中の Ctrl+C）と貼り付けはブラウザに任せる
                    if (name.toLowerCase() === 'v' || (name.toLowerCase() === 'c' && String(getSelection()))) return;
                    ev.preventDefault();
                    return this.key({ key: name === '[' ? 'Escape' : name.toLowerCase(), ctrl: name !== '[' });
                }
                if (SPECIAL.has(name)) { ev.preventDefault(); ev.stopPropagation(); this.key({ key: name, shift: ev.shiftKey }); }
            });
            ta.addEventListener('compositionstart', () => { this.composing = true; ta.classList.add('is-ime'); });
            ta.addEventListener('compositionend', () => {
                this.composing = false; ta.classList.remove('is-ime');
                const v = ta.value; ta.value = '';
                if (v) this.text(v);
            });
            ta.addEventListener('input', () => {
                if (this.composing) return;
                const v = ta.value; ta.value = '';
                if (v) this.text(v);
            });
            ta.addEventListener('focus', () => this.root.classList.add('is-focus'));
            ta.addEventListener('blur', () => this.root.classList.remove('is-focus'));
            this.root.addEventListener('click', (ev) => { if (!ev.target.closest('.term__keys') && !String(getSelection())) this.focus(); });
            // 全画面アプリへのクリックとホイールは、桁と行に直して渡す（btop の見出しやプロセスの行）
            this.screenEl.addEventListener('click', (ev) => {
                if (!this.scr?.onClick || String(getSelection())) return;
                const cell = this.probe.getBoundingClientRect(), box = this.screenEl.getBoundingClientRect(), cs = getComputedStyle(this.screenEl);
                this.scr.onClick(Math.floor((ev.clientX - box.left - parseFloat(cs.paddingLeft)) / cell.width), Math.floor((ev.clientY - box.top - parseFloat(cs.paddingTop)) / cell.height));
            });
            this.screenEl.addEventListener('wheel', (ev) => { if (this.scr?.onWheel && ev.deltaY) { ev.preventDefault(); this.scr.onWheel(Math.sign(ev.deltaY)); } }, { passive: false });
            this.keysEl.addEventListener('pointerdown', (ev) => {
                const b = ev.target.closest('[data-k]');
                if (!b) return;
                ev.preventDefault();
                const k = b.dataset.k;
                if (k === 'ctrl') this.setCtrl(!this.ctrlNext);
                else if (k.length === 1) this.key({ key: k, text: k });
                else this.key({ key: k });
                this.focus();
            });
        }
    }

    // 名前の一覧を、端末の幅に合わせて段組みする（ls と同じ並び）
    function columns(names, cols) {
        if (!names.length) return '';
        const plain = names.map(stripAnsi);
        const colw = Math.max(...plain.map(width)) + 2;
        const per = Math.max(1, Math.floor(cols / colw));
        const rows = Math.ceil(names.length / per);
        const out = [];
        for (let r = 0; r < rows; r++) {
            let line = '';
            for (let c = 0; c < per; c++) {
                const i = c * rows + r;
                if (i >= names.length) break;
                line += names[i] + (c < per - 1 && i + rows < names.length ? ' '.repeat(colw - width(plain[i])) : '');
            }
            out.push(line);
        }
        return out.join('\n');
    }

    // ================= シェル =================
    const OPS = ['2>&1', '2>>', '&&', '||', '>>', '2>', '|', ';', '>', '<', '&'];

    class Shell {
        constructor(term, fs, opts = {}) {
            this.term = term; this.fs = fs; this.opts = opts;
            this.cwd = HOME; this.prev = HOME;
            this.env = { HOME, USER, LOGNAME: USER, HOSTNAME: HOST, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/games', TERM: 'xterm-256color', LANG: 'ja_JP.UTF-8', EDITOR: 'vim', PAGER: 'less', PWD: HOME, OLDPWD: HOME, '?': '0' };
            this.aliases = { ll: 'ls -l', la: 'ls -A', l: 'ls -CF', ls: 'ls --color=auto', grep: 'grep --color=auto', vi: 'vim' };
            this.history = (fs.get(`${HOME}/.bash_history`)?.data || '').split('\n').filter(Boolean);
            this.sig = { aborted: false, wake: null };
            this.done = false;
            term.onInterrupt = () => { this.sig.aborted = true; this.sig.wake?.(); };
        }
        get prompt() {
            const where = this.cwd === HOME ? '~' : this.cwd.startsWith(`${HOME}/`) ? `~${this.cwd.slice(HOME.length)}` : this.cwd;
            return `\x1b[1;32m${USER}@${HOST}\x1b[0m:\x1b[1;34m${where}\x1b[0m$ `;
        }
        async loop() {
            while (!this.done) {
                const line = await this.term.readLine(this.prompt, { history: this.history, complete: (head) => this.complete(head) });
                if (line === null) { this.term.write('logout\n'); await this.run('exit'); continue; }
                await this.run(line);
            }
        }
        path(p) { return this.fs.norm(p, this.cwd); }
        sleep(ms) {
            return new Promise((resolve, reject) => {
                if (this.sig.aborted) return reject(new Interrupt());
                const t = setTimeout(() => { this.sig.wake = null; resolve(); }, ms);
                this.sig.wake = () => { clearTimeout(t); this.sig.wake = null; reject(new Interrupt()); };
            });
        }

        // ---------- 補完 ----------
        complete(head) {
            const m = head.match(/(?:^|[\s|;&<>])([^\s|;&<>]*)$/);
            const word = m ? m[1] : '';
            const seg = head.replace(/^.*[|;&]\s*/, '').replace(/^\s+/, '').split(/\s+/);
            const isCmd = !word.includes('/') && (seg.length === 1 || (seg.length === 2 && /^(sudo|man|which|type|whatis)$/.test(seg[0])));
            if (isCmd) {
                const names = [...new Set([...Object.keys(FksTerm.commands), ...Object.keys(this.aliases)])].filter((n) => n.startsWith(word)).sort();
                return { word, list: names };
            }
            const slash = word.lastIndexOf('/');
            const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
            const base = word.slice(slash + 1);
            const dir = this.fs.get(this.path(this.tilde(dirPart) || '.'));
            if (!dir || dir.t !== 'd') return null;
            const list = [...dir.c.entries()].filter(([n]) => n.startsWith(base) && (base.startsWith('.') || !n.startsWith('.'))).sort(([a], [b]) => a.localeCompare(b))
                .map(([n, node]) => dirPart + n.replace(/([ '"$&;|<>()\\])/g, '\\$1') + (node.t === 'd' ? '/' : ''));
            return { word, list };
        }
        tilde(w) { return w === '~' ? HOME : w.startsWith('~/') ? HOME + w.slice(1) : w; }

        // ---------- 字句解析 ----------
        tokenize(line) {
            const toks = [];
            let i = 0, cur = null;
            const part = (q) => { cur ??= { t: 'w', parts: [] }; let p = cur.parts[cur.parts.length - 1]; if (!p || p.q !== q) { p = { s: '', q }; cur.parts.push(p); } return p; };
            const flush = () => { if (cur) { toks.push(cur); cur = null; } };
            while (i < line.length) {
                const c = line[i];
                if (c === ' ' || c === '\t') { flush(); i++; continue; }
                if (c === '#' && !cur) break;
                if (c === '\\') { part(1).s += line[i + 1] ?? ''; i += 2; continue; }
                if (c === "'") { const j = line.indexOf("'", i + 1); if (j < 0) throw new Error('対応する `\'\' が見つかりません'); part(1).s += line.slice(i + 1, j); i = j + 1; continue; }
                if (c === '"') {
                    let j = i + 1; const p = part(2);
                    for (; j < line.length && line[j] !== '"'; j++) { if (line[j] === '\\' && '"\\$`'.includes(line[j + 1])) { p.s += `\x00${line[++j]}`; } else p.s += line[j]; }
                    if (j >= line.length) throw new Error('対応する `"\' が見つかりません');
                    i = j + 1; continue;
                }
                if (c === '$' && line[i + 1] === '(') {
                    let depth = 0, j = i + 1;
                    for (; j < line.length; j++) { if (line[j] === '(') depth++; else if (line[j] === ')' && --depth === 0) break; }
                    if (j >= line.length) throw new Error('対応する `)\' が見つかりません');
                    part(0).s += line.slice(i, j + 1); i = j + 1; continue;
                }
                const op = OPS.find((o) => line.startsWith(o, i) && !(o.startsWith('2') && cur));
                if (op) { flush(); toks.push({ t: 'op', v: op }); i += op.length; continue; }
                part(0).s += c; i++;
            }
            flush();
            return toks;
        }
        parse(line) {
            const toks = this.tokenize(line);
            const list = [];
            let pipe = [], cmd = { words: [], redirs: [] };
            const endCmd = () => { if (cmd.words.length || cmd.redirs.length) pipe.push(cmd); cmd = { words: [], redirs: [] }; };
            const endPipe = (op) => { endCmd(); if (pipe.length) list.push({ pipe, op }); pipe = []; };
            for (let i = 0; i < toks.length; i++) {
                const t = toks[i];
                if (t.t === 'w') { cmd.words.push(t); continue; }
                if (t.v === '|') { if (!cmd.words.length) throw new Error("構文エラー: 予期しないトークン `|' 周辺"); endCmd(); continue; }
                if (t.v === ';' || t.v === '&&' || t.v === '||' || t.v === '&') { if (!cmd.words.length && !pipe.length) throw new Error(`構文エラー: 予期しないトークン \`${t.v}' 周辺`); endPipe(t.v); continue; }
                if (t.v === '2>&1') { cmd.redirs.push({ op: t.v }); continue; }
                const target = toks[++i];
                if (!target || target.t !== 'w') throw new Error("構文エラー: 予期しないトークン `newline' 周辺");
                cmd.redirs.push({ op: t.v, target });
            }
            endPipe(';');
            return list;
        }

        // ---------- 展開 ----------
        async expandStr(s, quoted) {
            let out = '';
            for (let i = 0; i < s.length; i++) {
                const c = s[i];
                if (c === '\x00') { out += s[++i]; continue; }
                if (c !== '$') { out += c; continue; }
                if (s.startsWith('$((', i)) {
                    const j = s.indexOf('))', i);
                    const expr = await this.expandStr(s.slice(i + 3, j), true);
                    out += /^[\d\s+\-*/%()]+$/.test(expr) ? String(Math.trunc(Function(`"use strict";return (${expr})`)())) : '0';
                    i = j + 1; continue;
                }
                if (s[i + 1] === '(') {
                    let depth = 0, j = i + 1;
                    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
                    const sub = (await this.capture(s.slice(i + 2, j))).replace(/\n+$/, '');
                    out += quoted ? sub : sub.trim().replace(/\s+/g, ' ');
                    i = j; continue;
                }
                const m = s.slice(i + 1).match(/^(\{[A-Za-z_?][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*|[?$#0])/);
                if (!m) { out += c; continue; }
                const name = m[1].replace(/[{}]/g, '');
                out += name === '$' ? '4126' : name === '0' ? '-bash' : name === '#' ? '0' : this.env[name] ?? '';
                i += m[1].length;
            }
            return quoted ? out : out;
        }
        glob(pattern) {
            if (!/[*?[]/.test(pattern)) return null;
            const abs = pattern.startsWith('/');
            const segs = pattern.split('/').filter(Boolean);
            let found = [abs ? '' : null];
            for (const seg of segs) {
                const next = [];
                const re = /[*?[]/.test(seg) ? new RegExp(`^${seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`) : null;
                for (const base of found) {
                    const dirPath = base === null ? this.cwd : this.fs.norm(base || '/', this.cwd);
                    const dir = this.fs.get(dirPath);
                    if (!dir || dir.t !== 'd') continue;
                    const join = (n) => (base === null ? n : `${base}/${n}`);
                    if (!re) { if (seg === '.' || seg === '..' || dir.c.has(seg)) next.push(join(seg)); continue; }
                    for (const n of [...dir.c.keys()].sort()) if (re.test(n) && (seg.startsWith('.') || !n.startsWith('.'))) next.push(join(n));
                }
                found = next;
            }
            return found.length ? found : null;
        }
        async expandWord(tok) {
            let text = '', globbable = false, quotedAny = false;
            for (let i = 0; i < tok.parts.length; i++) {
                const p = tok.parts[i];
                if (p.q === 1) { text += p.s.replace(/[*?[]/g, '\x01$&'); quotedAny = true; continue; }
                let s = await this.expandStr(i === 0 && p.q === 0 ? this.tilde(p.s) : p.s, p.q === 2);
                if (p.q === 2) { s = s.replace(/[*?[]/g, '\x01$&'); quotedAny = true; } else if (/[*?[]/.test(s)) globbable = true;
                text += s;
            }
            if (globbable) {
                const hits = this.glob(text.replace(/\x01(.)/g, '[$1]'));
                if (hits) return hits;
            }
            const plain = text.replace(/\x01/g, '');
            return plain === '' && !quotedAny ? [] : [plain];
        }

        // ---------- 実行 ----------
        async capture(line) {
            let buf = '';
            await this.run(line, { out: (s) => { buf += s; }, record: false });
            return buf;
        }
        async run(line, { out = null, record = true } = {}) {
            line = line.trim();
            if (record && line) {
                line = line.replace(/!!/g, () => this.history[this.history.length - 1] || '');
                if (this.history[this.history.length - 1] !== line) this.history.push(line);
            }
            if (!line) return 0;
            let list;
            try { list = this.parse(line); } catch (err) { this.term.write(`-bash: ${err.message}\n`); return this.status(2); }
            this.sig.aborted = false;
            let code = 0, skip = false;
            for (const { pipe, op } of list) {
                if (!skip) {
                    try { code = await this.pipeline(pipe, out); } catch (err) {
                        if (!(err instanceof Interrupt)) { this.term.write(`-bash: ${err.message}\n`); code = 1; } else { this.term.write('^C\n'); code = 130; }
                    }
                    this.status(code);
                }
                if (this.sig.aborted || this.done) break;
                skip = op === '&&' ? code !== 0 : op === '||' ? code === 0 : false;
            }
            if (record) { this.fs.write(`${HOME}/.bash_history`, `${this.history.slice(-500).join('\n')}\n`); this.fs.save(); }
            return code;
        }
        status(code) { this.env['?'] = String(code); return code; }
        async pipeline(cmds, sink) {
            let stdin = null, code = 0;
            for (let i = 0; i < cmds.length; i++) {
                const cmd = cmds[i], last = i === cmds.length - 1;
                let outFile = null, errFile = null, append = false, errToOut = false, errAppend = false;
                for (const r of cmd.redirs) {
                    if (r.op === '2>&1') { errToOut = true; continue; }
                    const [target] = await this.expandWord(r.target);
                    if (target === undefined) throw new Error('曖昧なリダイレクトです');
                    const abs = this.path(target);
                    if (r.op === '<') {
                        const n = this.fs.get(abs);
                        if (!n) throw new Error(`${target}: ${E.NOENT}`);
                        if (n.t === 'd') throw new Error(`${target}: ${E.ISDIR}`);
                        stdin = n.data;
                    } else if (r.op.startsWith('2')) { errFile = abs; errAppend = r.op === '2>>'; } else { outFile = abs; append = r.op === '>>'; }
                    if (r.op !== '<') { const fail = this.fs.write(abs, '', { append: true }); if (fail) throw new Error(`${target}: ${fail}`); }
                }
                let outBuf = '', errBuf = '';
                const capture = !last || outFile || sink;
                const out = capture ? (s) => { outBuf += s; } : (s) => this.term.write(s);
                const err = errFile ? (s) => { errBuf += s; } : errToOut ? out : (s) => this.term.write(s);
                code = await this.command(cmd, { stdin, out, err, tty: !capture });
                if (errFile) this.fs.write(errFile, errBuf, { append: errAppend });
                if (outFile) { this.fs.write(outFile, outBuf, { append }); stdin = ''; } else if (!last) stdin = outBuf; else if (sink) sink(outBuf);
            }
            return code;
        }
        async command(cmd, io) {
            let argv = [];
            for (const w of cmd.words) argv.push(...await this.expandWord(w));
            // 先頭の VAR=値
            while (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]) && cmd.words[0].parts[0].q === 0) {
                const [, k, v] = argv.shift().match(/^([^=]+)=(.*)$/s);
                this.env[k] = v;
            }
            if (!argv.length) return 0;
            for (let guard = 0; guard < 5 && this.aliases[argv[0]] && cmd.words[0].parts.every((p) => p.q === 0); guard++) {
                const rep = this.aliases[argv[0]].split(' ');
                if (rep[0] === argv[0]) { argv.splice(0, 1, ...rep); break; }
                argv.splice(0, 1, ...rep);
            }
            let name = argv[0];
            if (name.includes('/')) {
                const abs = this.path(name), node = this.fs.get(abs);
                if (!node) { io.err(`-bash: ${name}: ${E.NOENT}\n`); return 127; }
                if (node.t === 'd') { io.err(`-bash: ${name}: ${E.ISDIR}\n`); return 126; }
                if (!(node.mode & 0o111) || !FksTerm.commands[abs.split('/').pop()]) { io.err(`-bash: ${name}: ${E.ACCES}\n`); return 126; }
                name = abs.split('/').pop();
            }
            const fn = FksTerm.commands[name];
            if (!fn) {
                io.err(/^(for|while|if|case|function|until|select)$/.test(name) ? `-bash: ${name}: この端末は簡易版のため、制御構文には対応していません\n` : `-bash: ${name}: コマンドが見つかりません\n`);
                return 127;
            }
            const ctx = { sh: this, fs: this.fs, term: this.term, name, args: argv.slice(1), stdin: io.stdin, out: io.out, err: io.err, tty: io.tty, sleep: (ms) => this.sleep(ms), sig: this.sig, path: (p) => this.path(p) };
            const code = await fn(ctx);
            return typeof code === 'number' ? code : 0;
        }
    }

    // ================= サイトの中身をホームディレクトリに置く =================
    // 各ページの <main> をテキストに直して ~/about.md などにする（内容を二重に持たない）
    function pageToText(doc) {
        const lines = [];
        const text = (el) => {
            const c = el.cloneNode(true);
            c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
            c.querySelectorAll('a[href]').forEach((a) => {
                const href = a.getAttribute('href');
                a.replaceWith(/^(https?:|mailto:)/.test(href) ? `${a.textContent.trim()} <${href}>` : `${a.textContent.trim()} <${href.replace(/^\.\//, '')}>`);
            });
            c.querySelectorAll('img').forEach((im) => im.replaceWith(im.alt ? `[画像: ${im.alt}]` : ''));
            return c.textContent.replace(/[ \t\u3000]*\n[ \t\u3000]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
        };
        const blank = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); };
        const walk = (el) => {
            for (const ch of el.children) {
                const tag = ch.tagName.toLowerCase();
                if (ch.matches('.hero__scroll, .eyebrow, script, .card__no b')) continue;
                if (/^h[1-3]$/.test(tag)) { blank(); lines.push(`${'#'.repeat(Number(tag[1]))} ${text(ch).replace(/\n/g, ' ')}`, ''); }
                else if (ch.matches('.card__no')) { blank(); lines.push(`## ${text(ch)}`, ''); }
                else if (tag === 'ul' || tag === 'ol') { for (const li of ch.children) lines.push(`- ${text(li).replace(/\n/g, ' ')}`); lines.push(''); }
                else if (tag === 'dl') { for (const row of ch.querySelectorAll('dt')) { lines.push(`* ${text(row)}`); const dd = row.nextElementSibling; if (dd?.tagName === 'DD') lines.push(`    ${text(dd).replace(/\n/g, ' ')}`); } lines.push(''); }
                else if (tag === 'p' || tag === 'blockquote' || tag === 'cite' || tag === 'figcaption') { const t = text(ch); if (t) lines.push(...t.split('\n'), ''); }
                else if (ch.matches('.tile')) { const small = ch.querySelector('small')?.textContent.trim(); const rest = [...ch.children].filter((c) => c.tagName !== 'SMALL').map((c) => c.textContent.trim()).filter(Boolean).join(' '); lines.push(tag === 'a' ? `- ${rest} <${ch.getAttribute('href')}>` : `- ${small}: ${rest}`); }
                else if (tag === 'a') { lines.push(`- ${text(ch).replace(/\n/g, ' ')}`); }
                else if (tag === 'img') { if (ch.alt) lines.push(`[画像: ${ch.alt}]`, ''); }
                else if (tag === 'hr') { blank(); lines.push('----', ''); }
                else walk(ch);
            }
        };
        const main = doc.querySelector('main');
        if (main) walk(main);
        return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
    }

    const PAGES = [['index.htm', 'news.md'], ['about.htm', 'about.md'], ['result.htm', 'works.md'], ['fes.htm', 'tombo79.md'], ['contact.htm', 'contact.md']];
    const PHOTOS = ['dome.png', 'dome2.jpg', 'dome3.jpg', 'dome4.jpg', 'sd81s.jpg', 'ds-115.jpg', 'fukasis.jpg', '7-50.jpg', '10-70.jpg', 'bj-30l.jpg', 'c10-4m.jpg', 'asi678mc.jpg',
        'fksa_body.jpg', 'fksa_rocket.jpg', 'fksb_1_body.jpg', 'fksb_1_app.jpg', 'fksb_2_body.jpg', 'fksb_2_app1.jpg', 'fksb_2_app2.jpg', 'fksb_2_sim.jpg', 'gonzalez.jpg', 'a-chan.png'];

    async function buildFS() {
        const fs = new FS();
        const put = (p, data, owner = 'root', mode = 0o644) => { fs.mkdirp(fs.split(p)[0], owner); fs.write(p, data, { user: false, owner, mode }); };
        for (const d of ['/bin', '/etc', '/tmp', '/var/log', '/usr/bin', '/usr/games', '/usr/share/doc', '/dev', '/proc', '/mnt/cansat', '/root', '/home']) fs.mkdirp(d);
        fs.get('/tmp').mode = 0o1777;
        fs.get('/root').mode = 0o700;
        fs.mkdirp(HOME, USER);
        put('/etc/hostname', `${HOST}\n`);
        put('/etc/os-release', 'NAME="Chigaku GNU/Linux"\nPRETTY_NAME="地学會 GNU/Linux 2026.10 (Pleiades)"\nVERSION="2026.10 (Pleiades)"\nVERSION_CODENAME=pleiades\nID=chigaku\nHOME_URL="https://fksgeoscience.github.io/"\n');
        put('/etc/passwd', `root:x:0:0:root:/root:/bin/bash\n${USER}:x:1000:1000:地学會員:${HOME}:/bin/bash\ngonzalez:x:1001:1001:公式マスコット:/home/gonzalez:/usr/sbin/nologin\n`);
        put('/etc/motd', '\n  松本深志高校地学會のホームページ（ターミナル版）へようこそ。\n  まずは ls と cat README.md、こまったら help をどうぞ。\n\n');
        put('/etc/fstab', '# <file system>  <mount point>  <type>  <options>\n/dev/dome1       /              ext4    defaults\n/dev/sda1        /mnt/cansat    vfat    noauto,user   # IS25LP040E\n');
        put('/dev/null', '', 'root', 0o666);
        put('/mnt/cansat/README', 'Fks-B-II のフラッシュメモリ IS25LP040E をつなぐとここに見えます（いまは未接続）。\n');
        put(`${HOME}/README.md`, [
            '# 地学會ターミナル', '',
            '松本深志高校地学會のホームページの、もうひとつの隠しモードです。', 'このホームディレクトリに、サイトの中身がテキストで置いてあります。', '',
            '    ls -l              何があるか見る', '    cat about.md       地学會について', '    less works.md      つくったもの（q で終了）',
            '    grep -n FCT-150 *.md', '    vim README.md      このファイルを編集（:q で終了）', '    open about         ふつうのページとして開く', '    btop               計算機のようすを見る（q で終了）', '',
            'あそび:', '    neofetch  fortune  cowsay  sl  cmatrix  mines  saver  m45', '',
            'ほかのモードへ:', '    startx             地学會 XP を起動', '    exit               モダン版にもどる', '',
            '書きかえたファイルは、このブラウザの中に保存されます。', 'コマンドの一覧は help、使いかたは man <コマンド> で。', '',
        ].join('\n'), USER);
        put(`${HOME}/.bashrc`, "# ~/.bashrc\nalias ll='ls -l'\nalias la='ls -A'\nalias l='ls -CF'\nexport EDITOR=vim\n", USER);
        put(`${HOME}/.vimrc`, '" ~/.vimrc\nset number\nset hlsearch\n', USER);
        put(`${HOME}/.bash_history`, 'ls -l\ncat README.md\n', USER, 0o600);
        fs.mkdirp(`${HOME}/photos`, USER);
        for (const f of PHOTOS) { put(`${HOME}/photos/${f}`, '', USER); Object.assign(fs.get(`${HOME}/photos/${f}`), { url: `./img/${f}`, size: 0 }); }
        fs.mkdirp(`${HOME}/m45`, USER);
        for (const [f, u] of [['M45_2025.pdf', 'm45_2025.pdf'], ['M45_2026.pdf', 'm45_2026.pdf'], ['M45_2026_2.pdf', 'm45_2026_2.pdf']]) { put(`${HOME}/m45/${f}`, '', USER); Object.assign(fs.get(`${HOME}/m45/${f}`), { url: `./doc/${u}`, size: 0 }); }

        // サイトの各ページを取ってきてテキスト化
        await Promise.all(PAGES.map(async ([page, name]) => {
            let body = `# ${name}\n\nこのページは読み込めませんでした。open ${page.replace('.htm', '')} で開いてみてください。\n`;
            let mtime = BASE_TIME;
            try {
                const res = await fetch(`./${page}`);
                if (res.ok) {
                    body = pageToText(new DOMParser().parseFromString(await res.text(), 'text/html'));
                    const lm = Date.parse(res.headers.get('last-modified') || '');
                    if (lm) mtime = lm;
                }
            } catch { /* file:// などでは取れないので、案内文のままにする */ }
            put(`${HOME}/${name}`, body, USER);
            fs.get(`${HOME}/${name}`).mtime = mtime;
        }));
        for (const name of Object.keys(FksTerm.commands)) put(`${FksTerm.games.has(name) ? '/usr/games' : '/bin'}/${name}`, '', 'root', 0o755);
        fs.load();
        return fs;
    }

    // ================= 公開 =================
    const FksTerm = window.FksTerm = {
        HOME, USER, HOST, E, Interrupt, commands: {}, docs: {}, games: new Set(),
        Terminal, Shell, FS, buildFS,
        util: { cw, width, cells, ansi, pad, padL, stripAnsi, columns, escHtml },
        // container にターミナルを作って、シェルを起動する
        async create(container, opts = {}) {
            const term = new Terminal(container, opts);
            const fs = await (FksTerm.fsReady ??= buildFS());
            const sh = new Shell(term, fs, opts);
            return { term, fs, sh, start: () => sh.loop() };
        },
    };
})();
