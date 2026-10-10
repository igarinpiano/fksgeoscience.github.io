// ガラス窓まわりの動き（出現・傾き・ナビ・画像ビューア）。
// 3D背景は sky.js。こちらは WebGL がなくても動きます。
(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const root = document.documentElement;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    // レイアウト用の画面高さ（--vh）。タッチ端末ではツールバーの出し入れによる高さの変化を無視し、
    // 幅が変わったとき（回転など）だけ取り直す。そうしないとスクロール中に各節の高さが変わって位置が飛ぶ
    const touch = matchMedia('(pointer: coarse)').matches;
    let layoutW = innerWidth;
    addEventListener('resize', () => {
        if (touch && innerWidth === layoutW) return;
        layoutW = innerWidth;
        root.style.setProperty('--vh', `${innerHeight * 0.01}px`);
    });

    // XPモードから戻ってきたときの起動画面
    if (root.classList.contains('booting')) {
        const boot = document.createElement('div');
        boot.className = 'mboot';
        boot.innerHTML = '<div class="mboot__inner"><img class="mboot__logo" src="./favicon.png" alt=""><div class="mboot__bar" role="progressbar" aria-label="起動しています"><i></i></div></div>';
        document.body.append(boot);
        root.classList.replace('booting', 'mbooting');
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            root.classList.remove('mbooting');
            boot.classList.add('is-done');
            boot.addEventListener('animationend', (ev) => { if (ev.target === boot) boot.remove(); });
        };
        setTimeout(finish, reduce ? 600 : 2600);
        boot.addEventListener('pointerdown', finish);
    }

    // 隠しモード（地学會 XP）への入口：フッターの小さな「スタート」と、トップの「マルチな部活」
    const toXP = () => {
        if (document.querySelector('.crtoff')) return;
        const off = document.createElement('div');
        off.className = 'crtoff';
        off.innerHTML = '<i></i>';
        document.body.append(off);
        setTimeout(() => { location.href = './xp.htm'; }, reduce ? 150 : 820);
    };
    // 「戻る」で帰ってきたときに、暗転したままにしない
    addEventListener('pageshow', (ev) => { if (ev.persisted) document.querySelector('.crtoff')?.remove(); });
    const meta = document.querySelector('.footer__meta');
    if (meta) {
        const egg = document.createElement('button');
        egg.type = 'button';
        egg.className = 'egg';
        egg.textContent = 'スタート';
        egg.setAttribute('aria-label', 'なつかしいほうの地学會（XPモード）をひらく');
        egg.addEventListener('click', toXP);
        meta.append(egg);
    }
    const crtGif = document.querySelector('.crt img');
    if (crtGif) {
        crtGif.tabIndex = 0;
        crtGif.setAttribute('role', 'button');
        crtGif.addEventListener('click', toXP);
        crtGif.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') toXP(); });
    }

    // 見出しを1文字ずつ起こす
    document.querySelectorAll('[data-split]').forEach((el) => {
        const text = el.textContent;
        el.setAttribute('aria-label', text);
        el.textContent = '';
        [...text].forEach((ch, i) => {
            const s = document.createElement('span');
            s.className = 'char';
            s.style.setProperty('--i', i);
            s.setAttribute('aria-hidden', 'true');
            s.textContent = ch;
            el.append(s);
        });
    });

    // 出現
    const revealer = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            e.target.classList.add('is-in');
            revealer.unobserve(e.target);
        }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    document.querySelectorAll('[data-reveal]').forEach((el) => revealer.observe(el));

    // スクロール位置に合わせた傾き
    const tilts = [...document.querySelectorAll('[data-tilt]')];
    const onScreen = new Set();
    const watcher = new IntersectionObserver((entries) => {
        for (const e of entries) e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target);
    }, { rootMargin: '10% 0px' });
    tilts.forEach((el) => watcher.observe(el));

    let queued = false;
    const frame = () => {
        queued = false;
        const vh = innerHeight;
        const max = Math.max(1, root.scrollHeight - vh);
        root.style.setProperty('--scroll', clamp(scrollY / max, 0, 1).toFixed(4));
        root.classList.toggle('is-scrolled', scrollY > 40);
        if (reduce) return;
        for (const el of onScreen) {
            const r = el.getBoundingClientRect();
            const p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
            el.style.setProperty('--sy', clamp(p, -1, 1).toFixed(3));
            el.style.setProperty('--amp', clamp(vh / r.height, 0.12, 1).toFixed(3));
        }
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    frame();

    // ポインタに合わせた光沢と傾き
    if (fine && !reduce) {
        document.querySelectorAll('.glass').forEach((el) => {
            const tilt = el.hasAttribute('data-tilt');
            el.addEventListener('pointermove', (ev) => {
                const r = el.getBoundingClientRect();
                const x = (ev.clientX - r.left) / r.width;
                const y = (ev.clientY - r.top) / r.height;
                el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
                el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
                el.style.setProperty('--sheen', '1');
                if (!tilt) return;
                const k = clamp(520 / Math.max(r.width, r.height), 0.15, 1) * 5;
                el.style.setProperty('--ry', `${((x - 0.5) * k).toFixed(2)}deg`);
                el.style.setProperty('--rx', `${((0.5 - y) * k).toFixed(2)}deg`);
            });
            el.addEventListener('pointerleave', () => {
                el.style.setProperty('--sheen', '0');
                el.style.setProperty('--rx', '0deg');
                el.style.setProperty('--ry', '0deg');
            });
        });
    }

    // ナビの「液滴」
    const links = document.querySelector('.nav__links');
    if (links) {
        const blob = document.createElement('i');
        blob.className = 'nav__blob';
        blob.setAttribute('aria-hidden', 'true');
        links.prepend(blob);
        const current = links.querySelector('[aria-current="page"]');
        const moveTo = (a) => {
            if (!a) { links.style.setProperty('--bo', '0'); return; }
            links.style.setProperty('--bx', `${a.offsetLeft}px`);
            links.style.setProperty('--bw', `${a.offsetWidth}px`);
            links.style.setProperty('--bo', '1');
        };
        links.querySelectorAll('a').forEach((a) => {
            a.addEventListener('pointerenter', () => moveTo(a));
            a.addEventListener('focus', () => moveTo(a));
        });
        links.addEventListener('pointerleave', () => moveTo(current));
        links.addEventListener('focusout', () => moveTo(current));
        addEventListener('resize', () => moveTo(current));
        (document.fonts?.ready ?? Promise.resolve()).then(() => moveTo(current));
        moveTo(current);
        current?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    // 写真リンクはページ内のガラス窓で開く
    const photos = [...document.querySelectorAll('a[href$=".jpg"], a[href$=".png"]')].filter((a) => !a.querySelector('img'));
    if (photos.length && 'showModal' in HTMLDialogElement.prototype) {
        const dialog = document.createElement('dialog');
        dialog.className = 'lightbox';
        dialog.innerHTML = '<figure class="glass"><img alt=""><figcaption><span></span><button class="btn btn--sm" type="button">とじる</button></figcaption></figure>';
        document.body.append(dialog);
        const img = dialog.querySelector('img');
        const cap = dialog.querySelector('span');
        dialog.querySelector('button').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
        photos.forEach((a) => a.addEventListener('click', (ev) => {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
            ev.preventDefault();
            img.src = a.href;
            img.alt = a.textContent.trim();
            cap.textContent = a.dataset.caption || a.textContent.trim();
            dialog.showModal();
        }));
    }
})();
