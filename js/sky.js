// 背景の3D宇宙。
// ページ内の [data-shot="ショット名"] が画面中央に来ると、カメラがそのショットへ飛びます。
// 置いてあるもの：地球 / 地層と鉱物の浮島＋天体ドーム / 缶サット / Windows 98機 / プリズム / 十二面体投影機 / M45
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const SUN = V(0.75, 0.3, 0.45).normalize();
const M45_DIR = V(-0.35, 0.5, -0.8).normalize();
const EARTH_R = 10;

// ---------- 置き場所 ----------
const ISLAND = V(40, 4, 26);
const STATIONS = {
    earth: V(0, 0, 0),
    island: ISLAND.clone(),
    dome: ISLAND.clone().add(V(0.5, 2.3, -0.3)),
    strata: ISLAND.clone().add(V(0, -1.2, 0)),
    crystal: ISLAND.clone().add(V(1.6, -2.4, 2.6)),
    cansat: V(-8, 20, 34),
    chute: V(-8, 21.3, 34),
    crt: V(-34, 2, 30),
    prism: V(22, -16, 36),
    projector: V(8, 30, 10),
};

// c: 注視する置き場所 / d: 距離 / az, el: 方位と仰角(度) / sx, sy: 画面内での寄せ(-1〜1)
// 縦長画面では sx を 0 にして少し引きます（m で個別に上書き可）
const SHOTS = {
    // トップのツアー
    'earth-hero': { c: 'earth', d: 33, az: -28, el: 10, sx: 0.62, sy: -0.3, m: { d: 40, sx: 0.3, sy: 0.35 } },
    'earth-rise': { c: 'earth', d: 30, az: 4, el: 20, sx: 0, sy: -0.8, m: { d: 38, sy: -0.6 } },
    'earth-limb': { limb: true },
    'strata': { c: 'strata', d: 13, az: -35, el: -14, sx: 0.42 },
    'dome': { c: 'dome', d: 8.5, az: 30, el: 18, sx: -0.42 },
    'cansat': { c: 'chute', d: 10.5, az: -20, el: 6, sx: 0.42 },
    'crt': { c: 'crt', d: 9, az: 22, el: 10, sx: -0.38 },
    'm45': { sky: M45_DIR, pos: [-30, 40, 62], sx: 0.5 },
    'far': { c: 'earth', d: 82, az: -50, el: 28, sx: 0, sy: 0.25 },
    // 下層ページ（読みもの左・3D右）
    'dome-hero': { c: 'dome', d: 12, az: 40, el: 12, sx: 0.5 },
    'island-r': { c: 'island', d: 18, az: -12, el: 10, sx: 0.5 },
    'earth-r': { c: 'earth', d: 34, az: -30, el: 12, sx: 0.55 },
    'earth-night': { c: 'earth', d: 30, az: -112, el: 14, sx: 0.5 },
    'strata-r': { c: 'strata', d: 12, az: -30, el: -12, sx: 0.5 },
    'crystal-r': { c: 'crystal', d: 6.5, az: 35, el: -8, sx: 0.5 },
    'dome-r': { c: 'dome', d: 7.5, az: 42, el: 20, sx: 0.5 },
    'scope-r': { c: 'dome', d: 7, az: -30, el: 30, sx: 0.5 },
    'crt-r': { c: 'crt', d: 8, az: -16, el: 8, sx: 0.5 },
    'crt-close': { c: 'crt', d: 5.5, az: 14, el: 16, sx: 0.5 },
    'prism-r': { c: 'prism', d: 10, az: 0, el: 6, sx: 0.45 },
    'cansat-hero': { c: 'chute', d: 11.5, az: -15, el: 5, sx: 0.5 },
    'cansat-a': { c: 'cansat', d: 6.2, az: 40, el: 22, sx: 0.5 },
    'cansat-b': { c: 'cansat', d: 5.6, az: -52, el: -12, sx: 0.5 },
    'cansat-c': { c: 'cansat', d: 7.4, az: 10, el: 36, sx: 0.5 },
    'm45-r': { sky: M45_DIR, pos: [-30, 40, 62], sx: 0.5 },
    'projector-hero': { c: 'projector', d: 11, az: -20, el: 4, sx: 0.5 },
    'projector-r': { c: 'projector', d: 6.5, az: 24, el: 16, sx: 0.5 },
};

const canvas = document.getElementById('sky');
if (canvas) {
    try { start(); } catch (err) { console.warn('3D背景を開始できませんでした:', err); }
}

