// 背景の3D宇宙。
// ページ内の [data-shot="ショット名"] が画面中央に来ると、カメラがそのショットへ飛びます。
// 置いてあるもの：地球 / 地層と鉱物の浮島＋天体ドーム / 缶サット / Windows 98機 / プリズム / 十二面体投影機 / M45
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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

    const coarse = matchMedia('(pointer: coarse)').matches;
    let dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.7, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // 時間で動くものはここに登録する
    const tickers = [];
    const uTime = { value: 0 };

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

    function resize() {
        const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
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
    resize();
    addEventListener('resize', resize);
    addEventListener('load', measure);
    new ResizeObserver(measure).observe(document.body);
    addEventListener('pointermove', (e) => {
        pointer.x = e.clientX / innerWidth * 2 - 1;
        pointer.y = e.clientY / innerHeight * 2 - 1;
    }, { passive: true });

    // ---------- ループ ----------
    const clock = new THREE.Clock();
    const tmpR = V(), tmpU = V(), tmpF = V();
    let slowFrames = 0, frames = 0, degraded = false;

    function loop() {
        requestAnimationFrame(loop);
        const dt = Math.min(clock.getDelta(), 0.05);
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

        if (frames === 0) canvas.classList.add('is-ready');
        // 重い端末では解像度とブルームを落とす
        if (!degraded && ++frames > 40 && frames < 220) {
            if (dt > 0.034) slowFrames++;
            if (slowFrames > 60) {
                degraded = true;
                dpr = 1;
                bloom.enabled = false;
                resize();
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

    function makeEarth() {
        const group = new THREE.Group();
        const NOISE = /* glsl */`
            float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            float noise(vec3 x){
                vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
                return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
            }
            float fbm(vec3 p){
                float a = 0.5, s = 0.0;
                for (int i = 0; i < 6; i++){ s += a * noise(p); p = p * 2.03 + 17.7; a *= 0.5; }
                return s;
            }`;
        const surface = new THREE.ShaderMaterial({
            uniforms: { uSun: { value: SUN }, uTime },
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
                uniform vec3 uSun; uniform float uTime;
                varying vec3 vObj; varying vec3 vN; varying vec3 vW;
                ${NOISE}
                void main(){
                    vec3 p = normalize(vObj);
                    vec3 warp = vec3(noise(p * 2.3 + 11.0), noise(p * 2.3 + 47.0), noise(p * 2.3 + 83.0)) - 0.5;
                    float h = fbm(p * 1.75 + warp * 0.9);
                    float land = smoothstep(0.545, 0.565, h);
                    float lat = abs(p.y);
                    float elev = clamp((h - 0.55) / 0.2, 0.0, 1.0);

                    vec3 ocean = mix(vec3(0.003, 0.016, 0.06), vec3(0.008, 0.075, 0.14), smoothstep(0.38, 0.55, h));
                    float arid = smoothstep(0.34, 0.06, abs(lat - 0.33)) * smoothstep(0.35, 0.65, noise(p * 3.1 + 5.0));
                    vec3 veg = mix(vec3(0.02, 0.085, 0.02), vec3(0.085, 0.13, 0.035), noise(p * 9.0));
                    vec3 ground = mix(veg, vec3(0.32, 0.23, 0.11), arid);
                    ground = mix(ground, vec3(0.17, 0.14, 0.11), smoothstep(0.35, 0.7, elev));
                    ground = mix(ground, vec3(0.85), smoothstep(0.78, 0.98, elev));
                    float ice = smoothstep(0.82, 0.9, lat + (h - 0.5) * 0.3);
                    vec3 albedo = mix(mix(ocean, ground, land), vec3(0.82, 0.88, 0.95), ice);

                    float ca = uTime * 0.006;
                    vec3 cp = vec3(p.x * cos(ca) - p.z * sin(ca), p.y, p.x * sin(ca) + p.z * cos(ca));
                    float c = fbm(cp * 3.6 + warp * 1.3 + vec3(0.0, uTime * 0.003, 0.0));
                    float cloud = smoothstep(0.5, 0.74, c) * 0.94;

                    vec3 N = normalize(vN), L = normalize(uSun), Vd = normalize(cameraPosition - vW);
                    float ndl = dot(N, L);
                    float day = smoothstep(-0.12, 0.25, ndl);
                    float diff = max(ndl, 0.0);

                    vec3 col = albedo * diff * 1.7;
                    float spec = pow(max(dot(N, normalize(L + Vd)), 0.0), 140.0);
                    col += vec3(1.0, 0.94, 0.82) * spec * (1.0 - land) * (1.0 - cloud) * 0.9;
                    col = mix(col, vec3(1.0, 0.99, 0.97) * (diff * 1.02 + 0.015), cloud);

                    // 夜側の街あかり
                    float city = smoothstep(0.4, 0.68, noise(p * 110.0) * noise(p * 34.0 + 3.0)) * smoothstep(0.3, 0.6, noise(p * 7.0 + 9.0));
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
        const globe = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 160, 120), surface);
        globe.rotation.z = 23.4 * DEG;
        group.add(globe);

        const air = new THREE.Mesh(
            new THREE.SphereGeometry(EARTH_R * 1.12, 96, 64),
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

    function crystal(h, r, color) {
        const mat = std(color, { roughness: 0.2, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.86, emissive: color, emissiveIntensity: 0.35, envMapIntensity: 3 });
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, h, 6), mat);
        body.position.y = h / 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.5, 6), mat);
        tip.position.y = h + r * 0.75;
        g.add(body, tip);
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
        return g;
    }

    function makeIsland() {
        const g = new THREE.Group();

        // 地層の見える岩塊
        const H = 6;
        const geo = new THREE.CylinderGeometry(1, 1, H, 40, 22, false).toNonIndexed();
        const p = geo.attributes.position;
        const bands = [0x5d4233, 0x8a6a4f, 0xc2a57a, 0x4b5560, 0xa5613f, 0xd9caa8, 0x39414c, 0x7d6f8a, 0x9a8468, 0x2f3238];
        const colors = new Float32Array(p.count * 3);
        const c = new THREE.Color();
        const wob = (a, y) => Math.sin(a * 3 + y * 2.1) * 0.5 + Math.sin(a * 7 - y * 3.7) * 0.25 + Math.sin(a * 13 + y * 5.3) * 0.125;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
            const rr = Math.hypot(x, z);
            const a = Math.atan2(z, x);
            const t = (y + H / 2) / H;
            const profile = (0.1 + 0.9 * Math.pow(t, 0.62)) * 4.1 * (1 + wob(a, y) * 0.13);
            const s = rr > 0.001 ? profile : 0;
            p.setXYZ(i, x * s, y + (rr > 0.001 ? 0 : (t < 0.5 ? -0.6 : 0)), z * s);
        }
        // 面ごとに地層の色を決める（わずかに傾いた層）
        for (let i = 0; i < p.count; i += 3) {
            const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
            const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
            const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
            const layer = Math.floor((cy + cx * 0.09 - cz * 0.05 + 3.2 + Math.sin(cx * 1.3) * 0.12) * 1.9);
            c.set(bands[((layer % bands.length) + bands.length) % bands.length]);
            c.offsetHSL(0, 0, rand(0.03, -0.03));
            for (let j = 0; j < 3; j++) colors.set([c.r, c.g, c.b], (i + j) * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const rock = new THREE.Mesh(geo, std(0xffffff, { vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 }));
        rock.position.y = -H / 2;
        g.add(rock);

        const turf = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.15, 0.3, 40), std(0x2c4a3a, { roughness: 1, flatShading: true }));
        turf.position.y = 0.1;
        g.add(turf);

        // 鉱物
        const under = crystalCluster(9, 1.5);
        under.position.set(1.6, -2.3, 2.2);
        under.rotation.set(1.9, 0, -0.5);
        const side = crystalCluster(6, 1.0);
        side.position.set(-2.6, -1.2, 1.9);
        side.rotation.set(1.3, 0, 1.0);
        const top = crystalCluster(5, 0.7);
        top.position.set(-2.4, 0.2, 1.7);
        g.add(under, side, top);

        // 天体ドーム
        const dome = new THREE.Group();
        dome.position.set(0.5, 0.25, -0.3);
        const white = std(0xcfcdc6, { roughness: 0.5, metalness: 0.1 });
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.8, 1.4, 48), white);
        wall.position.y = 0.7;
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 1.86, 0.14, 48), std(0xe2b23a, { roughness: 0.5 }));
        ring.position.y = 1.42;
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.06), std(0x3a4a5c, { roughness: 0.4, metalness: 0.5 }));
        door.position.set(0, 0.5, 1.78);
        dome.add(wall, ring, door);

        const cap = new THREE.Group();
        cap.position.y = 1.48;
        const gap = 0.52;
        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(1.8, 48, 24, gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2),
            std(0xd6d6d4, { roughness: 0.38, metalness: 0.3, side: THREE.DoubleSide }),
        );
        const inside = new THREE.Mesh(new THREE.SphereGeometry(1.74, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x05070c, side: THREE.BackSide }));
        // 屈折望遠鏡（スリットは -X 向き）
        const scope = new THREE.Group();
        scope.position.y = 0.35;
        scope.rotation.z = (90 - 48) * DEG;
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.0, 24), std(0xd8d8d8, { roughness: 0.35, metalness: 0.2 }));
        tube.position.y = 0.6;
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.55, 24), std(0xd8d8d8, { roughness: 0.35, metalness: 0.2 }));
        hood.position.y = 1.75;
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.23, 24), std(0x2a5cff, { emissive: 0x4aa0ff, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.8 }));
        lens.rotation.x = -Math.PI / 2;
        lens.position.y = 2.0;
        const finder = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 12), std(0xfafafa, { roughness: 0.3 }));
        finder.position.set(0, 0.9, 0.3);
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), std(0x6d7783, { roughness: 0.4, metalness: 0.6 }));
        mount.position.y = 0.3;
        scope.add(tube, hood, lens, finder, mount);
        cap.add(shell, inside, scope);
        cap.rotation.y = 2.2;
        dome.add(cap);
        g.add(dome);

        // まわりの小石
        for (let i = 0; i < 14; i++) {
            const a = rand(Math.PI * 2), r = rand(3.6, 2.4);
            const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.28, 0.1)), std(bands[i % bands.length], { flatShading: true, roughness: 0.95 }));
            s.position.set(Math.cos(a) * r, 0.3, Math.sin(a) * r);
            s.rotation.set(rand(3), rand(3), rand(3));
            g.add(s);
        }
        // 浮いている岩片
        const chips = [];
        for (let i = 0; i < 9; i++) {
            const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.5, 0.15)), std(bands[(i * 3) % bands.length], { flatShading: true, roughness: 0.95 }));
            const a = rand(Math.PI * 2), r = rand(7, 4.6);
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
        const pcb = std(0x0c6b3c, { roughness: 0.45, metalness: 0.2 });
        const metal = std(0xc9d2dc, { roughness: 0.25, metalness: 0.95 });
        const brass = std(0xd2a84a, { roughness: 0.25, metalness: 1 });
        for (let i = 0; i < 4; i++) {
            const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.035, 40), pcb);
            deck.position.y = -H / 2 + (H / 3) * i;
            body.add(deck);
        }
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, H, 10), metal);
            pillar.position.set(Math.cos(a) * R * 0.9, 0, Math.sin(a) * R * 0.9);
            body.add(pillar);
        }
        // リアクションホイール（3軸）
        const wheels = [];
        const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.07, 28);
        [[0, 0, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0]].forEach((rot, i) => {
            const holder = new THREE.Group();
            holder.rotation.set(...rot);
            holder.position.set([0, 0.22, -0.05][i], [-0.62, 0, 0.02][i], [0, -0.05, 0.22][i]);
            const w = new THREE.Mesh(wheelGeo, brass);
            const mark = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.075, 0.04), std(0x222831, { metalness: 0.6, roughness: 0.4 }));
            w.add(mark);
            holder.add(w);
            body.add(holder);
            wheels.push(w);
        });
        // キャパシタ、マイコン、アンテナ
        const cap1 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 18), std(0x1b2a6b, { roughness: 0.35, metalness: 0.4 }));
        cap1.position.set(-0.14, 0.62 - 0.33, 0.12);
        const chip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.24), std(0x10131a, { roughness: 0.3, metalness: 0.5 }));
        chip.position.set(0.05, 0.36, -0.1);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 0.8) }));
        led.position.set(0.25, 0.38, 0.12);
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6), metal);
        antenna.position.set(0.3, H / 2 + 0.35, 0);
        body.add(cap1, chip, led, antenna);
        // 太陽電池パネル
        const cell = std(0x16308a, { roughness: 0.24, metalness: 0.75, envMapIntensity: 3 });
        for (const a of [0, Math.PI]) {
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.02, H * 0.9, 0.4), cell);
            panel.position.set(Math.cos(a) * (R + 0.02), 0, Math.sin(a) * (R + 0.02));
            panel.rotation.y = -a;
            body.add(panel);
        }
        g.add(body);

        // パラシュート
        const chuteGeo = new THREE.SphereGeometry(1.5, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed();
        const cp = chuteGeo.attributes.position;
        const cc = new Float32Array(cp.count * 3);
        const A = new THREE.Color(0xff6a1f), B = new THREE.Color(0xf6f3ea);
        for (let i = 0; i < cp.count; i += 3) {
            const a = Math.atan2((cp.getZ(i) + cp.getZ(i + 1) + cp.getZ(i + 2)) / 3, (cp.getX(i) + cp.getX(i + 1) + cp.getX(i + 2)) / 3) + Math.PI;
            const col = Math.floor(a / (Math.PI * 2 / 12) + 0.001) % 2 ? A : B;
            for (let j = 0; j < 3; j++) cc.set([col.r, col.g, col.b], (i + j) * 3);
        }
        chuteGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        chuteGeo.computeVertexNormals();
        const chute = new THREE.Mesh(chuteGeo, std(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, flatShading: true }));
        chute.position.y = 2.6;
        g.add(chute);
        const rimY = 2.6 + 1.5 * Math.cos(Math.PI * 0.42), rimR = 1.5 * Math.sin(Math.PI * 0.42);
        const pts = [];
        for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2;
            pts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, 0, H / 2 + 0.05, 0);
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));

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
        const beige = std(0xd9d1b9, { roughness: 0.62 });
        const dark = std(0x23262b, { roughness: 0.5 });
        // 画面：あのスクリーンセーバー
        const cv = document.createElement('canvas');
        cv.width = 320; cv.height = 240;
        const ctx = cv.getContext('2d');
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const draw = (t) => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, 320, 240);
            const x = 160 + Math.sin(t * 0.43) * 62, y = 120 + Math.sin(t * 0.61 + 1) * 62;
            const turn = Math.cos(t * 1.1);
            ctx.font = '900 38px "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const hue = (t * 40) % 360;
            for (let i = 7; i >= 0; i--) {
                ctx.setTransform(turn, 0, 0.12 * Math.sin(t * 1.1), 1, x + i * 0.9 * Math.sin(t * 1.1), y + i * 0.5);
                ctx.fillStyle = i ? `hsl(${hue} 80% ${14 + (7 - i) * 3}%)` : `hsl(${hue} 90% 68%)`;
                ctx.fillText('マルチな部活', 0, 0);
            }
            tex.needsUpdate = true;
        };
        draw(0);

        const monitor = new THREE.Group();
        const front = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.1, 0.9), beige);
        front.position.z = 0.35;
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 1.4), beige);
        back.position.z = -0.75;
        const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.7, 0.06), dark);
        bezel.position.set(0, 0.08, 0.8);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.35, 1.35, 1.35) }));
        screen.position.set(0, 0.08, 0.84);
        const power = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 3, 0.6) }));
        power.position.set(0.95, -0.9, 0.81);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 0.3, 28), beige);
        neck.position.y = -1.2;
        monitor.add(front, back, bezel, screen, power, neck);
        monitor.position.y = 1.0;

        const pc = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.62, 2.6), beige);
        pc.position.y = -0.66;
        const floppy = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.02), dark);
        floppy.position.set(0.8, -0.58, 1.31);
        const cd = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.02), std(0xbdb59c, { roughness: 0.6 }));
        cd.position.set(-0.75, -0.55, 1.31);
        const kb = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 0.9), beige);
        kb.position.set(0, -0.92, 2.2);
        kb.rotation.x = 0.12;
        const keys = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.7), std(0xf0ead6, { roughness: 0.7 }));
        keys.position.set(0, -0.84, 2.2);
        keys.rotation.x = 0.12;
        g.add(monitor, pc, floppy, cd, kb, keys);
        g.scale.setScalar(0.92);

        let acc = 0;
        g.userData.tick = [(t, dt) => {
            g.rotation.y = Math.sin(t * 0.25) * 0.3;
            g.rotation.x = Math.sin(t * 0.33) * 0.06;
            g.position.y = STATIONS.crt.y + Math.sin(t * 0.55) * 0.15;
            acc += dt;
            if (acc > 1 / 30) { acc = 0; draw(t); }
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
