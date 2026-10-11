// ターミナル版（term.htm）：起動ログ → ログイン → シェル。
// startx で地学會 XP へ、exit / shutdown でモダン版へ、reboot で再起動します。
(() => {
    'use strict';
    const T = window.FksTerm;
    const { HOST, USER } = T;
    const el = document.getElementById('term');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const term = new T.Terminal(el);
    let hurry = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, reduce || hurry ? 0 : ms));
    const ok = (s) => term.write(`[\x1b[32m  OK  \x1b[0m] ${s}\n`);
    const failed = (s) => term.write(`[\x1b[1;31mFAILED\x1b[0m] ${s}\n`);

    // ソフトウェアキーボードが出ても入力行が隠れないように、見えている高さに合わせる
    const fit = () => document.documentElement.style.setProperty('--tty-h', `${window.visualViewport?.height ?? innerHeight}px`);
    window.visualViewport?.addEventListener('resize', fit);
    addEventListener('resize', fit);
    fit();

    const go = (url, flag) => {
        if (flag) { try { sessionStorage.setItem('fks-boot', '1'); } catch { /* 保存できなくても切り替えはできる */ } }
        document.documentElement.classList.add('is-off');
        location.href = url;
    };

    async function boot() {
        hurry = false;
        const skip = () => { hurry = true; };
        addEventListener('keydown', skip);
        addEventListener('pointerdown', skip);
        term.clear();
        const fsReady = (T.fsReady ??= T.buildFS());
        for (const line of T.bootLog) { term.write(`${line}\n`); await sleep(40 + Math.random() * 110); }
        await sleep(200);
        ok('Mounted /home/fks.');
        for (const [unit, state, , desc] of T.units) {
            await sleep(110);
            if (state === 'active') ok(`Started ${desc}.`);
            else if (state === 'failed') { failed(`Failed to start ${desc}.`); term.write(`See 'systemctl status ${unit}' for details.\n`); }
        }
        await sleep(160);
        ok('Reached target 部活 (Multi-User System).');
        const fs = await fsReady;
        await sleep(700);
        term.clear();
        term.write(`\n地学會 GNU/Linux 2026.10 (Pleiades) ${HOST} tty1\n\n${HOST} login: `);
        await sleep(450);
        for (const ch of USER) { term.write(ch); await sleep(90); }
        term.write('\nPassword: ');
        await sleep(600);
        let last = null;
        try { last = localStorage.getItem('fks-term-last'); localStorage.setItem('fks-term-last', new Date().toString().slice(0, 24)); } catch { /* なくてもよい */ }
        term.write(`\n${last ? `Last login: ${last} on tty1\n` : ''}${fs.get('/etc/motd').data}`);
        removeEventListener('keydown', skip);
        removeEventListener('pointerdown', skip);
        hurry = false;

        const down = async (target) => {
            term.write('\n');
            for (const [, state, , desc] of T.units) if (state === 'active') { ok(`Stopped ${desc}.`); await sleep(70); }
            ok(`Reached target ${target}.`);
            await sleep(500);
        };
        const sh = new T.Shell(term, fs, {
            onExit: async () => { await down('System Power Off'); go('./index.htm', true); },
            onPower: async (kind, c) => {
                if (kind === 'console') return 'すでにランレベル 3（ターミナル版）で動いています';
                if (kind === 'startx') {
                    c.out('\nxinit: X サーバーを起動しています...\n');
                    await sleep(500);
                    c.out('X.Org X Server 1.21（地学會 XP）\n(==) Using system config directory "/usr/share/X11/xorg.conf.d"\n');
                    await sleep(700);
                    go('./xp.htm');
                    return true;
                }
                c.out(`\nBroadcast message from ${USER}@${HOST} on tty1:\n\nThe system will ${kind === 'reboot' ? 'reboot' : 'power off'} now!\n`);
                await sleep(500);
                await down(kind === 'reboot' ? 'System Reboot' : 'System Power Off');
                if (kind === 'reboot') { setTimeout(boot, 300); return true; }
                go('./index.htm', true);
                return true;
            },
        });
        term.focus();
        sh.loop();
    }

    addEventListener('pageshow', (ev) => { if (ev.persisted) { document.documentElement.classList.remove('is-off'); boot(); } });
    boot();
})();