function start() {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x020309, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2500);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.32;

    const sun = new THREE.DirectionalLight(0xfff3df, 2.9);
    sun.position.copy(SUN).multiplyScalar(100);
    scene.add(sun, new THREE.HemisphereLight(0x8fb4ff, 0x05060c, 0.4));

    // 解像度：PCは実ピクセル等倍（低DPIでは1.25倍で描いて縮小）、MSAAつき
    const coarse = matchMedia('(pointer: coarse)').matches;
    const baseDpr = coarse ? Math.min(devicePixelRatio || 1, 1.75) : Math.min(Math.max(devicePixelRatio || 1, 1.25), 2);
    let dpr = baseDpr;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 2 : 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.7, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // 時間で動くものはここに登録する
    const tickers = [];
    const uTime = { value: 0 };
    const earthOct = { value: 7 };
    const G_NOISE = /* glsl */`
        float gHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float gNoise(vec3 x){
            vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float gFbm(vec3 p, int oct){
            float a = 0.5, s = 0.0;
            for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * gNoise(p); p = p * 2.03 + 17.7; a *= 0.5; }
            return s;
        }`;

    // ---------- 星空（カメラに追従＝無限遠） ----------
    const sky = new THREE.Group();
    scene.add(sky);
    const glowTex = makeGlowTexture(false);
    const sparkTex = makeGlowTexture(true);
    const starMat = makeStars(sky);
    makeSkyGlow(sky, glowTex, sparkTex);
    const meteors = makeMeteors(sky);

    // ---------- 天体と模型 ----------
    const earth = makeEarth();
    scene.add(earth);

    const island = makeIsland();
    island.position.copy(STATIONS.island);
    scene.add(island);
    tickers.push((t) => { island.position.y = STATIONS.island.y + Math.sin(t * 0.5) * 0.12; });

    const cansat = makeCanSat();
    cansat.position.copy(STATIONS.cansat);
    scene.add(cansat);

    const crt = makeCRT();
    crt.position.copy(STATIONS.crt);
    scene.add(crt);

    const prism = makePrism();
    prism.position.copy(STATIONS.prism);
    scene.add(prism);

    const projector = makeProjector();
    projector.position.copy(STATIONS.projector);
    scene.add(projector);

    // ---------- カメラワーク ----------
    const poses = {};
    let keys = [];
    const camPos = V(0, 0, 40), camLook = V(0, 0, 0);
    const wantPos = V(), wantLook = V();
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    let first = true;

    function buildPoses() {
        const portrait = camera.aspect < 0.85;
        const tanV = Math.tan(camera.fov * DEG / 2);
        const tanH = tanV * camera.aspect;
        const up = V(0, 1, 0);
        for (const [name, raw] of Object.entries(SHOTS)) {
            const s = portrait ? { ...raw, sx: 0, sy: 0.3, d: raw.d * 1.25, ...raw.m } : raw;
            let pos, c;
            if (s.limb) {
                // 昼側の地表すれすれを飛ぶ
                // （北向きに飛ぶと地平線が水平になる）
                const dir = sph(52, 26);
                pos = dir.clone().multiplyScalar(EARTH_R + 2.6);
                const fwd = sph(52, 27).sub(dir).normalize();
                poses[name] = { pos, look: pos.clone().addScaledVector(fwd, 9).addScaledVector(dir, portrait ? -8.5 : -10) };
                continue;
            }
            if (s.sky) {
                pos = V(...s.pos);
                c = pos.clone().addScaledVector(s.sky, 300);
            } else {
                c = STATIONS[s.c];
                pos = c.clone().addScaledVector(sph(s.az, s.el), s.d);
            }
            const f = c.clone().sub(pos);
            const dist = f.length();
            f.normalize();
            const right = f.clone().cross(up).normalize();
            const upv = right.clone().cross(f);
            const look = c.clone()
                .addScaledVector(right, -(s.sx || 0) * dist * tanH)
                .addScaledVector(upv, -(s.sy || 0) * dist * tanV);
            poses[name] = { pos, look };
        }
    }

    function measure() {
        const vh = innerHeight;
        keys = [];
        document.querySelectorAll('[data-shot]').forEach((el) => {
            const r = el.getBoundingClientRect();
            const top = r.top + scrollY;
            const half = Math.min(r.height, vh) / 2;
            const names = el.dataset.shot.trim().split(/\s+/).filter((n) => SHOTS[n]);
            if (!names.length) return;
            keys.push({ y: top + half - vh / 2, shot: names[0] });
            // 画面より長い節は、読んでいる間ゆっくり2つ目のショットへ
            if (r.height > vh * 1.15) keys.push({ y: top + r.height - half - vh / 2, shot: names[1] || names[0] });
        });
        keys.sort((a, b) => a.y - b.y);
        // 画面より低いヒーローでも、スクロール0ではそのショットに居る
        if (keys.length) keys[0].y = Math.max(keys[0].y, 0);
        if (!keys.length) keys.push({ y: 0, shot: 'earth-hero' });
    }

    function wanted() {
        const y = scrollY;
        let i = 0;
        while (i < keys.length - 2 && y > keys[i + 1].y) i++;
        const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
        const span = Math.max(1, b.y - a.y);
        let e = THREE.MathUtils.clamp((y - a.y) / span, 0, 1);
        e = e * e * e * (e * (e * 6 - 15) + 10);
        const pa = poses[a.shot], pb = poses[b.shot];
        wantPos.lerpVectors(pa.pos, pb.pos, e);
        wantLook.lerpVectors(pa.look, pb.look, e);
        // 地球をすり抜けない
        if (wantPos.length() < EARTH_R + 2.4) wantPos.setLength(EARTH_R + 2.4);
    }

    // 描画する大きさ。タッチ端末ではブラウザのツールバーが出入りするたびに高さが変わるので、
    // そのつど描画バッファを作り直さず、いちばん高いときに合わせておく（はみ出た下端は隠れるだけ）
    let viewW = 0, viewH = 0;
    function viewport() {
        const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
        if (!coarse || w !== viewW) { viewW = w; viewH = h; return true; }
        if (h > viewH) { viewH = h; return true; }
        return false;
    }

    function resize() {
        const w = viewW, h = viewH;
        canvas.style.height = `${h}px`;
        camera.aspect = w / h;
        camera.fov = camera.aspect < 0.85 ? 52 : 40;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        composer.setPixelRatio(dpr);
        composer.setSize(w, h);
        starMat.uniforms.uDpr.value = dpr;
        buildPoses();
        measure();
    }
    viewport();
    resize();
    const onResize = () => { if (viewport()) resize(); else measure(); };
    addEventListener('resize', onResize);
    addEventListener('load', measure);
    new ResizeObserver(measure).observe(document.body);
    addEventListener('pointermove', (e) => {
        pointer.x = e.clientX / innerWidth * 2 - 1;
        pointer.y = e.clientY / viewH * 2 - 1;
    }, { passive: true });

    // ---------- ループ ----------
    const clock = new THREE.Clock();
    const tmpR = V(), tmpU = V(), tmpF = V();
    let frames = 0, quality = 0, warm = false, accT = 0, accN = 0;

    // 重い端末では一気に落とさず、解像度を少しずつ下げる（最終段でブルームと細部ノイズも省く）
    function setQuality(q) {
        quality = q;
        dpr = [baseDpr, Math.max(1, baseDpr * 0.8), Math.max(1, baseDpr * 0.62), 1][q];
        bloom.enabled = q < 3;
        earthOct.value = q < 3 ? 7 : 5;
        resize();
    }

    function loop() {
        requestAnimationFrame(loop);
        // resize イベントが来ないブラウザ向けの保険
        if (innerWidth !== viewW || innerHeight > viewH) onResize();
        const raw = clock.getDelta();
        const dt = Math.min(raw, 0.05);
        const t = reduce ? 8 : clock.elapsedTime;
        uTime.value = t;

        wanted();
        const k = first || reduce ? 1 : 1 - Math.exp(-dt * 3.2);
        camPos.lerp(wantPos, k);
        camLook.lerp(wantLook, k);
        if (camPos.length() < EARTH_R + 2.2) camPos.setLength(EARTH_R + 2.2);
        first = false;

        // ポインタと呼吸でわずかに揺らす
        pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 2.5);
        pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 2.5);
        tmpF.copy(camLook).sub(camPos);
        const dist = tmpF.length();
        tmpF.normalize();
        tmpR.copy(tmpF).cross(camera.up).normalize();
        tmpU.copy(tmpR).cross(tmpF);
        const sway = reduce ? 0 : Math.min(dist, 40) * 0.035;
        camera.position.copy(camPos)
            .addScaledVector(tmpR, (pointer.sx + Math.sin(t * 0.21) * 0.35) * sway)
            .addScaledVector(tmpU, (-pointer.sy + Math.cos(t * 0.17) * 0.35) * sway);
        camera.lookAt(camLook);

        sky.position.copy(camera.position);
        if (!reduce) {
            for (const fn of tickers) fn(t, dt);
            meteors.update(dt, camera);
        }
        composer.render(dt);

        if (frames++ === 0) canvas.classList.add('is-ready');
        if (quality < 3 && !document.hidden && raw < 0.25) {
            accT += raw;
            if (++accN >= 45) {
                // 最初の区間はシェーダのコンパイルを含むので数えない
                if (warm && accT / accN > 0.03) setQuality(quality + 1);
                warm = true;
                accT = accN = 0;
            }
        }
    }

    // 初期描画（ここまでに tickers を全部登録しておく）
    tickers.push(...earth.userData.tick, ...cansat.userData.tick, ...crt.userData.tick, ...prism.userData.tick, ...projector.userData.tick, ...island.userData.tick);
    loop();

    // ================= ここから下は部品 =================

    function sph(azDeg, elDeg) {
        const az = azDeg * DEG, el = elDeg * DEG;
        return V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    }

    function std(color, o = {}) {
        return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
    }

    function makeGlowTexture(spikes) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.08, 'rgba(255,255,255,.85)');
        grad.addColorStop(0.25, 'rgba(255,255,255,.22)');
        grad.addColorStop(0.6, 'rgba(255,255,255,.05)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 256);
        if (spikes) {
            g.globalCompositeOperation = 'lighter';
            for (const rot of [0, Math.PI / 2]) {
                g.save();
                g.translate(128, 128);
                g.rotate(rot + 0.35);
                const lg = g.createLinearGradient(-128, 0, 128, 0);
                lg.addColorStop(0, 'rgba(255,255,255,0)');
                lg.addColorStop(0.5, 'rgba(255,255,255,.9)');
                lg.addColorStop(1, 'rgba(255,255,255,0)');
                g.fillStyle = lg;
                g.fillRect(-128, -1.2, 256, 2.4);
                g.restore();
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    function makeStars(parent) {
        const N = 5200, MW = 7500, total = N + MW;
        const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
        const size = new Float32Array(total), phase = new Float32Array(total);
        const palette = [[0.62, 0.74, 1], [0.8, 0.86, 1], [1, 0.97, 0.92], [1, 0.86, 0.68], [1, 0.72, 0.5]];
        const R = 900;
        const n = V(0.35, 0.8, -0.45).normalize();
        const a = V(1, 0, 0).cross(n).normalize(), b = n.clone().cross(a);
        const d = V();
        for (let i = 0; i < total; i++) {
            let bright;
            if (i < N) {
                const u = rand(1, -1), ph = rand(Math.PI * 2), s = Math.sqrt(1 - u * u);
                d.set(s * Math.cos(ph), u, s * Math.sin(ph));
                bright = Math.pow(Math.random(), 7);
                size[i] = 1.5 + bright * 6.5;
            } else {
                // 天の川：大円のまわりに寄せる
                const ph = rand(Math.PI * 2);
                const clump = 0.6 + 0.4 * Math.sin(ph * 3 + 1) * Math.sin(ph * 5.3);
                const lat = (rand() + rand() + rand() - 1.5) * 0.24 * clump;
                d.copy(a).multiplyScalar(Math.cos(ph)).addScaledVector(b, Math.sin(ph)).multiplyScalar(Math.cos(lat)).addScaledVector(n, Math.sin(lat));
                bright = Math.pow(Math.random(), 3) * 0.12;
                size[i] = 1.1 + Math.random() * 1.2;
            }
            pos.set([d.x * R, d.y * R, d.z * R], i * 3);
            const c = palette[Math.min(4, Math.floor(Math.pow(Math.random(), 1.4) * 5))];
            const I = 0.45 + bright * 3.2;
            col.set([c[0] * I, c[1] * I, c[2] * I], i * 3);
            phase[i] = Math.random();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTime, uDpr: { value: 1 } },
            vertexShader: /* glsl */`
                attribute vec3 aColor; attribute float aSize; attribute float aPhase;
                uniform float uTime; uniform float uDpr;
                varying vec3 vColor;
                void main(){
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    float tw = 0.82 + 0.18 * sin(uTime * (1.2 + aPhase * 2.5) + aPhase * 50.0);
                    gl_PointSize = aSize * uDpr * tw;
                    vColor = aColor * tw;
                }`,
            fragmentShader: /* glsl */`
                varying vec3 vColor;
                void main(){
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.4);
                    gl_FragColor = vec4(vColor * a, a);
                }`,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        });
        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = -10;
        parent.add(points);
        tickers.push((t) => { points.rotation.y = t * 0.0025; });
        return mat;
    }

    function sprite(tex, color, scale, opacity = 1) {
        const m = new THREE.SpriteMaterial({ map: tex, color, opacity, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
        const s = new THREE.Sprite(m);
        s.scale.setScalar(scale);
        s.renderOrder = -9;
        return s;
    }

    function makeSkyGlow(parent, glow, spark) {
        // 太陽
        const s = sprite(glow, new THREE.Color(3.2, 2.8, 2.2), 260);
        s.position.copy(SUN).multiplyScalar(880);
        parent.add(s);

        // 天の川のにじみ
        const n = V(0.35, 0.8, -0.45).normalize();
        const a = V(1, 0, 0).cross(n).normalize(), b = n.clone().cross(a);
        const tints = [0x3b4fd0, 0x7a4fd6, 0x2f8fc0, 0xb0763a];
        for (let i = 0; i < 16; i++) {
            const ph = i / 16 * Math.PI * 2 + rand(0.2);
            const g = sprite(glow, tints[i % 4], rand(520, 320), rand(0.11, 0.05));
            g.position.copy(a).multiplyScalar(Math.cos(ph)).addScaledVector(b, Math.sin(ph)).addScaledVector(n, rand(0.1, -0.1)).multiplyScalar(860);
            parent.add(g);
        }

        // M45 プレアデス星団。アルキオネからの離角(分角)、東が左
        const stars = [
            [0, 0, 1.0], [23, -3, 0.72], [-35.6, 1, 0.7], [-22.6, 16, 0.66], [-15.8, -9, 0.6],
            [-31.3, 22, 0.55], [23.3, 5, 0.45], [-36.8, 11, 0.38], [-21.7, 27, 0.36],
        ];
        const m45 = new THREE.Group();
        m45.position.copy(M45_DIR).multiplyScalar(820);
        m45.lookAt(0, 0, 0);
        const k = 3.1;
        for (const [east, north, mag] of stars) {
            const st = sprite(spark, new THREE.Color(1.6, 2.1, 3.4).multiplyScalar(0.5 + mag), 20 + mag * 44);
            st.position.set(east * k, north * k, 0);
            const neb = sprite(glow, 0x3d6fe8, 90 + mag * 150, 0.07);
            neb.position.set(east * k + 6, north * k - 8, -2);
            m45.add(neb, st);
            const base = st.scale.x, ph = Math.random() * 6;
            tickers.push((t) => { st.scale.setScalar(base * (1 + 0.06 * Math.sin(t * 1.7 + ph))); });
        }
        parent.add(m45);
    }

    function makeMeteors(parent) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const pool = [];
        for (let i = 0; i < 3; i++) {
            const mat = new THREE.ShaderMaterial({
                uniforms: { uFade: { value: 0 } },
                vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                fragmentShader: /* glsl */`
                    varying vec2 vUv; uniform float uFade;
                    void main(){
                        float core = pow(clamp(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0, 1.0), 3.0);
                        float a = pow(clamp(vUv.x, 0.0, 1.0), 2.5) * core * uFade;
                        gl_FragColor = vec4(mix(vec3(0.5, 1.0, 0.8), vec3(1.0), vUv.x) * a * 3.0, a);
                    }`,
                blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.matrixAutoUpdate = false;
            mesh.frustumCulled = false;
            parent.add(mesh);
            pool.push({ mesh, mat, life: 0, p: V(), v: V() });
        }
        let wait = 2.5;
        const fwd = V(), X = V(), Y = V(), Z = V(), basis = new THREE.Matrix4();
        return {
            update(dt, cam) {
                wait -= dt;
                if (wait < 0) {
                    wait = rand(6, 2);
                    const m = pool.find((q) => q.life <= 0);
                    if (m) {
                        cam.getWorldDirection(fwd);
                        m.p.copy(fwd).add(V(rand(0.6, -0.6), rand(0.5, -0.1), rand(0.6, -0.6))).normalize().multiplyScalar(300);
                        m.v.set(rand(1, -1), rand(-0.2, -1), rand(1, -1)).normalize();
                        m.v.addScaledVector(m.p, -m.v.dot(m.p) / m.p.lengthSq()).normalize().multiplyScalar(rand(260, 170));
                        m.life = 1;
                        m.mesh.visible = true;
                    }
                }
                for (const m of pool) {
                    if (m.life <= 0) continue;
                    m.life -= dt * 1.2;
                    m.p.addScaledVector(m.v, dt);
                    X.copy(m.v).normalize();
                    Z.copy(m.p).normalize().negate();
                    Y.copy(Z).cross(X).normalize();
                    basis.makeBasis(X.multiplyScalar(46), Y.multiplyScalar(1.5), Z);
                    basis.setPosition(m.p);
                    m.mesh.matrix.copy(basis);
                    m.mat.uniforms.uFade.value = Math.sin(Math.max(0, m.life) * Math.PI);
                    if (m.life <= 0) m.mesh.visible = false;
                }
            },
        };
    }

    // ---------- 手続き的な質感 ----------
    // 形はノイズで頂点を動かし、色と細かい凹凸はピクセル単位で描く（ポリゴンの角を見せない）

    function jsHash(x, y, z) {
        const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
        return n - Math.floor(n);
    }
    function jsNoise(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        let fx = x - ix, fy = y - iy, fz = z - iz;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
        const l = (a, b, t) => a + (b - a) * t;
        const h = jsHash;
        return l(
            l(l(h(ix, iy, iz), h(ix + 1, iy, iz), fx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
            l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx), fy),
            fz,
        );
    }
    function jsFbm(x, y, z, oct = 4) {
        let a = 0.5, s = 0;
        for (let i = 0; i < oct; i++) {
            s += a * jsNoise(x, y, z);
            x = x * 2.03 + 17.7; y = y * 2.03 + 17.7; z = z * 2.03 + 17.7;
            a *= 0.5;
        }
        return s;
    }
    function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    // 標準マテリアルに、オブジェクト座標ベースの色と凹凸を差し込む
    function procedural(mat, { head = '', color = '', bump = '' }) {
        mat.onBeforeCompile = (sh) => {
            sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vOP;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
            sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', `#include <common>\nvarying vec3 vOP;\n${G_NOISE}\n${head}`)
                .replace('#include <color_fragment>', `#include <color_fragment>\n{\n${color}\n}`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${bump}`);
        };
        mat.customProgramCacheKey = () => head + color + bump;
        return mat;
    }
    // 高さ式 expr の勾配で法線を傾ける（amount は凹凸の深さ）
    function bumpCode(expr, amount) {
        return /* glsl */`
            {
                float bh = ${expr};
                vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
                vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
                float det = dot(sx, r1);
                vec3 nn = abs(det) * normal - sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2) * ${amount.toFixed(4)};
                if (dot(nn, nn) > 0.0) normal = normalize(nn);
            }`;
    }

    function makeEarth() {
        const group = new THREE.Group();
        const surface = new THREE.ShaderMaterial({
            uniforms: { uSun: { value: SUN }, uTime, uOct: earthOct },
            vertexShader: /* glsl */`
                varying vec3 vObj; varying vec3 vN; varying vec3 vW;
                void main(){
                    vObj = position;
                    vN = normalize(mat3(modelMatrix) * normal);
                    vec4 w = modelMatrix * vec4(position, 1.0);
                    vW = w.xyz;
                    gl_Position = projectionMatrix * viewMatrix * w;
                }`,
            fragmentShader: /* glsl */`
                uniform vec3 uSun; uniform float uTime; uniform int uOct;
                varying vec3 vObj; varying vec3 vN; varying vec3 vW;
                ${G_NOISE}
                void main(){
                    vec3 p = normalize(vObj);
                    vec3 warp = vec3(gNoise(p * 2.3 + 11.0), gNoise(p * 2.3 + 47.0), gNoise(p * 2.3 + 83.0)) - 0.5;
                    float h = gFbm(p * 1.75 + warp * 0.9, uOct);
                    float land = smoothstep(0.549, 0.556, h);
                    float lat = abs(p.y);
                    float elev = clamp((h - 0.552) / 0.2, 0.0, 1.0);

                    // 海：沖は深い青、大陸棚はエメラルド
                    vec3 ocean = mix(vec3(0.003, 0.016, 0.06), vec3(0.008, 0.075, 0.14), smoothstep(0.38, 0.55, h));
                    float shelf = smoothstep(0.515, 0.552, h);
                    ocean = mix(ocean, vec3(0.015, 0.2, 0.2), shelf * shelf * 0.75);

                    // 陸：植生・乾燥帯・山・雪
                    float arid = smoothstep(0.34, 0.06, abs(lat - 0.33)) * smoothstep(0.35, 0.65, gNoise(p * 3.1 + 5.0));
                    vec3 veg = mix(vec3(0.018, 0.08, 0.018), vec3(0.09, 0.135, 0.035), gNoise(p * 9.0));
                    veg *= 0.82 + 0.36 * gNoise(p * 70.0);
                    vec3 ground = mix(veg, vec3(0.34, 0.24, 0.11) * (0.8 + 0.4 * gNoise(p * 45.0)), arid);
                    ground = mix(ground, vec3(0.17, 0.14, 0.11), smoothstep(0.3, 0.65, elev));
                    ground = mix(ground, vec3(0.86), smoothstep(0.84, 1.0, elev + (gNoise(p * 90.0) - 0.5) * 0.08));
                    float ice = smoothstep(0.82, 0.9, lat + (h - 0.5) * 0.3);
                    vec3 albedo = mix(mix(ocean, ground, land), vec3(0.82, 0.88, 0.95), ice);

                    float ca = uTime * 0.006;
                    vec3 cp = vec3(p.x * cos(ca) - p.z * sin(ca), p.y, p.x * sin(ca) + p.z * cos(ca));
                    float c = gFbm(cp * 3.6 + warp * 1.3 + vec3(0.0, uTime * 0.003, 0.0), uOct - 1);
                    c += (gNoise(cp * 26.0 + 3.0) - 0.5) * 0.07;
                    float cloud = smoothstep(0.5, 0.72, c) * 0.95;

                    vec3 N = normalize(vN), L = normalize(uSun), Vd = normalize(cameraPosition - vW);
                    // 地形の陰影（高さの勾配で法線を傾ける）
                    vec3 Nr = N;
                    {
                        float bh = max(h, 0.552);
                        vec3 sx = dFdx(vW), sy = dFdy(vW);
                        vec3 r1 = cross(sy, N), r2 = cross(N, sx);
                        float det = dot(sx, r1);
                        vec3 nn = abs(det) * N - sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2) * 2.2;
                        if (dot(nn, nn) > 0.0) Nr = normalize(nn);
                    }
                    float ndl = dot(N, L);
                    float day = smoothstep(-0.12, 0.25, ndl);
                    float diff = max(ndl, 0.0);
                    float diffR = max(dot(Nr, L), 0.0) * smoothstep(0.0, 0.22, ndl);

                    vec3 col = albedo * mix(diff, diffR, land * (1.0 - ice * 0.5)) * 1.7;
                    float spec = pow(max(dot(N, normalize(L + Vd)), 0.0), 140.0);
                    col += vec3(1.0, 0.94, 0.82) * spec * (1.0 - land) * (1.0 - cloud) * 0.9;
                    float thick = smoothstep(0.5, 0.95, c);
                    col = mix(col, vec3(1.0, 0.99, 0.97) * (diff * (0.86 + 0.2 * thick) + 0.015), cloud);

                    // 夜側の街あかり
                    float city = smoothstep(0.4, 0.68, gNoise(p * 110.0) * gNoise(p * 34.0 + 3.0)) * smoothstep(0.3, 0.6, gNoise(p * 7.0 + 9.0));
                    city *= land * (1.0 - ice) * smoothstep(0.8, 0.3, elev);
                    col += vec3(1.0, 0.7, 0.34) * city * (1.0 - day) * (1.0 - cloud * 0.85) * 1.3;

                    // 朝夕の赤み、大気の青
                    float dusk = smoothstep(-0.1, 0.12, ndl) * (1.0 - smoothstep(0.12, 0.42, ndl));
                    col += vec3(1.0, 0.38, 0.12) * dusk * (cloud * 0.35 + 0.03);
                    float fres = pow(clamp(1.0 - dot(N, Vd), 0.0, 1.0), 2.6);
                    col += vec3(0.2, 0.46, 1.0) * fres * (day * 0.85 + 0.035);
                    col += albedo * 0.012;
                    gl_FragColor = vec4(col, 1.0);
                }`,
        });
        const globe = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 256, 192), surface);
        globe.rotation.z = 23.4 * DEG;
        group.add(globe);

        const air = new THREE.Mesh(
            new THREE.SphereGeometry(EARTH_R * 1.12, 128, 96),
            new THREE.ShaderMaterial({
                uniforms: { uSun: { value: SUN } },
                vertexShader: /* glsl */`
                    varying vec3 vN; varying vec3 vW;
                    void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
                fragmentShader: /* glsl */`
                    uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
                    void main(){
                        vec3 N = normalize(vN), Vd = normalize(cameraPosition - vW);
                        float rim = pow(clamp(-dot(N, Vd) / 0.45, 0.0, 1.0), 2.6);
                        float lit = smoothstep(-0.35, 0.35, dot(N, normalize(uSun)));
                        vec3 c = mix(vec3(1.0, 0.45, 0.2), vec3(0.28, 0.58, 1.0), smoothstep(0.0, 0.5, lit));
                        gl_FragColor = vec4(c * rim * (lit * 1.15 + 0.04), 1.0);
                    }`,
                side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
            }),
        );
        group.add(air);
        group.userData.tick = [(t) => { globe.rotation.y = t * 0.012; }];
        return group;
    }

    // ノイズでいびつにした岩。同じシェーダを全部の岩で使い回す
    function rock(radius, seed, tint, detail = 10) {
        let geo = new THREE.IcosahedronGeometry(1, detail);
        geo.deleteAttribute('uv');
        geo.deleteAttribute('normal');
        geo = mergeVertices(geo);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const lump = jsFbm(x * 1.4 + seed, y * 1.4, z * 1.4, 4);
            const chip = Math.abs(jsNoise(x * 3.3 + seed, y * 3.3 + 9, z * 3.3) - 0.5);
            const k = radius * (0.62 + 0.75 * lump - 0.35 * chip);
            p.setXYZ(i, x * k, y * k * 0.85, z * k);
        }
        geo.computeVertexNormals();
        const mat = procedural(std(tint, { roughness: 0.95, metalness: 0 }), {
            color: 'diffuseColor.rgb *= 0.5 + 0.95 * gFbm(vOP * 4.0, 5);',
            bump: bumpCode('gFbm(vOP * 7.0, 5) + 0.35 * gNoise(vOP * 40.0)', 0.05),
        });
        return new THREE.Mesh(geo, mat);
    }

    function crystal(h, r, color) {
        const mat = new THREE.MeshPhysicalMaterial({
            color, roughness: 0.2, metalness: 0, flatShading: true,
            clearcoat: 1, clearcoatRoughness: 0.25, iridescence: 0.7, iridescenceIOR: 1.6,
            transparent: true, opacity: 0.9, emissive: color, emissiveIntensity: 0.3, envMapIntensity: 3.2,
        });
        const g = new THREE.Group();
        // 六角柱＋二段の錐面
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.82, h, 6), mat);
        body.position.y = h / 2;
        const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, r * 0.7, 6), mat);
        shoulder.position.y = h + r * 0.35;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, r * 0.9, 6), mat);
        tip.position.y = h + r * 0.7 + r * 0.45;
        g.add(body, shoulder, tip);
        return g;
    }

    function crystalCluster(count, scale) {
        const g = new THREE.Group();
        const colors = [0x9d6bff, 0xcfe9ff, 0x4fe3c1, 0x7fb2ff];
        for (let i = 0; i < count; i++) {
            const c = crystal(rand(1.5, 0.5) * scale, rand(0.2, 0.09) * scale, colors[i % colors.length]);
            c.rotation.set(rand(0.75, -0.75), rand(6), rand(0.75, -0.75));
            c.position.set(rand(0.3, -0.3) * scale, 0, rand(0.3, -0.3) * scale);
            g.add(c);
        }
        const base = rock(0.42 * scale, count * 3.7, 0x6b5a4c, 6);
        base.scale.y = 0.5;
        g.add(base);
        return g;
    }

    function makeIsland() {
        const g = new THREE.Group();
        const rockTints = [0x8a6a4f, 0x5d4233, 0xa5613f, 0x6b7078, 0x9a8468, 0x4b5560];

        // --- 地層の見える岩塊 ---
        const H = 6;
        const bandOf = (x, y, z) => (y + x * 0.09 - z * 0.05 + 0.12 * Math.sin(x * 1.3)) * 1.9 + 6.2;
        let geo = new THREE.CylinderGeometry(1, 1, H, 240, 132, true);
        geo.deleteAttribute('uv');
        geo.deleteAttribute('normal');
        geo = mergeVertices(geo);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const y = p.getY(i);
            const a = Math.atan2(p.getZ(i), p.getX(i));
            const nx = Math.cos(a), nz = Math.sin(a);
            const t = (y + H / 2) / H;
            const base = (0.03 + 0.97 * Math.pow(t, 0.6)) * 4.1;
            const lump = jsFbm(nx * 1.3 + 3, y * 0.5, nz * 1.3, 4) - 0.5;
            const fine = jsFbm(nx * 5 + 9, y * 2.2, nz * 5, 4) - 0.5;
            // 硬い層は張り出し、やわらかい層はえぐれる
            const b = bandOf(nx * base, y, nz * base);
            const bi = Math.floor(b);
            const hard = jsHash(bi - 1, 3.1, 7.7) + (jsHash(bi, 3.1, 7.7) - jsHash(bi - 1, 3.1, 7.7)) * smooth(0, 0.14, b - bi);
            const r = base * (1 + lump * 0.34 + fine * 0.07) + (hard - 0.5) * 0.34 * Math.min(1, t * 3);
            p.setXYZ(i, nx * r, y, nz * r);
        }
        geo.computeVertexNormals();
        const STRATA = /* glsl */`
            const vec3 BANDS[8] = vec3[8](
                vec3(0.50, 0.34, 0.19), vec3(0.06, 0.07, 0.09), vec3(0.34, 0.10, 0.05), vec3(0.60, 0.54, 0.40),
                vec3(0.19, 0.10, 0.06), vec3(0.24, 0.26, 0.29), vec3(0.19, 0.15, 0.27), vec3(0.47, 0.31, 0.09));
            vec3 bandColor(float i){ return BANDS[int(mod(floor(gHash(vec3(i, 1.7, 4.2)) * 8.0) + i, 8.0))]; }
            vec3 strata(vec3 p){
                float b = (p.y + p.x * 0.09 - p.z * 0.05 + 0.12 * sin(p.x * 1.3) + (gFbm(p * 1.1, 3) - 0.5) * 0.14) * 1.9 + 6.2;
                float i = floor(b), f = fract(b);
                vec3 c = mix(bandColor(i), bandColor(i + 1.0), smoothstep(0.9, 1.0, f));
                c *= 0.78 + 0.34 * gNoise(vec3(b * 14.0, p.x * 0.5, p.z * 0.5));
                c *= 0.6 + 0.8 * gFbm(p * 4.0, 5);
                return c;
            }`;
        const cliff = new THREE.Mesh(geo, procedural(std(0xffffff, { roughness: 0.93, metalness: 0 }), {
            head: STRATA,
            color: 'diffuseColor.rgb = strata(vOP);',
            bump: bumpCode('gFbm(vOP * vec3(3.0, 10.0, 3.0), 5) + 0.25 * gNoise(vec3(vOP.y * 42.0, vOP.xz * 1.5))', 0.11),
        }));
        cliff.position.y = -H / 2;
        g.add(cliff);
        const tipRock = rock(0.5, 2.2, 0x5d4233, 8);
        tipRock.position.y = -H + 0.15;
        g.add(tipRock);

        // --- 上面の地面 ---
        const turfGeo = new THREE.SphereGeometry(4.35, 160, 40, 0, Math.PI * 2, 0, Math.PI / 2);
        const tp = turfGeo.attributes.position;
        for (let i = 0; i < tp.count; i++) {
            const x = tp.getX(i), z = tp.getZ(i);
            const rr = Math.hypot(x, z) / 4.35;
            const y = tp.getY(i) * 0.06 + (jsFbm(x * 0.7 + 2, 0, z * 0.7, 4) - 0.5) * 0.4 * (1 - rr * rr * rr) - rr * rr * rr * rr * 0.12;
            tp.setY(i, y);
        }
        turfGeo.computeVertexNormals();
        const turf = new THREE.Mesh(turfGeo, procedural(std(0xffffff, { roughness: 1, metalness: 0 }), {
            color: /* glsl */`
                float tg = gFbm(vOP * 2.4, 5);
                vec3 grass = mix(vec3(0.035, 0.09, 0.03), vec3(0.15, 0.2, 0.06), tg);
                grass *= 0.75 + 0.5 * gNoise(vOP * 38.0);
                diffuseColor.rgb = mix(grass, vec3(0.2, 0.15, 0.1), smoothstep(0.52, 0.7, gFbm(vOP * 0.9 + 4.0, 4)));`,
            bump: bumpCode('gFbm(vOP * 16.0, 4)', 0.03),
        }));
        g.add(turf);

        // --- 鉱物 ---
        const under = crystalCluster(9, 1.5);
        under.position.set(1.6, -2.3, 2.2);
        under.rotation.set(1.9, 0, -0.5);
        const side = crystalCluster(6, 1.0);
        side.position.set(-2.6, -1.2, 1.9);
        side.rotation.set(1.3, 0, 1.0);
        const top = crystalCluster(5, 0.7);
        top.position.set(-2.4, 0.25, 1.7);
        g.add(under, side, top);

        // --- 天体ドーム ---
        const dome = new THREE.Group();
        dome.position.set(0.5, 0.2, -0.3);
        const TAU = 'float a = atan(vOP.z, vOP.x) / 6.2831853;';
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.8, 1.4, 96), procedural(std(0xcfcdc6, { roughness: 0.55, metalness: 0.08 }), {
            // パネルの継ぎ目
            color: `${TAU} diffuseColor.rgb *= 0.74 + 0.26 * smoothstep(0.0, 0.03, abs(fract(a * 16.0) - 0.5)); diffuseColor.rgb *= 0.9 + 0.1 * gFbm(vOP * 6.0, 4);`,
        }));
        wall.position.y = 0.7;
        const footing = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.0, 0.16, 96), std(0x8d8a82, { roughness: 0.9 }));
        footing.position.y = 0.06;
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.87, 1.87, 0.15, 96), std(0xe2b23a, { roughness: 0.45, metalness: 0.2 }));
        ring.position.y = 1.42;
        const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 12, 8), std(0x8f7422, { roughness: 0.4, metalness: 0.6 }), 40);
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < 40; i++) {
            const a = i / 40 * Math.PI * 2;
            rivets.setMatrixAt(i, m4.makeTranslation(Math.cos(a) * 1.875, 1.42, Math.sin(a) * 1.875));
        }
        const doorFrame = new THREE.Mesh(new RoundedBoxGeometry(0.62, 1.02, 0.08, 3, 0.03), std(0x9aa0a8, { roughness: 0.4, metalness: 0.6 }));
        doorFrame.position.set(0, 0.56, 1.76);
        const door = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.92, 0.1, 3, 0.02), std(0x2f4156, { roughness: 0.35, metalness: 0.5 }));
        door.position.set(0, 0.54, 1.77);
        const porthole = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), std(0x9fd0ff, { emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.3 }));
        porthole.position.set(0, 0.74, 1.83);
        const step = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.12, 0.4, 2, 0.03), std(0x8d8a82, { roughness: 0.9 }));
        step.position.set(0, 0.06, 2.0);
        dome.add(wall, footing, ring, rivets, doorFrame, door, porthole, step);

        const cap = new THREE.Group();
        cap.position.y = 1.48;
        const gap = 0.52;
        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(1.8, 128, 48, gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2),
            procedural(std(0xd6d6d4, { roughness: 0.36, metalness: 0.32, side: THREE.DoubleSide }), {
                color: `${TAU} float seam = smoothstep(0.0, 0.035, abs(fract(a * 20.0) - 0.5)) * smoothstep(0.0, 0.03, abs(fract(vOP.y * 2.6) - 0.5)); diffuseColor.rgb *= 0.72 + 0.28 * seam;`,
            }),
        );
        const inside = new THREE.Mesh(new THREE.SphereGeometry(1.74, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide }));
        // スリットの縁のレール（スリットは -X 向き）
        const railMat = std(0x8f959c, { roughness: 0.35, metalness: 0.8 });
        for (const s of [1, -1]) {
            const rail = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.04, 10, 64, Math.PI / 2), railMat);
            rail.rotation.y = Math.PI + s * gap / 2;
            cap.add(rail);
        }
        // 屈折望遠鏡と赤道儀
        const scope = new THREE.Group();
        scope.position.y = 0.3;
        scope.rotation.z = (90 - 48) * DEG;
        const tubeMat = std(0xdcdcdc, { roughness: 0.32, metalness: 0.25 });
        const blackMat = std(0x17191d, { roughness: 0.45, metalness: 0.5 });
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.0, 48), tubeMat);
        tube.position.y = 0.6;
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.55, 48), tubeMat);
        hood.position.y = 1.75;
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.23, 48), std(0x2a5cff, { emissive: 0x4aa0ff, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.8 }));
        lens.rotation.x = -Math.PI / 2;
        lens.position.y = 2.0;
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.018, 8, 48), blackMat);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = 2.02;
        const focuser = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 24), blackMat);
        focuser.position.y = -0.55;
        const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 16), blackMat);
        eyepiece.position.y = -0.85;
        const finder = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 20), tubeMat);
        finder.position.set(0, 0.9, 0.3);
        scope.add(tube, hood, lens, lip, focuser, eyepiece, finder);
        for (const y of [0.25, 0.95]) {
            const band = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.03, 10, 40), blackMat);
            band.rotation.x = Math.PI / 2;
            band.position.y = y;
            scope.add(band);
        }
        const head = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.5, 0.34, 3, 0.06), std(0x6d7783, { roughness: 0.4, metalness: 0.6 }));
        head.position.set(0.3, 0.55, 0);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12), railMat);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(0.8, 0.55, 0);
        const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 28), blackMat);
        weight.rotation.z = Math.PI / 2;
        weight.position.set(1.05, 0.55, 0);
        scope.add(head, shaft, weight);
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.5, 24), std(0x6d7783, { roughness: 0.45, metalness: 0.5 }));
        pier.position.y = -0.55;
        cap.add(shell, inside, scope, pier);
        cap.rotation.y = 2.2;
        dome.add(cap);
        g.add(dome);

        // --- 小石と、まわりに浮く岩片 ---
        for (let i = 0; i < 14; i++) {
            const a = rand(Math.PI * 2), r = rand(3.6, 2.5);
            const s = rock(rand(0.26, 0.1), i * 1.7, rockTints[i % rockTints.length], 6);
            s.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r);
            s.rotation.set(rand(3), rand(3), rand(3));
            g.add(s);
        }
        const chips = [];
        for (let i = 0; i < 9; i++) {
            const s = rock(rand(0.55, 0.18), 20 + i * 2.3, rockTints[(i * 3) % rockTints.length], 12);
            const a = rand(Math.PI * 2), r = rand(7, 4.8);
            s.position.set(Math.cos(a) * r, rand(1, -5), Math.sin(a) * r);
            s.userData = { y: s.position.y, ph: rand(6), sp: rand(0.5, 0.2) };
            chips.push(s);
            g.add(s);
        }
        g.userData.tick = [(t) => {
            cap.rotation.y = 2.2 + Math.sin(t * 0.12) * 0.35;
            for (const s of chips) {
                s.position.y = s.userData.y + Math.sin(t * s.userData.sp + s.userData.ph) * 0.25;
                s.rotation.x = t * s.userData.sp * 0.4;
                s.rotation.y = t * s.userData.sp * 0.3 + s.userData.ph;
            }
        }];
        return g;
    }

    function makeCanSat() {
        const g = new THREE.Group();
        const body = new THREE.Group();
        const R = 0.5, H = 1.9;
        const metal = std(0xc9d2dc, { roughness: 0.28, metalness: 0.95 });
        const brass = std(0xd2a84a, { roughness: 0.28, metalness: 1 });
        const black = std(0x14161a, { roughness: 0.4, metalness: 0.4 });

        // 基板：レジストの緑に配線パターン
        const pcb = procedural(std(0x0c6b3c, { roughness: 0.42, metalness: 0.25 }), {
            color: /* glsl */`
                vec2 q = vOP.xz * 22.0;
                float trace = step(0.86, abs(sin(q.x + sin(q.y * 0.5) * 2.0))) * step(0.3, gNoise(vec3(floor(q * 0.35), 3.0)));
                float pad = step(0.93, gNoise(vec3(floor(q * 0.9), 7.0))) * step(length(fract(q * 0.9) - 0.5), 0.3);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.34, 0.16), trace);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.66, 0.22), pad);`,
        });
        const deckY = [0, 1, 2, 3].map((i) => -H / 2 + (H / 3) * i);
        for (const y of deckY) {
            const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.036, 96), pcb);
            deck.position.y = y;
            const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.012, 8, 96), brass);
            edge.rotation.x = Math.PI / 2;
            edge.position.y = y;
            body.add(deck, edge);
        }
        // 支柱とナット
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            const x = Math.cos(a) * R * 0.86, z = Math.sin(a) * R * 0.86;
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, H + 0.1, 20), metal);
            pillar.position.set(x, 0, z);
            body.add(pillar);
            for (const y of deckY) {
                const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 6), metal);
                nut.position.set(x, y + 0.035, z);
                body.add(nut);
            }
        }
        // 基板上の部品
        const partGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
        const parts = [
            [0.16, 0.05, 0.16, 0.12, 1, 0.15, 0x14161a], [0.24, 0.04, 0.1, -0.18, 1, -0.12, 0x14161a], [0.1, 0.07, 0.2, -0.2, 1, 0.18, 0xe9e4d4],
            [0.3, 0.05, 0.2, 0.05, 2, -0.1, 0x14161a], [0.12, 0.09, 0.12, 0.24, 2, 0.14, 0xb9bec6], [0.08, 0.05, 0.22, -0.26, 2, 0.02, 0xe9e4d4],
            [0.2, 0.05, 0.2, -0.1, 3, 0.12, 0x14161a], [0.16, 0.06, 0.08, 0.2, 3, -0.16, 0x1b2a6b],
        ];
        for (const [w, h, d, x, deck, z, c] of parts) {
            const part = new THREE.Mesh(partGeo, std(c, { roughness: 0.45, metalness: c === 0xb9bec6 ? 0.9 : 0.2 }));
            part.scale.set(w, h, d);
            part.position.set(x, deckY[deck] + 0.018 + h / 2, z);
            body.add(part);
        }
        // リアクションホイール（3軸）：モータ＋フライホイール
        const wheels = [];
        [[0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0]].forEach((rot, i) => {
            const holder = new THREE.Group();
            holder.rotation.set(...rot);
            holder.position.set([0, 0.2, -0.05][i], [-0.62, 0, 0.02][i], [0, -0.05, 0.2][i]);
            const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 28), metal);
            motor.position.y = -0.1;
            const w = new THREE.Group();
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 14, 56), brass);
            rim.rotation.x = Math.PI / 2;
            const web = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 40), brass);
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 20), metal);
            w.add(rim, web, hub);
            for (let k = 0; k < 3; k++) {
                const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.024, 20), black);
                hole.position.set(Math.cos(k * 2.094) * 0.095, 0, Math.sin(k * 2.094) * 0.095);
                w.add(hole);
            }
            holder.add(motor, w);
            body.add(holder);
            wheels.push(w);
        });
        // キャパシタ、LED、アンテナ、配線
        const cap1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 32), std(0x1b2a6b, { roughness: 0.35, metalness: 0.4 }));
        cap1.position.set(-0.14, deckY[2] + 0.23, -0.14);
        const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 32), metal);
        capTop.position.set(-0.14, deckY[2] + 0.445, -0.14);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 0.8) }));
        led.position.set(0.25, deckY[3] + 0.05, 0.12);
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 8), metal);
        antenna.position.set(0.3, H / 2 + 0.35, 0);
        const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), metal);
        antTip.position.set(0.3, H / 2 + 0.7, 0);
        body.add(cap1, capTop, led, antenna, antTip);
        [[0xd23b2e, 0.32, 0.1], [0x1b1b1b, 0.3, -0.06], [0xe6c229, -0.34, 0.08]].forEach(([c, x, z], i) => {
            const curve = new THREE.CatmullRomCurve3([
                V(x * 0.7, deckY[0] + 0.03, z), V(x * 1.15, deckY[1] - 0.1, z * 1.6), V(x * 1.1, deckY[2] + 0.1, z * 0.4 + 0.1 * i), V(x * 0.6, deckY[3] - 0.02, z),
            ]);
            body.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.012, 8), std(c, { roughness: 0.6 })));
        });
        // 太陽電池パネル：セルの格子
        const cell = procedural(std(0x16308a, { roughness: 0.24, metalness: 0.75, envMapIntensity: 3 }), {
            color: /* glsl */`
                vec2 cq = vec2(vOP.z * 9.0, vOP.y * 5.2);
                float grid = smoothstep(0.03, 0.08, 1.0 - abs(fract(cq.x) - 0.5) * 2.0) * smoothstep(0.03, 0.08, 1.0 - abs(fract(cq.y) - 0.5) * 2.0);
                float finger = 0.9 + 0.1 * step(0.5, fract(vOP.y * 60.0));
                diffuseColor.rgb = mix(vec3(0.7, 0.72, 0.76), diffuseColor.rgb * finger, grid);`,
        });
        for (const a of [0, Math.PI]) {
            const panel = new THREE.Mesh(new RoundedBoxGeometry(0.02, H * 0.9, 0.4, 2, 0.008), cell);
            panel.position.set(Math.cos(a) * (R + 0.02), 0, Math.sin(a) * (R + 0.02));
            panel.rotation.y = -a;
            body.add(panel);
        }
        g.add(body);

        // パラシュート：12枚のゴアがふくらむ
        const TH = Math.PI * 0.42, CR = 1.5;
        const chuteGeo = new THREE.SphereGeometry(CR, 144, 40, 0, Math.PI * 2, 0.07, TH - 0.07);
        const cp = chuteGeo.attributes.position;
        for (let i = 0; i < cp.count; i++) {
            const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
            const ph = Math.atan2(z, x);
            const th = Math.acos(Math.min(1, y / CR));
            const k = 1 + 0.07 * Math.pow(Math.abs(Math.sin(ph * 6)), 0.7) * Math.sin(th / TH * Math.PI * 0.5);
            cp.setXYZ(i, x * k, y * (1 + (k - 1) * 0.5), z * k);
        }
        chuteGeo.computeVertexNormals();
        const chute = new THREE.Mesh(chuteGeo, procedural(std(0xffffff, { side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }), {
            color: /* glsl */`
                float ga = atan(vOP.z, vOP.x) / 6.2831853;
                float gore = step(0.5, fract(ga * 6.0));
                vec3 cloth = mix(vec3(0.9, 0.88, 0.82), vec3(1.0, 0.2, 0.03), gore);
                float seam = smoothstep(0.0, 0.025, abs(fract(ga * 12.0 + 0.5) - 0.5));
                float weave = 0.93 + 0.07 * sin(vOP.y * 260.0) * sin(ga * 1800.0);
                diffuseColor.rgb = cloth * (0.7 + 0.3 * seam) * weave;`,
        }));
        chute.position.y = 2.6;
        g.add(chute);
        const rimY = 2.6 + CR * Math.cos(TH), rimR = CR * Math.sin(TH);
        const pts = [];
        for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2;
            pts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, 0, H / 2 + 0.05, 0);
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })));

        g.userData.tick = [(t, dt) => {
            g.rotation.z = Math.sin(t * 0.6) * 0.16;
            g.rotation.x = Math.cos(t * 0.47) * 0.1;
            body.rotation.y = Math.sin(t * 0.35) * 1.4 + t * 0.12;
            wheels[0].rotation.y += dt * 14;
            wheels[1].rotation.y -= dt * (6 + Math.sin(t) * 9);
            wheels[2].rotation.y += dt * (8 + Math.cos(t * 0.7) * 8);
            led.visible = (t * 2) % 1 < 0.5;
        }];
        return g;
    }

    function makeCRT() {
        const g = new THREE.Group();
        // 少し日焼けしたプラスチック
        const plastic = (c) => procedural(std(c, { roughness: 0.6, metalness: 0 }), {
            color: 'diffuseColor.rgb *= 0.93 + 0.1 * gFbm(vOP * 2.5, 4);',
        });
        const beige = plastic(0xd9d1b9);
        const dark = std(0x23262b, { roughness: 0.5 });

        // 画面：あのスクリーンセーバー
        const CW = 640, CH = 480;
        const cv = document.createElement('canvas');
        cv.width = CW; cv.height = CH;
        const ctx = cv.getContext('2d');
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const lines = document.createElement('canvas');
        lines.width = 4; lines.height = 4;
        const lg = lines.getContext('2d');
        lg.fillStyle = 'rgba(0,0,0,.22)';
        lg.fillRect(0, 2, 4, 2);
        const scan = ctx.createPattern(lines, 'repeat');
        const draw = (t) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, CW, CH);
            const x = CW / 2 + Math.sin(t * 0.43) * 120, y = CH / 2 + Math.sin(t * 0.61 + 1) * 130;
            const turn = Math.cos(t * 1.1), side = Math.sin(t * 1.1);
            ctx.font = '900 76px "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const hue = (t * 40) % 360;
            for (let i = 18; i >= 0; i--) {
                ctx.setTransform(turn, 0, 0.12 * side, 1, x + i * 0.8 * side, y + i * 0.45);
                ctx.fillStyle = i ? `hsl(${hue} 80% ${12 + (18 - i) * 1.6}%)` : `hsl(${hue} 90% 68%)`;
                ctx.fillText('マルチな部活', 0, 0);
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = scan;
            ctx.fillRect(0, 0, CW, CH);
            tex.needsUpdate = true;
        };
        draw(0);

        const monitor = new THREE.Group();
        const front = new THREE.Mesh(new RoundedBoxGeometry(2.5, 2.1, 0.9, 6, 0.14), beige);
        front.position.z = 0.35;
        const back = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.7, 1.5, 6, 0.3), beige);
        back.position.z = -0.75;
        const bezel = new THREE.Mesh(new RoundedBoxGeometry(2.16, 1.7, 0.08, 4, 0.06), dark);
        bezel.position.set(0, 0.08, 0.78);
        // ブラウン管らしく、わずかにふくらんだ画面
        const screenGeo = new THREE.PlaneGeometry(2.0, 1.5, 32, 24);
        const sp = screenGeo.attributes.position;
        for (let i = 0; i < sp.count; i++) {
            const x = sp.getX(i), y = sp.getY(i);
            sp.setZ(i, 0.05 * (1 - 0.5 * (x * x + (y / 0.75) * (y / 0.75))));
        }
        screenGeo.computeVertexNormals();
        const screen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) }));
        screen.position.set(0, 0.08, 0.83);
        const power = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 3, 0.6) }));
        power.position.set(0.95, -0.9, 0.81);
        monitor.add(front, back, bezel, screen, power);
        for (let i = 0; i < 4; i++) {
            const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16), plastic(0xbdb59c));
            knob.rotation.x = Math.PI / 2;
            knob.position.set(0.3 + i * 0.14, -0.9, 0.81);
            monitor.add(knob);
        }
        // 上面の放熱スリット
        const vents = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.02, 0.05), dark, 9);
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < 9; i++) vents.setMatrixAt(i, m4.makeTranslation(0, 0.855, -0.3 - i * 0.12));
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.78, 0.3, 64), beige);
        neck.position.y = -1.2;
        monitor.add(vents, neck);
        monitor.position.y = 1.0;

        const pc = new THREE.Mesh(new RoundedBoxGeometry(2.9, 0.62, 2.6, 6, 0.06), beige);
        pc.position.y = -0.66;
        const floppy = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.06, 0.03, 2, 0.012), dark);
        floppy.position.set(0.8, -0.58, 1.3);
        const eject = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.05, 0.04, 2, 0.01), plastic(0xbdb59c));
        eject.position.set(1.1, -0.7, 1.3);
        const cd = new THREE.Mesh(new RoundedBoxGeometry(0.98, 0.14, 0.03, 2, 0.012), plastic(0xc8c0a8));
        cd.position.set(-0.75, -0.55, 1.3);
        const pcLed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.4, 0.2) }));
        pcLed.position.set(0.1, -0.56, 1.31);
        const pcBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 24), plastic(0xbdb59c));
        pcBtn.rotation.x = Math.PI / 2;
        pcBtn.position.set(0.1, -0.74, 1.31);

        // キーボード（キーは1個ずつ）とマウス
        const kb = new THREE.Group();
        kb.add(new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.12, 0.95, 4, 0.04), beige));
        const cols = 17, rows = 5;
        const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(0.125, 0.06, 0.125, 2, 0.02), plastic(0xf0ead6), cols * rows);
        let n = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                keys.setMatrixAt(n++, m4.makeTranslation(-1.16 + c * 0.145 + (r % 2) * 0.03, 0.085, -0.3 + r * 0.15));
            }
        }
        kb.add(keys);
        kb.position.set(0, -0.92, 2.2);
        kb.rotation.x = 0.12;
        const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 20), beige);
        mouse.scale.set(0.8, 0.45, 1.25);
        mouse.position.set(1.85, -0.9, 2.2);
        const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
            V(1.85, -0.9, 1.97), V(1.9, -0.93, 1.6), V(1.65, -0.95, 1.35), V(1.45, -0.8, 1.25),
        ]), 40, 0.015, 8), plastic(0xc8c0a8));
        g.add(monitor, pc, floppy, eject, cd, pcLed, pcBtn, kb, mouse, cable);
        g.scale.setScalar(0.92);

        g.userData.tick = [(t) => {
            g.rotation.y = Math.sin(t * 0.25) * 0.3;
            g.rotation.x = Math.sin(t * 0.33) * 0.06;
            g.position.y = STATIONS.crt.y + Math.sin(t * 0.55) * 0.15;
            draw(t);
        }];
        return g;
    }

    function makePrism() {
        const g = new THREE.Group();
        const geo = new THREE.CylinderGeometry(1.4, 1.4, 1.5, 3);
        const glass = std(0xbfe2ff, { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.3, envMapIntensity: 4, side: THREE.DoubleSide, flatShading: true });
        const body = new THREE.Mesh(geo, glass);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2), transparent: true, opacity: 0.8 }));
        const solid = new THREE.Group();
        solid.add(body, edges);
        solid.rotation.set(Math.PI / 2, Math.PI, 0);
        g.add(solid);

        const SPECTRUM = /* glsl */`
            vec3 spectrum(float t){
                vec3 c = mix(vec3(0.45, 0.1, 1.0), vec3(0.1, 0.35, 1.0), smoothstep(0.0, 0.2, t));
                c = mix(c, vec3(0.0, 0.85, 1.0), smoothstep(0.2, 0.38, t));
                c = mix(c, vec3(0.1, 0.95, 0.4), smoothstep(0.38, 0.52, t));
                c = mix(c, vec3(1.0, 0.95, 0.2), smoothstep(0.52, 0.68, t));
                c = mix(c, vec3(1.0, 0.55, 0.1), smoothstep(0.68, 0.84, t));
                return mix(c, vec3(1.0, 0.12, 0.1), smoothstep(0.84, 1.0, t));
            }`;
        // 入射光（白）
        const inGeo = new THREE.PlaneGeometry(7, 0.09);
        const beam = new THREE.Mesh(inGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.set(-3.9, -0.22, 0);
        beam.rotation.z = 0.12;
        g.add(beam);
        // 分散光（吸収線つき）
        const fan = new THREE.BufferGeometry();
        fan.setAttribute('position', new THREE.Float32BufferAttribute([0.35, 0.12, 0, 0.35, 0.0, 0, 8, -0.4, 0, 8, -3.6, 0], 3));
        fan.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 0], 2));
        fan.setIndex([0, 1, 2, 2, 1, 3]);
        const fanMat = new THREE.ShaderMaterial({
            uniforms: { uTime },
            vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: /* glsl */`
                varying vec2 vUv; uniform float uTime;
                ${SPECTRUM}
                void main(){
                    float t = vUv.y;
                    float absorb = 1.0;
                    absorb *= smoothstep(0.0, 0.012, abs(t - 0.165));
                    absorb *= smoothstep(0.0, 0.009, abs(t - 0.385));
                    absorb *= smoothstep(0.0, 0.014, abs(t - 0.522));
                    absorb *= smoothstep(0.0, 0.010, abs(t - 0.718));
                    absorb *= smoothstep(0.0, 0.008, abs(t - 0.88));
                    float a = pow(clamp(1.0 - vUv.x, 0.0, 1.0), 1.3) * smoothstep(0.0, 0.03, vUv.x) * (0.9 + 0.1 * sin(uTime * 3.0 + vUv.x * 30.0));
                    gl_FragColor = vec4(spectrum(1.0 - t) * absorb * a * 2.4, a);
                }`,
            blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        });
        g.add(new THREE.Mesh(fan, fanMat));
        g.scale.setScalar(1.15);
        g.userData.tick = [(t) => {
            g.rotation.y = Math.sin(t * 0.3) * 0.25;
            g.rotation.x = Math.sin(t * 0.22) * 0.1;
        }];
        return g;
    }

    function makeProjector() {
        const g = new THREE.Group();
        const head = new THREE.Group();
        const geo = new THREE.DodecahedronGeometry(1.5);
        head.add(
            new THREE.Mesh(geo, std(0x15171d, { roughness: 0.35, metalness: 0.7, flatShading: true })),
            new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.6) })),
        );
        // ピンホールから出る光と、その先に映る星
        const N = 190, R = 13;
        const ray = [], rayCol = [], dots = [], dotCol = [];
        const d = V();
        for (let i = 0; i < N; i++) {
            const u = rand(1, -0.35), ph = rand(Math.PI * 2), s = Math.sqrt(1 - u * u);
            d.set(s * Math.cos(ph), u, s * Math.sin(ph));
            const b = Math.pow(Math.random(), 3);
            ray.push(d.x * 1.35, d.y * 1.35, d.z * 1.35, d.x * R, d.y * R, d.z * R);
            const i0 = 0.2 + b * 0.5;
            rayCol.push(i0, i0 * 0.92, i0 * 0.7, 0, 0, 0);
            dots.push(d.x * R, d.y * R, d.z * R);
            const I = 0.7 + b * 2.6;
            dotCol.push(I, I * 0.95, I * 0.8);
        }
        const rayGeo = new THREE.BufferGeometry();
        rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(ray, 3));
        rayGeo.setAttribute('color', new THREE.Float32BufferAttribute(rayCol, 3));
        head.add(new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.22 })));
        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
        dotGeo.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3));
        head.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 0.22, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
        const bulb = sprite(glowTex, new THREE.Color(3, 2.6, 1.8), 2.2, 0.9);
        head.add(bulb);
        head.rotation.z = 0.4;

        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 16), std(0x101216, { roughness: 0.4, metalness: 0.7 }));
        stand.position.y = -2.2;
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.18, 24), std(0x101216, { roughness: 0.4, metalness: 0.7 }));
        foot.position.y = -3.3;
        g.add(head, stand, foot);
        g.userData.tick = [(t) => { head.rotation.y = t * 0.08; }];
        return g;
    }
}
