// 地学會 XP（隠しモード）
// 起動画面 → ようこそ → デスクトップ。ページの中身は index.htm などをその場で読み込んで、
// あのころの見た目に着せ替えて表示します（内容を二重に持たないため）。
(() => {
    'use strict';

    const $ = (s, r = document) => r.querySelector(s);
    const body = document.body;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = () => innerWidth <= 700;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
    const ico = (name) => name === 'logo'
        ? '<span class="ico ico--logo"><img src="./favicon.png" alt=""></span>'
        : `<span class="ico"><svg viewBox="0 0 32 32" aria-hidden="true"><use href="#i-${name}"/></svg></span>`;

    const PAGES = { 'index.htm': 'トップ', 'about.htm': '地学會について', 'result.htm': 'つくったもの', 'fes.htm': 'とんぼ祭', 'contact.htm': 'お問い合わせ' };
    const SITE = 'http://fksgeoscience.github.io/';
    const PHOTOS = [
        ['dome.png', '天体ドームの中'], ['dome2.jpg', '天体ドーム 写真1'], ['dome3.jpg', '天体ドーム 写真2'], ['dome4.jpg', '天体ドーム 写真3'],
        ['sd81s.jpg', 'Vixen SD81S'], ['ds-115.jpg', 'MEADE DS-115'], ['fukasis.jpg', 'FUKASIS'], ['7-50.jpg', '五藤光学 7×50'], ['10-70.jpg', 'タカハシ 10×70'],
        ['bj-30l.jpg', 'BITRAN BJ-30L'], ['c10-4m.jpg', 'Vixen C10-4M'], ['asi678mc.jpg', 'ZWO ASI678MC'],
        ['fksa_body.jpg', 'Fks-A 機体'], ['fksa_rocket.jpg', 'Fks-A ロケット'], ['fksb_1_body.jpg', 'Fks-B-I 機体'], ['fksb_1_app.jpg', 'Fks-B-I 地上局'],
        ['fksb_2_body.jpg', 'Fks-B-II 機体'], ['fksb_2_app1.jpg', 'Fks-B-II 地上局1'], ['fksb_2_app2.jpg', 'Fks-B-II 地上局2'], ['fksb_2_sim.jpg', 'Fks-B-II シミュレータ'],
        ['gonzalez.jpg', 'ゴンザレス'], ['a-chan.png', '地学会員Pちゃん'],
    ].map(([file, label]) => ({ src: `./img/${file}`, label }));
    const README = [
        '地学會 XP へようこそ',
        '',
        'これは「松本深志高校地学會のホームページ」の隠しモードです。',
        '2026年4月にできた最初のデザインを、さらに懐かしいほうへ寄せてみました。',
        '',
        '・「地学會のホームページ」を開くと、あのころの雰囲気のページが読めます。',
        '・ スタート → 終了オプション から、モダン版やターミナル版に切り替えられます。',
        '・「ターミナル」では、コマンドで地学會を見てまわれます（vim もあります）。',
        '・ しばらく放っておくと、スクリーンセーバーがはじまります。',
        '',
        'なにをするところ？　………さあ？（26年度部長）',
    ].join('\n');

    // ================= 起動と終了 =================

    const welcomeText = $('#welcomeText');
    let skip = null;
    const wait = (ms) => new Promise((done) => {
        const timer = setTimeout(finish, reduce ? Math.min(ms, 400) : ms);
        function finish() { clearTimeout(timer); skip = null; done(); }
        skip = finish;
    });
    const skipBoot = () => { if (body.classList.contains('is-boot') || body.classList.contains('is-welcome')) skip?.(); };
    addEventListener('pointerdown', skipBoot);
    addEventListener('keydown', skipBoot);

    async function boot() {
        closeStart();
        hidePower();
        hideBalloon();
        [...wins.values()].forEach((w) => w.close());
        body.className = 'is-boot';
        await wait(2900);
        welcomeText.textContent = 'ようこそ';
        body.className = 'is-welcome';
        await wait(1500);
        body.className = '';
        if (!reduce) $('#desktop').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
        setTimeout(() => showBalloon('新入部員を募集しています', '学年を問わず、いつでも新入部員を募集しています！ここをクリックすると「地学會について」を開きます。', () => openBrowser('about.htm')), 2200);
        resetIdle();
    }

    async function leave(mode) {
        closeStart();
        hidePower();
        hideBalloon();
        stopSaver();
        welcomeText.textContent = '設定を保存しています...';
        body.className = 'is-welcome';
        await wait(1000);
        welcomeText.textContent = mode === 'modern' ? 'モダン版を起動しています...' : mode === 'terminal' ? 'テキスト モードに切り替えています...' : '地学會 XP を再起動しています...';
        await wait(1300);
        if (mode === 'terminal') { body.className = 'is-off'; location.href = './term.htm'; return; }
        if (mode !== 'modern') return boot();
        // モダン版は、この合図を見て自分の起動画面を出す
        try { sessionStorage.setItem('fks-boot', '1'); } catch { /* 保存できなくても切り替えはできる */ }
        body.className = 'is-off';
        location.href = './index.htm';
    }

    // ================= ウィンドウ =================

    const wins = new Map();
    const winsEl = $('#windows');
    const tasksEl = $('#tasks');
    let zTop = 10, cascade = 0;

    function focusTop() {
        const top = [...wins.values()].filter((w) => !w.el.classList.contains('is-min')).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
        top ? top.focus() : wins.forEach((w) => { w.el.classList.add('is-inactive'); w.task.classList.remove('is-active'); });
    }

    function openWindow(o) {
        const had = wins.get(o.id);
        if (had) { had.restore(); return had; }
        const el = h(`
            <section class="xwin is-opening ${o.cls || ''}" role="dialog" aria-label="${esc(o.title)}">
                <header class="titlebar">${ico(o.icon)}<span class="titlebar__text"></span>
                    ${o.fixed ? '' : '<button type="button" class="tb tb--min" aria-label="最小化"></button><button type="button" class="tb tb--max" aria-label="最大化"></button>'}
                    <button type="button" class="tb tb--close" aria-label="閉じる"></button>
                </header>
                <div class="xwin__body"></div>
                ${o.fixed ? '' : '<i class="grip"></i>'}
            </section>`);
        const titleEl = $('.titlebar__text', el);
        const task = h(`<button type="button" class="task">${ico(o.icon)}<span></span></button>`);
        const area = winsEl.getBoundingClientRect();
        const w = o.w ? Math.min(o.w, area.width - 8) : 0;
        const ht = o.h ? Math.min(o.h, area.height - 8) : 0;
        const x = Math.max(4, Math.min(area.width - (w || 240) - 4, o.x ?? 110 + cascade * 26));
        const y = Math.max(2, Math.min(area.height - (ht || 300) - 4, o.y ?? 24 + cascade * 24));
        cascade = (cascade + 1) % 7;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        if (w) el.style.width = `${w}px`;
        if (ht) el.style.height = `${ht}px`;

        const win = {
            id: o.id, el, task, body: $('.xwin__body', el), fresh: true,
            setTitle(t) { titleEl.textContent = t; task.lastElementChild.textContent = t; el.setAttribute('aria-label', t); },
            focus() {
                wins.forEach((v) => { v.el.classList.add('is-inactive'); v.task.classList.remove('is-active'); });
                el.classList.remove('is-inactive');
                task.classList.add('is-active');
                el.style.zIndex = ++zTop;
            },
            minimize() { el.classList.add('is-min'); focusTop(); },
            restore() { el.classList.remove('is-min'); win.focus(); },
            toggleMax() { if (!o.fixed) el.classList.toggle('is-max'); },
            close() { o.onClose?.(); el.remove(); task.remove(); wins.delete(o.id); focusTop(); },
        };
        win.setTitle(o.title);

        el.addEventListener('pointerdown', () => win.focus(), true);
        el.addEventListener('animationend', () => el.classList.remove('is-opening'), { once: true });
        $('.tb--close', el).addEventListener('click', () => win.close());
        $('.tb--min', el)?.addEventListener('click', () => win.minimize());
        $('.tb--max', el)?.addEventListener('click', () => win.toggleMax());
        task.addEventListener('click', () => {
            if (el.classList.contains('is-min')) win.restore();
            else if (task.classList.contains('is-active')) win.minimize();
            else win.focus();
        });

        // タイトルバーで移動、右下で大きさを変える
        const bar = $('.titlebar', el);
        bar.addEventListener('dblclick', (ev) => { if (!ev.target.closest('.tb')) win.toggleMax(); });
        drag(bar, (ev) => {
            if (ev.target.closest('.tb') || el.classList.contains('is-max') || small()) return null;
            const r = el.getBoundingClientRect(), a = winsEl.getBoundingClientRect();
            const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
            return (mv) => {
                el.style.left = `${Math.max(60 - r.width, Math.min(a.width - 60, mv.clientX - a.left - dx))}px`;
                el.style.top = `${Math.max(0, Math.min(a.height - 28, mv.clientY - a.top - dy))}px`;
            };
        });
        const grip = $('.grip', el);
        if (grip) drag(grip, (ev) => {
            const r = el.getBoundingClientRect();
            const sx = ev.clientX, sy = ev.clientY;
            return (mv) => {
                el.style.width = `${Math.max(260, r.width + mv.clientX - sx)}px`;
                el.style.height = `${Math.max(160, r.height + mv.clientY - sy)}px`;
            };
        });

        winsEl.append(el);
        tasksEl.append(task);
        wins.set(o.id, win);
        win.focus();
        return win;
    }

    function drag(handle, begin) {
        handle.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            const move = begin(ev);
            if (!move) return;
            handle.setPointerCapture(ev.pointerId);
            const end = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    // ================= ブラウザ =================

    const pageCache = new Map();

    // 読み込んだページを、あのころのレイアウトに着せ替える
    function retro(doc, file) {
        const main = doc.querySelector('main').cloneNode(true);
        main.querySelectorAll('.hero, script').forEach((n) => n.remove());
        main.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'));
        const side = [...doc.querySelectorAll('.footer__inner > div')].slice(0, 2).map((d) => d.innerHTML).join('<hr>');
        const nav = Object.entries(PAGES).map(([f, t]) => `<td><a href="./${f}">${t}</a></td>`).join('');
        const root = h(`
            <div class="retro">
                <hr>
                <a href="./index.htm"><img class="retro__title" src="./img/title.png" alt="地学會のホームページ"></a>
                <hr>
                <table class="retro__nav"><tbody>
                    <tr>${nav}</tr>
                    <tr><td colspan="5"><i>あなたは <img src="https://www.f-counter.net/ani1/67/1776341783/" alt="無料アクセスカウンター"><img src="https://www.f-counter.net/ani2/67/1776341783/" alt="無料アクセスカウンター"> 人目のお客様です</i></td></tr>
                </tbody></table>
                <p class="retro__h"><u><i>　${esc(PAGES[file])}　</i></u></p>
                <div class="retro__cols">
                    <aside class="retro__side">
                        <img src="./img/multi_cof.gif" alt="マルチな部活">
                        <p><b>松本深志高校地学會のホームページです。</b></p>
                        <hr>${side}<hr>
                    </aside>
                    <div class="retro__main"></div>
                </div>
                <div class="retro__foot"><hr><p>since 2026-04-15</p><p>================</p><p>Copyright © 2026 松本深志高等学校地学會</p></div>
            </div>`);
        $('.retro__main', root).append(...main.childNodes);
        return root;
    }

    function errorPage(file) {
        return h(`
            <div class="retro"><div class="xerr">
                <h2>ページを表示できません</h2>
                <p>検索中のページは現在、利用できません。Web サイトに技術的な問題が発生しているか、ブラウザの設定を調整する必要があります。</p>
                <hr style="border-top-color:#999">
                <p>次のことを試してください:</p>
                <p>・［更新］ボタンをクリックするか、後でやり直してください。</p>
                <p>・<a href="./${esc(file)}" target="_blank" rel="noopener">${esc(SITE + file)}</a> を新しいタブで開いてみてください。</p>
            </div></div>`);
    }

    function openBrowser(target = 'index.htm') {
        let win = wins.get('ie');
        if (win) { win.restore(); win.go(target); return; }
        win = openWindow({ id: 'ie', title: '地学會 Explorer', icon: 'ie', w: 920, h: 660, x: 96, y: 10 });
        win.body.innerHTML = `
            <div class="menubar" aria-hidden="true"><span>ファイル(F)</span><span>編集(E)</span><span>表示(V)</span><span>お気に入り(A)</span><span>ツール(T)</span><span>ヘルプ(H)</span></div>
            <div class="toolbar">
                <button type="button" class="tool" data-nav="back">${ico('back')}<span>戻る</span></button>
                <button type="button" class="tool tool--fwd" data-nav="fwd">${ico('back')}<span>進む</span></button>
                <i></i>
                <button type="button" class="tool" data-nav="stop">${ico('stop')}<span>中止</span></button>
                <button type="button" class="tool" data-nav="refresh">${ico('refresh')}<span>更新</span></button>
                <button type="button" class="tool" data-nav="home">${ico('home')}<span>ホーム</span></button>
            </div>
            <label class="address"><span>アドレス(D)</span><select>${Object.keys(PAGES).map((f) => `<option value="${f}">${SITE}${f}</option>`).join('')}</select></label>
            <div class="links"><span>リンク</span>${Object.entries(PAGES).map(([f, t]) => `<button type="button" data-go="${f}">${ico('ie')}${t}</button>`).join('')}</div>
            <div class="view xp-scroll" tabindex="0"></div>
            <div class="statusbar"><span></span><span>インターネット</span></div>`;
        const view = $('.view', win.body), status = $('.statusbar span', win.body), select = $('select', win.body);
        const back = $('[data-nav="back"]', win.body), fwd = $('[data-nav="fwd"]', win.body);
        const hist = { stack: [], at: -1 };

        win.go = async (to, push = true) => {
            const [file, hash = ''] = to.split('#');
            status.textContent = `Web サイト ${SITE}${file} を検索しています...`;
            try {
                let doc = pageCache.get(file);
                if (!doc) {
                    const res = await fetch(`./${file}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    doc = new DOMParser().parseFromString(await res.text(), 'text/html');
                    pageCache.set(file, doc);
                }
                view.replaceChildren(retro(doc, file));
                win.setTitle(`${doc.title} - 地学會 Explorer`);
                status.textContent = 'ページが表示されました';
            } catch {
                view.replaceChildren(errorPage(file));
                win.setTitle('ページを表示できません - 地学會 Explorer');
                status.textContent = '完了';
            }
            if (push) { hist.stack.splice(hist.at + 1); hist.stack.push(to); hist.at = hist.stack.length - 1; }
            select.value = file;
            back.disabled = hist.at <= 0;
            fwd.disabled = hist.at >= hist.stack.length - 1;
            const anchor = hash && view.querySelector(`#${CSS.escape(hash)}`);
            view.scrollTop = anchor ? anchor.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 6 : 0;
        };

        win.body.addEventListener('click', (ev) => {
            const nav = ev.target.closest('[data-nav]')?.dataset.nav;
            const direct = ev.target.closest('[data-go]')?.dataset.go;
            if (direct) return win.go(direct);
            if (nav === 'back' && hist.at > 0) win.go(hist.stack[--hist.at], false);
            if (nav === 'fwd' && hist.at < hist.stack.length - 1) win.go(hist.stack[++hist.at], false);
            if (nav === 'refresh') { pageCache.delete(hist.stack[hist.at].split('#')[0]); win.go(hist.stack[hist.at], false); }
            if (nav === 'home') win.go('index.htm');
        });
        select.addEventListener('change', () => win.go(select.value));
        // ページ内のリンク：サイト内はこの窓で、写真は画像ビューアで、それ以外は新しいタブで
        view.addEventListener('click', (ev) => {
            const a = ev.target.closest('a[href]');
            if (!a) return;
            const url = new URL(a.getAttribute('href'), location.href);
            const file = url.pathname.split('/').pop() || 'index.htm';
            if (url.origin === location.origin && PAGES[file]) {
                ev.preventDefault();
                win.go(file + url.hash);
            } else if (url.origin === location.origin && /\.(jpe?g|png|gif)$/i.test(file) && !a.querySelector('img')) {
                ev.preventDefault();
                openViewer(0, [{ src: a.getAttribute('href'), label: a.textContent.trim() }]);
            } else {
                a.target = '_blank';
                a.rel = 'noopener';
            }
        });
        win.go(target);
    }

    // ================= フォルダ・画像・メモ帳 =================

    const openPdf = (href) => window.open(href, '_blank', 'noopener');
    const FOLDERS = {
        pictures: {
            title: 'マイ ピクチャ', icon: 'pictures', task: '画像のタスク',
            tasks: [['スライド ショーで表示する', () => openViewer(0)], ['マイ ドキュメントを開く', () => openFolder('docs')]],
            items: () => PHOTOS.map((p, i) => ({ label: p.label, thumb: p.src, open: () => openViewer(i) })),
        },
        docs: {
            title: 'マイ ドキュメント', icon: 'folder', task: 'ファイルとフォルダのタスク',
            tasks: [['部誌について読む', () => openBrowser('result.htm#m45')], ['マイ ピクチャを開く', () => openFolder('pictures')]],
            items: () => [
                { label: 'マイ ピクチャ', icon: 'pictures', open: () => openFolder('pictures') },
                { label: 'M45 2025.pdf', icon: 'book', open: () => openPdf('./doc/m45_2025.pdf') },
                { label: 'M45 2026.pdf', icon: 'book', open: () => openPdf('./doc/m45_2026.pdf') },
                { label: 'M45 2026 第2版.pdf', icon: 'book', open: () => openPdf('./doc/m45_2026_2.pdf') },
                { label: 'FUKASIS ポスター.pdf', icon: 'text', open: () => openPdf('./doc/29P_Poster_ItoK.pdf') },
                { label: 'はじめにお読みください.txt', icon: 'notepad', open: openNotepad },
            ],
        },
        bin: {
            title: 'ごみ箱', icon: 'bin', task: 'ごみ箱のタスク',
            tasks: [['ごみ箱を空にする', () => showBalloon('ごみ箱', '捨てるにはしのびないので、そのままにしておきます。')]],
            items: () => [
                { label: 'under_const.png', icon: 'image', open: () => openViewer(0, [{ src: './img/under_const.png', label: 'under_const.png' }]) },
                { label: 'title.png', icon: 'image', open: () => openViewer(0, [{ src: './img/title.png', label: 'title.png' }]) },
            ],
        },
    };

    function openFolder(name) {
        const f = FOLDERS[name];
        const win = openWindow({ id: `folder-${name}`, title: f.title, icon: f.icon, w: 640, h: 440 });
        if (!win.fresh) return;
        win.fresh = false;
        const items = f.items();
        win.body.innerHTML = `
            <div class="menubar" aria-hidden="true"><span>ファイル(F)</span><span>編集(E)</span><span>表示(V)</span><span>お気に入り(A)</span><span>ツール(T)</span><span>ヘルプ(H)</span></div>
            <div class="folder">
                <div class="folder__side">
                    <div class="folder__box"><h3>${f.task}</h3><div>${f.tasks.map(([t], i) => `<button type="button" data-task="${i}">${esc(t)}</button>`).join('')}</div></div>
                    <div class="folder__box"><h3>詳細</h3><div><b>${f.title}</b><span>${items.length} 個のオブジェクト</span></div></div>
                </div>
                <div class="folder__main xp-scroll">${items.map((it, i) => `
                    <button type="button" class="file" data-file="${i}">
                        ${it.thumb ? `<img class="thumb" src="${esc(it.thumb)}" alt="" loading="lazy">` : ico(it.icon)}<span>${esc(it.label)}</span>
                    </button>`).join('')}
                </div>
            </div>
            <div class="statusbar"><span>${items.length} 個のオブジェクト</span><span>マイ コンピュータ</span></div>`;
        win.body.addEventListener('click', (ev) => {
            const t = ev.target.closest('[data-task]');
            if (t) f.tasks[t.dataset.task][1]();
        });
        opener($('.folder__main', win.body), '.file', (el) => items[el.dataset.file].open());
    }

    // ダブルクリック（タッチは1回、キーボードは Enter）で開く
    let lastPointer = 'mouse';
    addEventListener('pointerdown', (ev) => { lastPointer = ev.pointerType; }, true);
    function opener(root, selector, open) {
        root.addEventListener('dblclick', (ev) => { const el = ev.target.closest(selector); if (el) open(el); });
        root.addEventListener('click', (ev) => { const el = ev.target.closest(selector); if (el && lastPointer !== 'mouse') open(el); });
        root.addEventListener('keydown', (ev) => { const el = ev.target.closest(selector); if (el && ev.key === 'Enter') { ev.preventDefault(); open(el); } });
    }

    function openViewer(index, list = PHOTOS) {
        const win = openWindow({ id: 'viewer', title: '画像ビューア', icon: 'image', w: 660, h: 540, x: 180, y: 40 });
        if (win.fresh) {
            win.fresh = false;
            win.body.innerHTML = `
                <div class="viewer"><img alt=""></div>
                <div class="viewer__bar"><button type="button" class="xbtn" data-step="-1">&lt; 前へ</button><span></span><button type="button" class="xbtn" data-step="1">次へ &gt;</button></div>`;
            const img = $('img', win.body), count = $('.viewer__bar span', win.body);
            win.show = (items, i) => {
                win.items = items;
                win.at = (i + items.length) % items.length;
                const it = items[win.at];
                img.src = it.src;
                img.alt = it.label;
                count.textContent = `${win.at + 1} / ${items.length}`;
                win.setTitle(`${it.label} - 画像ビューア`);
                win.body.querySelectorAll('[data-step]').forEach((b) => { b.disabled = items.length < 2; });
            };
            win.body.addEventListener('click', (ev) => {
                const step = ev.target.closest('[data-step]')?.dataset.step;
                if (step) win.show(win.items, win.at + Number(step));
            });
        }
        win.show(list, index);
    }

    function openNotepad() {
        const win = openWindow({ id: 'notepad', title: 'はじめにお読みください.txt - メモ帳', icon: 'notepad', w: 500, h: 360, x: 220, y: 90 });
        if (!win.fresh) return;
        win.fresh = false;
        win.body.innerHTML = '<div class="menubar" aria-hidden="true"><span>ファイル(F)</span><span>編集(E)</span><span>書式(O)</span><span>表示(V)</span><span>ヘルプ(H)</span></div><textarea class="notepad xp-scroll" spellcheck="false" aria-label="メモ帳"></textarea>';
        $('textarea', win.body).value = README;
    }

    function openProps() {
        const win = openWindow({ id: 'props', title: 'システムのプロパティ', icon: 'computer', w: 420, h: 440, x: 160, y: 50, fixed: true });
        if (!win.fresh) return;
        win.fresh = false;
        win.body.innerHTML = `
            <div class="props">
                <div class="props__tabs" aria-hidden="true"><span>全般</span><span>コンピュータ名</span><span>ハードウェア</span><span>詳細設定</span></div>
                <div class="props__panel">
                    ${ico('computer')}
                    <div>
                        <h3>システム:</h3><p>地学會 XP<br>Geoscience Edition<br>Version 2026</p>
                        <h3>使用者:</h3><p>松本深志高等学校地学會<br>since 2026-04-15</p>
                        <h3>コンピュータ:</h3><p>タカハシ 計算機（Windows98）<br>天体ドーム 約直径5 m<br>主砲 タカハシ FCT-150<br>活動日 毎週 火曜・金曜</p>
                    </div>
                </div>
                <div class="props__foot"><button type="button" class="xbtn" data-ok>OK</button><button type="button" class="xbtn" data-ok>キャンセル</button></div>
            </div>`;
        win.body.addEventListener('click', (ev) => { if (ev.target.closest('[data-ok]')) win.close(); });
    }

    // ================= ターミナル =================
    // 中身は js/term.js（ターミナル版と共通）。ここでは窓に入れて、XP 側の機能とつなぐ

    function openTerm() {
        const win = openWindow({ id: 'term', title: 'dome - 地学會ターム VT', icon: 'term', w: 700, h: 470, x: 150, y: 60 });
        if (!win.fresh) { win.term?.focus(); return; }
        win.fresh = false;
        win.body.innerHTML = '<div class="menubar" aria-hidden="true"><span>ファイル(F)</span><span>編集(E)</span><span>設定(S)</span><span>コントロール(O)</span><span>ウィンドウ(W)</span><span>ヘルプ(H)</span></div><div class="termhost"></div>';
        const host = $('.termhost', win.body);
        window.FksTerm.create(host, {
            onExit: () => win.close(),
            onPower: (kind) => {
                if (kind === 'startx') return 'X サーバーはすでに動いています（いま見えているデスクトップがそれです）';
                setTimeout(() => leave(kind === 'console' ? 'terminal' : kind === 'reboot' ? 'restart' : 'modern'), 400);
                return true;
            },
            // open コマンド：ページはブラウザ窓で、写真は画像ビューアで開く
            onOpen: (target, arg) => {
                const file = target.split('/').pop();
                if (PAGES[file]) openBrowser(file);
                else if (/\.(jpe?g|png|gif)$/i.test(file)) openViewer(0, [{ src: target, label: (arg || file).split('/').pop() }]);
                else return false;
                return true;
            },
        }).then(({ term, fs, sh }) => {
            if (!wins.has('term')) return;
            win.term = term;
            term.write(`Connecting to dome (192.168.24.5) port 22 ...\n${fs.get('/etc/motd').data}`);
            sh.loop();
            term.focus();
        });
        win.el.addEventListener('pointerup', () => { if (!String(getSelection())) win.term?.focus(); });
    }

    // ================= マインスイーパ =================

    const FACE = {
        smile: '<path d="M6 11q4 4 8 0" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="8" r="1.2"/><circle cx="13" cy="8" r="1.2"/>',
        dead: '<path d="M6 13q4-3 8 0" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/><path d="M5.800 6.800l2.400 2.400M8.200 6.800L5.800 9.200M11.800 6.800l2.400 2.400M14.200 6.800l-2.400 2.400" stroke="#000" stroke-width="1.200"/>',
        cool: '<path d="M6 12q4 3 8 0" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round"/><path d="M4 7h12v1.200a2.400 2.400 0 0 1-4.800 0V8H8.800v.2a2.400 2.400 0 0 1-4.800 0z"/>',
    };
    const face = (k) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8.500" fill="#ffe100" stroke="#000"/>${FACE[k]}</svg>`;
    const FLAG = '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M7 2v9" stroke="#000" stroke-width="1.400"/><path d="M7 2L2.500 4.500 7 7z" fill="#f00"/><path d="M3.500 12h7v-1.500h-7z"/></svg>';
    const MINE = '<svg viewBox="0 0 32 32" width="15" height="15" aria-hidden="true"><use href="#i-mine"/></svg>';

    function openMine() {
        const win = openWindow({ id: 'mine', title: 'マインスイーパ', icon: 'mine', fixed: true, cls: 'mine-win', x: 300, y: 110, onClose: () => clearInterval(timer) });
        if (!win.fresh) return;
        win.fresh = false;
        const N = 9, M = 10;
        let timer = 0, cells, mines, opened, flags, over, secs;
        win.body.innerHTML = `
            <div class="menubar" aria-hidden="true"><span>ゲーム(G)</span><span>ヘルプ(H)</span></div>
            <div class="mine">
                <div class="mine__top"><span class="mine__led"></span><button type="button" class="mine__face" aria-label="やりなおす"></button><span class="mine__led"></span></div>
                <div class="mine__grid"></div>
            </div>`;
        const grid = $('.mine__grid', win.body), faceBtn = $('.mine__face', win.body);
        const [ledLeft, ledTime] = win.body.querySelectorAll('.mine__led');
        const pad = (n) => String(Math.max(0, Math.min(999, n))).padStart(3, '0');
        const around = (i) => {
            const x = i % N, y = Math.floor(i / N), out = [];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if ((dx || dy) && nx >= 0 && ny >= 0 && nx < N && ny < N) out.push(ny * N + nx);
            }
            return out;
        };
        function reset() {
            clearInterval(timer);
            timer = 0; mines = null; opened = 0; flags = 0; over = false; secs = 0;
            grid.innerHTML = Array.from({ length: N * N }, (_, i) => `<button type="button" class="cell" data-i="${i}" aria-label="マス"></button>`).join('');
            cells = [...grid.children];
            faceBtn.innerHTML = face('smile');
            ledLeft.textContent = pad(M);
            ledTime.textContent = pad(0);
        }
        function plant(safe) {
            mines = new Set();
            while (mines.size < M) {
                const i = Math.floor(Math.random() * N * N);
                if (i !== safe) mines.add(i);
            }
            timer = setInterval(() => { ledTime.textContent = pad(++secs); }, 1000);
        }
        function finish(won, hit) {
            over = true;
            clearInterval(timer);
            faceBtn.innerHTML = face(won ? 'cool' : 'dead');
            for (const i of mines) {
                if (won) cells[i].innerHTML = FLAG;
                else { cells[i].classList.add('is-open'); cells[i].innerHTML = MINE; }
            }
            if (hit != null) cells[hit].classList.add('is-boom');
            if (won) ledLeft.textContent = pad(0);
        }
        function open(i) {
            const c = cells[i];
            if (over || c.classList.contains('is-open') || c.dataset.flag) return;
            if (!mines) plant(i);
            if (mines.has(i)) return finish(false, i);
            const queue = [i];
            while (queue.length) {
                const k = queue.pop(), cell = cells[k];
                if (cell.classList.contains('is-open') || cell.dataset.flag) continue;
                cell.classList.add('is-open');
                opened++;
                const n = around(k).filter((a) => mines.has(a)).length;
                if (n) { cell.textContent = n; cell.dataset.n = n; } else queue.push(...around(k));
            }
            if (opened === N * N - M) finish(true);
        }
        function flag(i) {
            const c = cells[i];
            if (over || c.classList.contains('is-open')) return;
            if (c.dataset.flag) { delete c.dataset.flag; c.innerHTML = ''; flags--; } else { c.dataset.flag = '1'; c.innerHTML = FLAG; flags++; }
            ledLeft.textContent = pad(M - flags);
        }
        let press = 0, longPressed = false;
        grid.addEventListener('click', (ev) => {
            const c = ev.target.closest('.cell');
            if (!c) return;
            if (longPressed) { longPressed = false; return; }
            open(Number(c.dataset.i));
        });
        grid.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            const c = ev.target.closest('.cell');
            if (c && !longPressed) flag(Number(c.dataset.i));
        });
        // タッチは長押しで旗
        grid.addEventListener('pointerdown', (ev) => {
            const c = ev.target.closest('.cell');
            if (!c || ev.pointerType === 'mouse') return;
            press = setTimeout(() => { longPressed = true; flag(Number(c.dataset.i)); }, 450);
        });
        for (const type of ['pointerup', 'pointerleave', 'pointercancel']) grid.addEventListener(type, () => clearTimeout(press));
        faceBtn.addEventListener('click', reset);
        reset();
    }

    // ================= スタートメニュー・デスクトップ =================

    const ACTIONS = {
        ie: (page) => openBrowser(page || 'index.htm'),
        folder: (name) => openFolder(name),
        notepad: openNotepad,
        mine: openMine,
        term: openTerm,
        terminal: () => leave('terminal'),
        props: openProps,
        saver: () => startSaver(),
        power: () => showPower(),
        modern: () => leave('modern'),
        restart: () => leave('restart'),
        cancel: () => hidePower(),
    };
    const run = (act) => { const [name, arg] = act.split(':'); ACTIONS[name]?.(arg); };

    const startBtn = $('#startButton');
    const startMenu = $('#startMenu');
    const item = (icon, act, title, sub = '') => `<button type="button" class="sm__item" data-act="${act}">${ico(icon)}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
    const plain = (icon, act, title) => `<button type="button" class="sm__item" data-act="${act}">${ico(icon)}<span>${title}</span></button>`;
    startMenu.innerHTML = `
        <div class="sm__head"><img src="./img/gonzalez.jpg" alt=""><span>地学會員</span></div>
        <div class="sm__body">
            <div class="sm__col">
                ${item('ie', 'ie:index.htm', 'インターネット', '地学會のホームページ')}
                ${item('mail', 'ie:contact.htm', '電子メール', 'お問い合わせ')}
                <i class="sm__sep"></i>
                ${plain('scope', 'ie:about.htm', '地学會について')}
                ${plain('book', 'ie:result.htm', 'つくったもの')}
                ${plain('image', 'ie:fes.htm', 'とんぼ祭')}
                ${plain('notepad', 'notepad', 'メモ帳')}
                ${plain('mine', 'mine', 'マインスイーパ')}
                ${plain('term', 'term', 'ターミナル')}
                <i class="sm__sep"></i>
                ${plain('modern', 'power', 'モダン版・ターミナル版へ')}
            </div>
            <div class="sm__col sm__col--right">
                ${plain('folder', 'folder:docs', '<b>マイ ドキュメント</b>')}
                ${plain('pictures', 'folder:pictures', '<b>マイ ピクチャ</b>')}
                ${plain('computer', 'props', '<b>マイ コンピュータ</b>')}
                <i class="sm__sep"></i>
                ${plain('saver', 'saver', 'スクリーンセーバー')}
                ${plain('bin', 'folder:bin', 'ごみ箱')}
                <i class="sm__sep"></i>
                ${plain('text', 'notepad', 'ヘルプとサポート')}
            </div>
        </div>
        <div class="sm__foot">
            <button type="button" data-act="restart">${ico('logoff')}ログオフ(L)</button>
            <button type="button" data-act="power">${ico('power')}終了オプション(U)</button>
        </div>`;

    function closeStart() { startMenu.hidden = true; startBtn.setAttribute('aria-expanded', 'false'); }
    function toggleStart() {
        const open = startMenu.hidden;
        startMenu.hidden = !open;
        startBtn.setAttribute('aria-expanded', String(open));
        if (open) startMenu.querySelector('.sm__item')?.focus();
    }
    startBtn.addEventListener('click', toggleStart);
    startMenu.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        closeStart();
        run(b.dataset.act);
    });
    addEventListener('pointerdown', (ev) => {
        if (!startMenu.hidden && !ev.target.closest('#startMenu, #startButton')) closeStart();
    });

    const iconsEl = $('#icons');
    iconsEl.innerHTML = [
        ['computer', 'props', 'マイ コンピュータ'],
        ['ie', 'ie:index.htm', '地学會のホームページ'],
        ['folder', 'folder:docs', 'マイ ドキュメント'],
        ['pictures', 'folder:pictures', 'マイ ピクチャ'],
        ['notepad', 'notepad', 'はじめにお読みください.txt'],
        ['mine', 'mine', 'マインスイーパ'],
        ['term', 'term', 'ターミナル'],
        ['saver', 'saver', 'スクリーンセーバー'],
        ['bin', 'folder:bin', 'ごみ箱'],
        ['modern', 'power', 'モダン版へ'],
    ].map(([icon, act, label]) => `<li><button type="button" class="icon" data-act="${act}">${ico(icon)}<span>${label}</span></button></li>`).join('');
    opener(iconsEl, '.icon', (el) => run(el.dataset.act));

    // 時計
    const clock = $('#clock');
    const tick = () => {
        const d = new Date();
        clock.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        clock.dateTime = d.toISOString();
    };
    tick();
    setInterval(tick, 15000);

    // 通知領域の吹き出し
    const balloon = $('#balloon');
    let balloonAction = null, balloonTimer = 0;
    function showBalloon(title, text, action = null) {
        if (body.className) return;
        $('#balloonTitle').textContent = title;
        $('#balloonText').textContent = text;
        balloonAction = action;
        balloon.hidden = false;
        clearTimeout(balloonTimer);
        balloonTimer = setTimeout(hideBalloon, 14000);
    }
    function hideBalloon() { balloon.hidden = true; clearTimeout(balloonTimer); }
    $('#balloonClose').addEventListener('click', hideBalloon);
    $('#balloonBody').addEventListener('click', () => { const fn = balloonAction; hideBalloon(); fn?.(); });

    // ================= 終了ダイアログ =================

    const dim = $('#dim');
    dim.innerHTML = `
        <div class="power" role="dialog" aria-label="地学會 XP の終了">
            <div class="power__head"><span>地学會 XP の終了</span><img src="./favicon.png" alt=""></div>
            <div class="power__body">
                <button type="button" data-act="saver">${ico('standby')}<span>スクリーン<br>セーバー</span></button>
                <button type="button" data-act="modern">${ico('power')}<span>モダン版へ<br>切り替え</span></button>
                <button type="button" data-act="terminal">${ico('term')}<span>ターミナル版へ<br>切り替え</span></button>
                <button type="button" data-act="restart">${ico('restart')}<span>再起動</span></button>
            </div>
            <div class="power__foot"><button type="button" class="xbtn" data-act="cancel">キャンセル</button></div>
        </div>`;
    function showPower() {
        closeStart();
        dim.hidden = false;
        body.classList.add('is-dimmed');
        $('[data-act="modern"]', dim).focus();
    }
    function hidePower() { dim.hidden = true; body.classList.remove('is-dimmed'); }
    dim.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        if (b) { hidePower(); run(b.dataset.act); }
    });
    addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        if (!dim.hidden) hidePower(); else closeStart();
    });

    // ================= スクリーンセーバー =================

    const saver = $('#saver');
    const saverText = $('.saver__text', saver);
    let saverFrame = 0, saverSince = 0, idleTimer = 0;
    function startSaver() {
        if (!saver.hidden || body.className) return;
        hidePower();
        closeStart();
        saver.hidden = false;
        saverSince = performance.now();
        saverText.style.transform = '';
        const size = saverText.getBoundingClientRect();
        let x = Math.random() * Math.max(1, innerWidth - size.width), y = Math.random() * Math.max(1, innerHeight - size.height);
        let vx = 130, vy = 96, hue = 180, last = saverSince;
        const frame = (now) => {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            x += vx * dt; y += vy * dt;
            const mx = innerWidth - size.width, my = innerHeight - size.height;
            if (x < 0 || x > mx) { vx = -vx; x = Math.max(0, Math.min(mx, x)); hue = (hue + 67) % 360; }
            if (y < 0 || y > my) { vy = -vy; y = Math.max(0, Math.min(my, y)); hue = (hue + 67) % 360; }
            const spin = reduce ? 0 : (now - saverSince) / 1000 * 70;
            saverText.style.setProperty('--h', hue);
            saverText.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotateY(${spin.toFixed(1)}deg)`;
            saverFrame = requestAnimationFrame(frame);
        };
        saverFrame = requestAnimationFrame(frame);
    }
    function stopSaver() {
        if (saver.hidden) return;
        cancelAnimationFrame(saverFrame);
        saver.hidden = true;
        resetIdle();
    }
    function resetIdle() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(startSaver, 120000);
    }
    for (const type of ['pointerdown', 'keydown', 'pointermove', 'wheel']) {
        addEventListener(type, () => {
            // 起動した瞬間のマウスの揺れでは止めない
            if (!saver.hidden && performance.now() - saverSince > 700) stopSaver();
            if (saver.hidden) resetIdle();
        }, { passive: true });
    }

    addEventListener('pageshow', (ev) => { if (ev.persisted) boot(); });
    boot();
})();
