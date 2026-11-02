/* Vernier→3D · visor y flujo de medición.
   Las medidas llegan como líneas M:/C: (sección 5 de contexto.md) desde el servidor
   (simulador, ESP32 o consola) o se escriben a mano. Este archivo lleva la máquina de
   estados: cota activa de la caja, pasos del agujero o del bloque, validaciones y animaciones.

   La pieza es una lista de cuerpos: el [0] es la caja base y los demás son bloques
   apoyados en una cara de otro cuerpo. Todos son cajas alineadas con los ejes. */
(function(){
'use strict';
var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var $ = function(id){ return document.getElementById(id); };
var MAX_MM = 150;

/* paleta: debe coincidir con estilos.css */
var COL = {bg:0x14161a, sys:0xf1f2f3, live:0xf08a24, ok:0x8fb09b, bad:0xe5484d, steel:0x8c959f, dim:0xb9bec5};

/* ---------- Escena ---------- */
var view = $('view');
var renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(COL.bg, 0);
view.appendChild(renderer.domElement);
var scene = new THREE.Scene();
scene.fog = new THREE.Fog(COL.bg, 420, 950);
var camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
camera.position.set(160, 120, 180);
var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.target.set(0, 10, 0);
controls.minDistance = 40; controls.maxDistance = 700;
controls.autoRotateSpeed = 0.55;

scene.add(new THREE.HemisphereLight(0xf2f4f7, 0x1a1c20, 0.62));
var key = new THREE.DirectionalLight(0xffffff, 0.62); key.position.set(140, 220, 90); scene.add(key);
var fill = new THREE.DirectionalLight(0xdfe4ea, 0.25); fill.position.set(-160, 80, -140); scene.add(fill);

/* cuadrícula de 10 mm por cuadro y ejes */
var grid = new THREE.GridHelper(300, 30, 0x3a4048, 0x272b31);
grid.material.transparent = true; grid.material.opacity = 0.85; scene.add(grid);
(function axes(){
  var o = new THREE.Vector3(-140, 0.05, 140), L = 22;
  [[new THREE.Vector3(1,0,0), 0xc98b8b], [new THREE.Vector3(0,1,0), 0xa9bfa3], [new THREE.Vector3(0,0,-1), 0x8fa3bf]].forEach(function(a){
    var g = new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(a[0], L)]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({color:a[1]})));
  });
})();

/* caja base de 1×1×1 apoyada en el piso; se escala a las medidas */
var unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
var unitC = new THREE.BoxGeometry(1, 1, 1);                       // centrada, para bloques
var edgeGeo = new THREE.EdgesGeometry(unit), edgeGeoC = new THREE.EdgesGeometry(unitC);
var solidMat = new THREE.MeshStandardMaterial({color:COL.steel, metalness:0.25, roughness:0.55, emissive:0x000000});
var wallMat = new THREE.MeshStandardMaterial({color:0x5a6169, metalness:0.15, roughness:0.8, side:THREE.DoubleSide});
var edgeMat = new THREE.LineBasicMaterial({color:COL.sys, transparent:true, opacity:0.9});
var EM0 = new THREE.Color(0x000000), EM1 = new THREE.Color(0x6f7680);
var solid = new THREE.Group();      // caras (con huecos) de todos los cuerpos + paredes de los agujeros
var holeLines = new THREE.Group();  // orillas de los agujeros
var blockEdges = new THREE.Group(); // aristas de los bloques
var edges = new THREE.LineSegments(edgeGeo, edgeMat);              // aristas de la caja base
var ghost = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({color:COL.live, transparent:true, opacity:0.95}));
var ghostFill = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({color:COL.live, transparent:true, opacity:0.08, depthWrite:false, side:THREE.DoubleSide}));
var bGhost = new THREE.LineSegments(edgeGeoC, new THREE.LineBasicMaterial({color:COL.live, transparent:true, opacity:0.95, depthTest:false}));
var bGhostFill = new THREE.Mesh(unitC, new THREE.MeshBasicMaterial({color:COL.live, transparent:true, opacity:0.16, depthWrite:false, side:THREE.DoubleSide}));
bGhost.renderOrder = 4; bGhost.visible = bGhostFill.visible = false;
[solid, holeLines, blockEdges, edges, ghost, ghostFill, bGhost, bGhostFill].forEach(function(o){ scene.add(o); });

function setFade(f){
  // f = 1 sólido opaco; f < 1 durante la aparición
  var tr = f < 0.999;
  [solidMat, wallMat].forEach(function(m){
    if (m.transparent !== tr){ m.transparent = tr; m.needsUpdate = true; }
    m.depthWrite = !tr || f > 0.6; m.opacity = f;
  });
}

/* ---------- Cotas de plano: línea, extensiones y dos puntas ---------- */
var Y_UP = new THREE.Vector3(0,1,0), Z_FWD = new THREE.Vector3(0,0,1);
var CONE = new THREE.ConeGeometry(0.33, 1, 14); CONE.translate(0, -0.5, 0);   // punta en el origen
function Cota(color){
  this.mat = new THREE.LineBasicMaterial({color:color, transparent:true, depthTest:false});
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  this.lines = new THREE.LineSegments(g, this.mat);
  this.coneMat = new THREE.MeshBasicMaterial({color:color, transparent:true, depthTest:false});
  this.c1 = new THREE.Mesh(CONE, this.coneMat); this.c2 = new THREE.Mesh(CONE, this.coneMat);
  this.g = new THREE.Group(); this.g.add(this.lines, this.c1, this.c2); this.g.visible = false;
  [this.lines, this.c1, this.c2].forEach(function(o){ o.renderOrder = 6; o.frustumCulled = false; });
  this.mid = new THREE.Vector3(); this.n = new THREE.Vector3(0, 1, 0);
  scene.add(this.g);
}
Cota.prototype.set = function(a, b, n, off, head){
  var A = a.clone().addScaledVector(n, off), B = b.clone().addScaledVector(n, off);
  var p = this.lines.geometry.attributes.position.array;
  function put(i, v){ p[i] = v.x; p[i+1] = v.y; p[i+2] = v.z; }
  put(0, A); put(3, B);
  var e0 = Math.min(1.2, off*0.25), e1 = Math.min(2.4, off*0.35);
  put(6, a.clone().addScaledVector(n, e0)); put(9, A.clone().addScaledVector(n, e1));
  put(12, b.clone().addScaledVector(n, e0)); put(15, B.clone().addScaledVector(n, e1));
  this.lines.geometry.attributes.position.needsUpdate = true;
  var d = B.clone().sub(A), len = d.length();
  var showHeads = len > head*2.4;
  this.c1.visible = this.c2.visible = showHeads;
  if (showHeads){
    d.divideScalar(len);
    this.c1.position.copy(A); this.c1.quaternion.setFromUnitVectors(Y_UP, d.clone().negate()); this.c1.scale.set(head, head, head);
    this.c2.position.copy(B); this.c2.quaternion.setFromUnitVectors(Y_UP, d); this.c2.scale.set(head, head, head);
  }
  this.mid.copy(A).lerp(B, 0.5); this.n.copy(n);
  this.g.visible = len > 0.01;
};
Cota.prototype.color = function(hex){ this.mat.color.setHex(hex); this.coneMat.color.setHex(hex); };
Cota.prototype.hide = function(){ this.g.visible = false; };

/* ---------- Partículas (solo al crear un sólido), calculadas en la GPU ---------- */
var N = 7000;
var pTarget = new Float32Array(N*3), pStart = new Float32Array(N*3), pBend = new Float32Array(N*3), pInfo = new Float32Array(N*3);
for (var i=0;i<N;i++){ pInfo[i*3] = Math.random()*0.55; pInfo[i*3+1] = Math.random(); pInfo[i*3+2] = 0.6 + Math.random()*0.8; }
var pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pTarget, 3));
pGeo.setAttribute('aStart', new THREE.BufferAttribute(pStart, 3));
pGeo.setAttribute('aBend', new THREE.BufferAttribute(pBend, 3));
pGeo.setAttribute('aInfo', new THREE.BufferAttribute(pInfo, 3));
var pMat = new THREE.ShaderMaterial({
  uniforms:{uProg:{value:0}, uTime:{value:0}, uSize:{value:0.9}, uScale:{value:800}, uJit:{value:0}, uAlpha:{value:0},
            uColA:{value:new THREE.Color(COL.live)}, uColB:{value:new THREE.Color(COL.sys)}},
  vertexShader:[
    'attribute vec3 aStart; attribute vec3 aBend; attribute vec3 aInfo;',
    'uniform float uProg, uTime, uSize, uScale, uJit;',
    'varying float vArr;',
    'float eio(float x){ return x < 0.5 ? 4.0*x*x*x : 1.0 - pow(-2.0*x + 2.0, 3.0)/2.0; }',
    'void main(){',
    '  float p = eio(clamp(uProg*1.55 - aInfo.x, 0.0, 1.0));',
    '  vec3 pos = mix(aStart, position, p) + aBend*sin(3.14159*p);',
    '  float s = aInfo.y*50.0;',
    '  pos += uJit*p*vec3(sin(uTime*3.1 + s), sin(uTime*2.7 + s*1.7), sin(uTime*3.7 + s*2.3));',
    '  vArr = p;',
    '  vec4 mv = modelViewMatrix*vec4(pos, 1.0);',
    '  gl_PointSize = max(1.0, uSize*aInfo.z*uScale/-mv.z);',
    '  gl_Position = projectionMatrix*mv;',
    '}'].join('\n'),
  fragmentShader:[
    'uniform vec3 uColA, uColB; uniform float uAlpha;',
    'varying float vArr;',
    'void main(){',
    '  float d = length(gl_PointCoord - 0.5);',
    '  if (d > 0.5) discard;',
    '  float a = smoothstep(0.5, 0.08, d);',
    '  gl_FragColor = vec4(mix(uColA, uColB, smoothstep(0.55, 1.0, vArr)), a*uAlpha);',
    '}'].join('\n'),
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
});
var points = new THREE.Points(pGeo, pMat); points.visible = false; points.frustumCulled = false; scene.add(points);

/* las partículas nacen sobre las aristas de las cajas y viajan en arco a sus caras */
function seedParticles(boxes){
  var segs = [], faces = [], tot = 0, area = 0, size = 20, eps = 0.12;
  boxes.forEach(function(b){
    var A = [b.min.x, b.min.y, b.min.z], Z = [b.max.x, b.max.y, b.max.z], S = [Z[0]-A[0], Z[1]-A[1], Z[2]-A[2]];
    size = Math.max(size, S[0], S[1], S[2]);
    for (var d=0; d<3; d++){
      var p = (d+1)%3, q = (d+2)%3;
      [A[p], Z[p]].forEach(function(vp){ [A[q], Z[q]].forEach(function(vq){
        var s0 = [], s1 = []; s0[d] = A[d]; s1[d] = Z[d]; s0[p] = s1[p] = vp; s0[q] = s1[q] = vq;
        segs.push({a:s0, b:s1, len:S[d]}); tot += S[d];
      }); });
      [A[d] - eps, Z[d] + eps].forEach(function(val){ faces.push({d:d, p:p, q:q, val:val, A:A, S:S, area:S[p]*S[q]}); area += S[p]*S[q]; });
    }
  });
  for (var i=0;i<N;i++){
    var o = i*3, r = Math.random()*tot, k = 0;
    while (k < segs.length - 1 && r > segs[k].len){ r -= segs[k].len; k++; }
    var s = segs[k], t = Math.random(), sp = 0.5 + Math.random()*3.5;
    for (var c=0; c<3; c++) pStart[o+c] = s.a[c] + (s.b[c]-s.a[c])*t + (Math.random()-0.5)*sp;
    var qa = Math.random()*area, f = 0;
    while (f < faces.length - 1 && qa > faces[f].area){ qa -= faces[f].area; f++; }
    var F = faces[f];
    pTarget[o+F.d] = F.val; pTarget[o+F.p] = F.A[F.p] + Math.random()*F.S[F.p]; pTarget[o+F.q] = F.A[F.q] + Math.random()*F.S[F.q];
    pBend[o] = (Math.random()-0.5)*size*0.55; pBend[o+1] = Math.random()*size*0.45; pBend[o+2] = (Math.random()-0.5)*size*0.55;
  }
  ['position','aStart','aBend'].forEach(function(n){ pGeo.attributes[n].needsUpdate = true; });
}

/* ---------- Estado ---------- */
var AX = ['L','W','H'];
var NAMES = {L:'Largo', W:'Ancho', H:'Alto'};
var cap = {L:50, W:30, H:20};       // medidas capturadas de la caja base
var live = {L:null, W:null, H:null};
var active = null;                  // cota de la caja que se está midiendo
var mode = 'done';                  // measuring | recon | done
var recon = null, busy = false;
var dims = {L:50, W:30, H:20};      // medidas de la caja base en pantalla
var sm = {L:0, W:0, H:0};           // medidas suavizadas para dibujar
var camGoal = {pos:new THREE.Vector3(160,120,180), tgt:new THREE.Vector3(0,10,0), on:false};
var framed = 0;                     // tamaño encuadrado durante la medición
var source = 'simulador';           // simulador | manual | serial
var current = null;                 // registro que se guarda en mediciones.json
var prev = null;                    // pieza anterior, para "Cancelar medición"
var simGoal = null;
var lastInput = performance.now();

/* ---------- Cuerpos ---------- */
var bodies = [], nextBlockId = 1, nextSeq = 2;   // el sketch 1 es el rectángulo de la base
function B(id){ for (var i=0; i<bodies.length; i++) if (bodies[i].id === id) return bodies[i]; return null; }
function blocks(){ return bodies.slice(1); }
function bodyName(id){ return id === 0 ? 'base' : 'bloque B' + id; }
function baseBody(L, W, H){
  return {id:0, parent:null, L:L, W:W, H:H, min:new THREE.Vector3(-L/2, 0, -W/2), max:new THREE.Vector3(L/2, H, W/2)};
}
/* coloca un bloque sobre la cara de su cuerpo base: X, Y desde la esquina; L en X, W en Y, H hacia afuera */
function placeBlock(b){
  var fi = faceInfo(b.parent, b.face), xd = fi.U.clone().multiplyScalar(-b.cs[0]), yd = fi.V.clone().multiplyScalar(-b.cs[1]);
  var p0 = cornerPoint(fi, b.cs, 0).addScaledVector(xd, b.X).addScaledVector(yd, b.Y);
  var p1 = p0.clone().addScaledVector(xd, b.L).addScaledVector(yd, b.W).addScaledVector(fi.N, b.H);
  b.min = p0.clone().min(p1); b.max = p0.clone().max(p1);
  return b;
}
function syncBodies(){
  var rest = blocks();
  bodies = [baseBody(dims.L, dims.W, dims.H)];
  rest.forEach(function(b){ bodies.push(b); placeBlock(b); });
}
function attachedFace(b){ return b.parent == null ? null : FACES[b.face].opp; }
function envelope(list){
  var mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  (list || bodies).forEach(function(b){ mn.min(b.min); mx.max(b.max); });
  return {min:mn, max:mx, size:mx.clone().sub(mn)};
}

function setSolidScale(L, W, H){ edges.scale.set(Math.max(L,0.01), Math.max(H,0.01), Math.max(W,0.01)); syncBodies(); rebuildSolid(); }
function setGhost(L, W, H){
  var l = Math.max(L,0.05), w = Math.max(W,0.05), h = Math.max(H,0.05);
  ghost.scale.set(l, h, w); ghostFill.scale.set(l, h, w);
}
function aimAt(center, m, instant){
  framed = m;
  var aspect = (view.clientWidth || 1) / (view.clientHeight || 1);
  var dist = (m*2.3 + 70) * Math.max(1, 1.25/aspect);
  var dir = new THREE.Vector3(0.82, 0.62, 0.95).normalize();
  camGoal.tgt.copy(center);
  camGoal.pos.copy(center).add(dir.multiplyScalar(dist));
  camGoal.on = true;
  if (instant){ camera.position.copy(camGoal.pos); controls.target.copy(camGoal.tgt); camGoal.on = false; }
}
function fit(L, W, H, instant){ aimAt(new THREE.Vector3(0, H/2, 0), Math.max(L, W, H, 20), instant); }
function fitAll(instant){
  var e = envelope();
  aimAt(e.min.clone().add(e.max).multiplyScalar(0.5), Math.max(e.size.x, e.size.y, e.size.z, 20), instant);
}

/* ---------- Interfaz ---------- */
function setState(txt, kind){ $('stateTxt').textContent = txt; $('chipState').className = 'chip ' + (kind || ''); }
function fmt(v){ return v == null ? '--.--' : v.toFixed(2); }
function stepUI(){
  AX.forEach(function(k){
    var el = $('step'+k), v = $('v'+k);
    el.classList.remove('active','done');
    if (cap[k] != null){ el.classList.add('done'); v.textContent = cap[k].toFixed(2); }
    else if (k === active){ el.classList.add('active'); v.textContent = fmt(live[k]); }
    else v.textContent = '--.--';
  });
  var measuring = mode === 'measuring';
  $('btnNew').disabled = busy || !!job || !!build || !!edit;
  $('btnCap').disabled = !measuring || !active || live[active] == null;
  $('btnRedoAx').disabled = busy || !!job || !!build || !!edit || !(measuring || (mode === 'done' && current && current.guiada));
  $('btnStop').disabled = !measuring;
  $('btnReplay').disabled = busy || measuring || !!job || !!build || !!edit;
  $('btnGen').disabled = busy || !!job || !!build || !!edit;
  $('btnNew').textContent = measuring ? '▶ Reiniciar medición' : '▶ Nueva medición';
}
function logLine(txt, cls){
  var d = new Date(); var ts = d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0');
  var div = document.createElement('div'); div.className = cls || ''; div.textContent = ts + '  ' + txt;
  var lg = $('log'); lg.insertBefore(div, lg.firstChild);
  while (lg.children.length > 160) lg.removeChild(lg.lastChild);
}
function phaseUI(n, frac){
  // n: 0 medición, 1 nube, 2 malla, 3 sólido, 4 terminado
  ['ph0','ph1','ph2','ph3'].forEach(function(id, i){
    var el = $(id); el.classList.remove('on','done','live');
    if (i < n) el.classList.add('done'); else if (i === n) el.classList.add(i === 0 ? 'live' : 'on');
  });
  $('phBar').style.transform = 'scaleX(' + (n >= 4 ? 1 : (frac || 0)) + ')';
}
function metrics(f){
  f = f == null ? 1 : f;
  var vol = 0, area = 0, hv = 0, ha = 0;
  bodies.forEach(function(b){
    var s = b.max.clone().sub(b.min);
    vol += s.x*s.y*s.z;
    // la tapa del bloque compensa la huella que tapa en su cara base: solo suman sus paredes
    area += b.parent == null ? 2*(s.x*s.y + s.y*s.z + s.x*s.z) : 2*(b.L + b.W)*b.H;
  });
  holes.forEach(function(h){ var r = h.D/2, d = holeDepth(h); hv += Math.PI*r*r*d; ha += 2*Math.PI*r*d - (h.through ? 2*Math.PI*r*r : 0); });
  var e = envelope().size, V = (vol - hv)/1000, A = (area + ha)/100, diag = e.length(), mass = V*1.24;
  $('mHoles').textContent = holes.length;
  $('mBlocks').textContent = bodies.length - 1;
  $('mDims').textContent = (e.x*f).toFixed(2) + ' × ' + (e.z*f).toFixed(2) + ' × ' + (e.y*f).toFixed(2);
  $('mVol').textContent = (V*f).toFixed(2) + ' cm³';
  $('mArea').textContent = (A*f).toFixed(2) + ' cm²';
  $('mDiag').textContent = (diag*f).toFixed(2) + ' mm';
  $('mMass').textContent = (mass*f).toFixed(1) + ' g';
}
function clearMetrics(){ ['mDims','mVol','mArea','mDiag','mMass'].forEach(function(id){ $(id).textContent = '—'; }); }
var promptTxt = null;
function prompt(txt){
  var p = $('prompt'); if (txt === promptTxt) return; promptTxt = txt;
  $('hint').hidden = !!txt;   // el aviso de controles cede su lugar a la instrucción
  if (txt){ p.textContent = txt; p.hidden = true; void p.offsetWidth; p.hidden = false; } else p.hidden = true;
}

/* tarjeta "Qué se está midiendo" */
var WHAT = {
  'box.L':{n:'Largo · eje X', t:'Mordazas de exteriores', h:'Abraza la pieza a lo largo con las mordazas grandes y presiona Capturar en el vernier.'},
  'box.W':{n:'Ancho · eje Z', t:'Mordazas de exteriores', h:'Gira la pieza y mide de frente a fondo. El largo ya capturado se vuelve un plano.'},
  'box.H':{n:'Alto · eje Y', t:'Mordazas de exteriores', h:'Mide de la base a la cara superior. Con esta cota el plano se extruye a volumen.'},
  'hole.D':{n:'Diámetro del agujero', t:'Mordazas de interiores', h:'Mete las puntas pequeñas en el agujero y ábrelas hasta tocar la pared.'},
  'hole.X':{n:'Distancia X a la pared', t:'Mordazas de exteriores', h:'Una punta en la orilla resaltada y la otra en la pared más cercana del agujero. El programa suma Ø/2 para hallar el centro.'},
  'hole.Y':{n:'Distancia Y a la pared', t:'Mordazas de exteriores', h:'Igual que X, ahora desde la otra orilla resaltada. El centro del agujero está en el aire: por eso se mide a la pared.'},
  'hole.P':{n:'Profundidad', t:'Varilla de profundidad', h:'Apoya el extremo del vernier en la cara y baja la varilla hasta el fondo del agujero.'},
  'block.L':{n:'Largo del bloque · eje X', t:'Mordazas de exteriores', h:'Abraza el bloque en la dirección de la flecha X de la cara.'},
  'block.W':{n:'Ancho del bloque · eje Y', t:'Mordazas de exteriores', h:'Abraza el bloque en la dirección de la flecha Y de la cara.'},
  'block.H':{n:'Alto del bloque', t:'Medición de escalón', h:'Usa el escalón (la parte trasera del vernier): un extremo sobre la cara de la pieza y el otro sobre la tapa del bloque.'},
  'block.X':{n:'Distancia X a la pared del bloque', t:'Medición de escalón', h:'Un extremo en la orilla resaltada de la pieza y el otro en la pared del bloque. Si el bloque está pegado a esa orilla, presiona “X pegado”.'},
  'block.Y':{n:'Distancia Y a la pared del bloque', t:'Medición de escalón', h:'Igual que X, desde la otra orilla resaltada. Si está pegado, presiona “Y pegado”.'}
};
function what(name, tool, how, isLive){
  $('whatName').textContent = name; $('whatTool').textContent = tool || '—'; $('whatHow').textContent = how;
  $('what').classList.toggle('live', !!isLive);
}
function whatKey(id){ var w = WHAT[id]; what(w.n, w.t, w.h, true); }
function whatIdle(){
  what('Pieza lista', 'Lista para medir, perforar o agregar bloques',
       source === 'manual' ? 'Escribe largo, ancho y alto y presiona “Generar”. Toca una cara para agregar un agujero o un bloque.'
                           : 'Presiona “Nueva medición” para medir una caja con el vernier, o toca una cara para agregar un agujero o un bloque.', false);
}

/* ---------- Etiquetas HTML proyectadas sobre la vista ---------- */
var tagHost = $('tags'), vtmp = new THREE.Vector3();
function makeTag(){ var el = document.createElement('div'); el.className = 'tag'; el.style.opacity = 0; tagHost.appendChild(el); return el; }
function placeEl(el, w, extra){
  vtmp.copy(w).project(camera);
  if (vtmp.z > 1){ el.style.opacity = 0; return false; }
  var x = (vtmp.x*0.5 + 0.5)*view.clientWidth, y = (-vtmp.y*0.5 + 0.5)*view.clientHeight;
  el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) ' + (extra || 'translate(-50%,-50%)');
  return true;
}
/* la etiqueta de una cota va junto a su línea, hacia afuera, sin taparla */
var vtmp2 = new THREE.Vector3();
function placeCotaTag(el, c){
  vtmp.copy(c.mid).project(camera);
  if (vtmp.z > 1){ el.style.opacity = 0; return false; }
  var W = view.clientWidth, H = view.clientHeight;
  var x = (vtmp.x*0.5 + 0.5)*W, y = (-vtmp.y*0.5 + 0.5)*H;
  vtmp2.copy(c.mid).add(c.n).project(camera);
  var dx = (vtmp2.x - vtmp.x)*W/2, dy = -(vtmp2.y - vtmp.y)*H/2, len = Math.hypot(dx, dy);
  if (len < 1e-4){ dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  var push = Math.abs(dx)*el.offsetWidth/2 + Math.abs(dy)*el.offsetHeight/2 + 7;
  el.style.transform = 'translate(' + (x + dx*push).toFixed(1) + 'px,' + (y + dy*push).toFixed(1) + 'px) translate(-50%,-50%)';
  return true;
}
var boxCota = {L:new Cota(COL.dim), W:new Cota(COL.dim), H:new Cota(COL.dim)};
var boxTag = {L:makeTag(), W:makeTag(), H:makeTag()};
var tagShow = {L:false, W:false, H:false};
var tagHtml = {L:'', W:'', H:''};

/* cotas de la caja base: X = largo, Y = alto, Z = ancho; la caja va de −L/2 a L/2 */
function updateBoxCotas(L, W, H){
  var m = Math.max(L, W, H, 20), off = 5 + m*0.07, head = Math.min(4.5, Math.max(1.6, m*0.035));
  var showAll = mode === 'done' || mode === 'measuring' || (mode === 'recon' && recon && recon.cotas);
  AX.forEach(function(k){
    var c = boxCota[k], val = cap[k] != null ? cap[k] : live[k];
    var on = showAll && !job && tagShow[k] && (k === 'L' ? L : k === 'W' ? W : H) > 0.05;
    if (!on){ c.hide(); return; }
    if (k === 'L') c.set(new THREE.Vector3(-L/2, 0, W/2), new THREE.Vector3(L/2, 0, W/2), Z_FWD, off, head);
    if (k === 'W') c.set(new THREE.Vector3(L/2, 0, W/2), new THREE.Vector3(L/2, 0, -W/2), new THREE.Vector3(1,0,0), off, head);
    if (k === 'H') c.set(new THREE.Vector3(-L/2, 0, W/2), new THREE.Vector3(-L/2, H, W/2), new THREE.Vector3(-1,0,0), off, head);
    var isLive = mode === 'measuring' && k === active, isCap = mode === 'measuring' && cap[k] != null;
    c.color(isLive ? COL.live : isCap ? COL.ok : COL.dim);
    var html = '<small>' + NAMES[k].toUpperCase() + '</small>' + fmt(val) + ' mm';
    if (html !== tagHtml[k]){ tagHtml[k] = html; boxTag[k].innerHTML = html; }
    boxTag[k].className = 'tag' + (isLive ? ' live' : isCap ? ' cap' : '');
  });
}
function placeTags(){
  AX.forEach(function(k){
    var t = boxTag[k], c = boxCota[k];
    if (!c.g.visible){ t.style.opacity = 0; return; }
    if (placeCotaTag(t, c)) t.style.opacity = 1;
  });
  for (var key in htags){
    var o = htags[key];
    // 'h…' etiquetas del agujero o bloque en curso; 'n…' y 'b…' números de los terminados
    var c0 = key.charAt(0), vis = o.show && (c0 === 'h' ? !!job : c0 === 'e' ? !!edit : (mode === 'done' && !job));
    if (!vis){ o.el.style.opacity = 0; continue; }
    o.el.className = 'tag ' + o.cls;
    if (o.cota ? placeCotaTag(o.el, o.cota) : placeEl(o.el, o.w)) o.el.style.opacity = 1;
  }
  var fm = $('faceMenu');
  if (sel && !job && !fm.hidden){
    vtmp.copy(sel.pt).project(camera);
    var w = view.clientWidth, h = view.clientHeight;
    var x = Math.min(Math.max((vtmp.x*0.5+0.5)*w, 150), w - 150), y = Math.max((-vtmp.y*0.5+0.5)*h, 70);
    fm.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%, calc(-100% - 14px))';
  }
}

/* ---------- Lectura en vivo: número, regla, gráfica y estabilidad ---------- */
var hist = [], packets = 0, pktCount = 0, pktWindow = 0, lastPacket = '—', sparkDirty = false;
var STABLE_MM = 0.03;
function readoutLive(v, label, captured){
  $('liveVal').textContent = v.toFixed(2);
  $('rulerFill').style.transform = 'scaleX(' + Math.min(1, Math.max(0, v/MAX_MM)).toFixed(4) + ')';
  var r = $('readout'); r.classList.toggle('live', !captured && !!label); r.classList.toggle('cap', !!captured);
  $('liveLbl').textContent = label || 'Sin cota activa';
}
function pushHist(v){
  hist.push({t:performance.now(), v:v}); if (hist.length > 70) hist.shift();
  sparkDirty = true;
}
function stability(){
  var el = $('stab'), now = performance.now(), last = hist[hist.length-1];
  if (!last || now - last.t > 1500){ el.className = 'stab'; $('stabTxt').textContent = hist.length ? 'Sin lecturas recientes' : 'Esperando lecturas'; return; }
  var rec = hist.slice(-6), lo = Infinity, hi = -Infinity;
  rec.forEach(function(p){ lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
  var measuringNow = (mode === 'measuring' && active) || (job && job.active);
  if (rec.length >= 5 && hi - lo <= STABLE_MM){
    el.className = 'stab stable'; $('stabTxt').textContent = measuringNow ? 'Estable · listo para capturar' : 'Estable';
  } else {
    var first = hist[Math.max(0, hist.length - 6)], rate = (last.v - first.v)/Math.max(0.05, (last.t - first.t)/1000);
    el.className = 'stab moving'; $('stabTxt').textContent = 'Moviendo · ' + (rate >= 0 ? '+' : '') + rate.toFixed(1) + ' mm/s';
  }
}
var spark = $('spark'), sctx = spark.getContext('2d');
function drawSpark(){
  sparkDirty = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2), w = spark.clientWidth, h = spark.clientHeight;
  if (spark.width !== Math.round(w*dpr)){ spark.width = Math.round(w*dpr); spark.height = Math.round(h*dpr); }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0); sctx.clearRect(0, 0, w, h);
  if (hist.length < 2) return;
  var lo = Infinity, hi = -Infinity;
  hist.forEach(function(p){ lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
  if (hi - lo < 1){ var c = (hi + lo)/2; lo = c - 0.5; hi = c + 0.5; }
  var pad = 4, n = 70;
  var X = function(i){ return pad + (w - 2*pad)*(i + n - hist.length)/(n - 1); };
  var Y = function(v){ return h - pad - (h - 2*pad)*(v - lo)/(hi - lo); };
  sctx.strokeStyle = '#2F343B'; sctx.lineWidth = 1; sctx.beginPath(); sctx.moveTo(0, h - 0.5); sctx.lineTo(w, h - 0.5); sctx.stroke();
  sctx.strokeStyle = '#F08A24'; sctx.lineWidth = 1.5; sctx.lineJoin = 'round'; sctx.beginPath();
  hist.forEach(function(p, i){ if (i) sctx.lineTo(X(i), Y(p.v)); else sctx.moveTo(X(i), Y(p.v)); });
  sctx.stroke();
  var lp = hist[hist.length-1]; sctx.fillStyle = '#F1F2F3'; sctx.beginPath(); sctx.arc(X(hist.length-1), Y(lp.v), 2.5, 0, 7); sctx.fill();
  sctx.fillStyle = '#8B929B'; sctx.font = '10px "JetBrains Mono", Consolas, monospace';
  sctx.fillText(hi.toFixed(2), pad, 10); sctx.fillText(lo.toFixed(2), pad, h - 6);
}

/* ---------- Recorrido del dato: Vernier → ESP32 → USB → Servidor → Visor ---------- */
var wires = Array.prototype.slice.call(document.querySelectorAll('.pipe .wire i'));
var srv = {open:false, estado:null}, lastPulse = 0;
function pipeNode(id, cls, st){ var li = $(id); li.className = cls || ''; if (st != null) $(id.replace('pn','ps')).textContent = st; }
function pipeUI(){
  var ser = srv.estado && srv.estado.serial;
  pipeNode('pnSrv', srv.open ? 'on' : 'off', srv.open ? 'conectado' : 'sin conexión');
  pipeNode('pnView', 'on', 'listo');
  if (source === 'serial'){
    var ok = srv.open && ser && ser.conectado;
    pipeNode('pnVernier', ok ? 'on' : '', ok ? 'real' : '—');
    pipeNode('pnEsp', ok ? 'on' : 'off', ok ? (ser.puerto || 'USB') : 'desconectado');
    pipeNode('pnUsb', ok ? 'on' : 'off', '115200');
  } else if (source === 'simulador'){
    pipeNode('pnVernier', 'sim', 'simulado');
    pipeNode('pnEsp', 'sim', srv.open ? 'simulado' : 'local');
    pipeNode('pnUsb', 'sim', 'simulado');
  } else {
    pipeNode('pnVernier', '', 'a mano'); pipeNode('pnEsp', '', 'no se usa'); pipeNode('pnUsb', '', 'no se usa');
  }
}
function pulse(from){
  var now = performance.now(); if (REDUCED || now - lastPulse < 220) return; lastPulse = now;
  wires.slice(from).forEach(function(w, i){
    var len = w.parentNode.clientWidth;
    w.animate([{transform:'translateX(-3px)', opacity:0}, {opacity:1, offset:0.2}, {transform:'translateX(' + (len - 3) + 'px)', opacity:0}],
              {duration:260, delay:i*110, easing:'linear'});
  });
}

/* ---------- Conexión con el servidor ---------- */
var ws = null, wsTry = 0, pendingSave = null, firstEstado = true;
function send(o){ if (ws && ws.readyState === 1){ ws.send(JSON.stringify(o)); return true; } return false; }
function connect(){
  if (location.protocol !== 'http:' && location.protocol !== 'https:'){ logLine('Página abierta sin servidor: el simulador corre local y no se guarda el JSON.', 'e'); pipeUI(); return; }
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
  catch (e){ retry(); return; }
  ws.onopen = function(){
    wsTry = 0; srv.open = true; firstEstado = true; logLine('Servidor conectado', 's'); pipeUI();
    if (pendingSave){ send({cmd:'guardar', medicion:pendingSave}); pendingSave = null; }
  };
  ws.onclose = function(){
    if (srv.open) logLine('Se perdió el servidor; reintentando…', 'e');
    srv.open = false; srv.estado = null; pipeUI(); serialUI(); retry();
  };
  ws.onmessage = function(ev){ var m; try { m = JSON.parse(ev.data); } catch (e){ return; } onServer(m); };
}
function retry(){ wsTry++; setTimeout(connect, Math.min(5000, 600*wsTry)); }
function onServer(m){
  if (m.tipo === 'lectura') onLectura(m.modo, m.valor, m.crudo, m.fuente);
  else if (m.tipo === 'ignorada'){ packets++; lastPacket = m.crudo; logLine('Ignorado (formato inválido): ' + m.crudo, 'e'); }
  else if (m.tipo === 'estado'){
    var was = srv.estado; srv.estado = m;
    if (firstEstado){ firstEstado = false; if (m.activa === 'serial' && source !== 'serial') setSource('serial', true); else send({cmd:'fuente', nombre:source}); }
    if (m.serial && (!was || !was.serial || was.serial.mensaje !== m.serial.mensaje) && source === 'serial') logLine('ESP32: ' + m.serial.mensaje, m.serial.conectado ? 'c' : 'e');
    pipeUI(); serialUI();
  }
  else if (m.tipo === 'puertos'){
    var s = $('selPort'), cur = s.value;
    s.innerHTML = '<option value="auto">Detectar (CP2102 / CH340)</option>';
    m.puertos.forEach(function(p){ var o = document.createElement('option'); o.value = p.puerto; o.textContent = p.puerto + ' · ' + p.descripcion; s.appendChild(o); });
    s.value = Array.prototype.some.call(s.options, function(o){ return o.value === cur; }) ? cur : 'auto';
    logLine('Puertos encontrados: ' + (m.puertos.length ? m.puertos.map(function(p){ return p.puerto; }).join(', ') : 'ninguno'), 's');
  }
  else if (m.tipo === 'guardado') logLine('Guardado en mediciones.json (' + m.total + ' mediciones)', 'c');
  else if (m.tipo === 'error') logLine(m.mensaje, 'e');
}
function serialUI(){
  var ser = srv.estado && srv.estado.serial;
  $('serialMsg').textContent = !srv.open ? 'El ESP32 necesita el servidor (python servidor.py).' : ser ? ser.mensaje : '—';
}

/* ---------- Simulador: por el servidor, o local si no hay servidor ---------- */
var localSim = null;
function simulate(vals){
  if (send({cmd:'simular', valores:vals})) return;
  stopSim();
  var run = {stop:false}; localSim = run;
  (async function(){
    for (var i=0; i<vals.length && !run.stop; i++){
      var goal = vals[i], dur = 1.6 + Math.min(goal, MAX_MM)/MAX_MM*1.4, steps = Math.max(6, Math.round(dur/0.15)), over = goal + 0.15 + Math.random()*0.45;
      for (var s=1; s<=steps && !run.stop; s++){
        var p = s/steps, e = 1 - Math.pow(1-p, 3);
        var v = p < 0.82 ? over*e : over + (goal - over)*((p - 0.82)/0.18);
        onLectura('M', +(v + (Math.random()-0.5)*0.02).toFixed(2), null, 'local'); await wait(150);
      }
      for (var q=0; q<6 && !run.stop; q++){ onLectura('M', +(goal + [-0.01,0,0,0.01][q%4]).toFixed(2), null, 'local'); await wait(150); }
      if (!run.stop) onLectura('C', goal, null, 'local');
      await wait(600);
    }
  })();
}
function stopSim(){ send({cmd:'detener'}); if (localSim){ localSim.stop = true; localSim = null; } }
function wait(ms){ return new Promise(function(r){ setTimeout(r, REDUCED ? Math.min(ms, 30) : ms); }); }
function rnd(a, b){ return Math.round((a + Math.random()*(b-a))*100)/100; }

/* ---------- Entrada única de lecturas (todas las fuentes) ---------- */
var lastSrc = 'simulador';
function onLectura(modo, v, crudo, fuente){
  var line = crudo || (modo + ':' + v.toFixed(2));
  packets++; lastPacket = line; lastSrc = fuente || lastSrc;
  pulse(fuente === 'consola' ? 3 : 0);
  pushHist(v);
  if (fuente === 'esp32') $('psVernier').textContent = v.toFixed(2);
  if (job && job.active){ jobMessage(modo, v, line); return; }
  if (edit){ editMessage(modo, v, line); return; }
  if (mode !== 'measuring' || !active){
    readoutLive(v, null, false); logLine(line + '   (sin cota activa)', 'm'); return;
  }
  if (modo === 'M'){
    live[active] = v; readoutLive(v, 'Midiendo ' + NAMES[active].toLowerCase(), false);
    logLine(line, 'm');
    if (v < 0 || v > MAX_MM) setState('Lectura fuera de rango', 'bad'); else setState('Midiendo ' + NAMES[active].toLowerCase(), 'live');
  } else {
    if (!(v > 0 && v <= MAX_MM)){ logLine('Rechazado fuera de rango 0–150 mm: ' + line, 'e'); setState('Captura rechazada', 'bad'); return; }
    captureBox(v, line);
  }
  stepUI();
}
function captureBox(v, line){
  var k = active;
  cap[k] = v; live[k] = v; tagShow[k] = true;
  readoutLive(v, NAMES[k] + ' capturado', true);
  logLine(line + '   ✔ ' + NAMES[k] + ' capturado', 'c');
  var el = $('step'+k); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  nextAxis();
}
function nextAxis(){
  active = null;
  for (var i=0; i<AX.length; i++) if (cap[AX[i]] == null){ active = AX[i]; break; }
  if (active){
    live[active] = null; tagShow[active] = true;
    prompt('Mide el ' + NAMES[active].toUpperCase() + ' y presiona Capturar');
    setState('Midiendo ' + NAMES[active].toLowerCase(), 'live'); whatKey('box.' + active);
    logLine('Pide ' + NAMES[active].toLowerCase() + ' (' + (active==='L'?'1D: línea':active==='W'?'2D: plano':'3D: volumen') + ')', 's');
    stepUI();
  } else finishMeasure();
}

/* ---------- Flujo guiado de la caja ---------- */
function snapshot(){
  return {cap:{L:cap.L, W:cap.W, H:cap.H}, holes:holes.slice(), nextId:nextId, current:current,
          blocks:blocks(), nextBlockId:nextBlockId, nextSeq:nextSeq};
}
function clearDetails(){ cancelEdit(true); holes = []; nextId = 1; bodies = bodies.slice(0, 1); nextBlockId = 1; nextSeq = 2; renderDetails(); }
function resetForMeasure(keep){
  cap = {L:null, W:null, H:null}; live = {L:null, W:null, H:null};
  if (keep) AX.forEach(function(k){ if (keep[k] != null){ cap[k] = keep[k]; live[k] = keep[k]; } });
  tagShow = {L:cap.L != null, W:cap.W != null, H:cap.H != null};
  mode = 'measuring'; recon = null; points.visible = false;
  solid.visible = false; edges.visible = false; holeLines.visible = false; blockEdges.visible = false;
  ghost.visible = true; ghostFill.visible = true;
  phaseUI(0, 0); clearMetrics(); deselect();
}
function startMeasure(){
  if (busy || job || build) return;
  stopSim();
  if (mode !== 'measuring') prev = snapshot();
  clearDetails(); current = null; resetForMeasure();
  sm = {L:0, W:0, H:0}; framed = 0;
  logLine('— Nueva medición (' + srcName(source) + ') —', 's');
  nextAxis();
  if (source === 'simulador'){
    simGoal = {L:rnd(40, 95), W:rnd(25, 70), H:rnd(15, 60)};
    simulate([simGoal.L, simGoal.W, simGoal.H]);
  } else if (source === 'serial') logLine('Esperando lecturas del ESP32…', 's');
}
function resumeSim(){
  if (source !== 'simulador' || mode !== 'measuring') return;
  stopSim();
  if (!simGoal) simGoal = {L:rnd(40, 95), W:rnd(25, 70), H:rnd(15, 60)};
  var vals = AX.filter(function(k){ return cap[k] == null; }).map(function(k){ return simGoal[k]; });
  if (vals.length) setTimeout(function(){ simulate(vals); }, 250);
}
function captureNow(){
  if (job && job.active){ var hv = job.live[job.active]; if (hv != null){ stopSim(); jobMessage('C', hv, 'C:' + hv.toFixed(2) + ' (botón)'); } return; }
  if (edit){ if (edit.live != null){ stopSim(); commitEdit(edit.live, 'C:' + edit.live.toFixed(2) + ' (botón)'); } return; }
  if (mode !== 'measuring' || !active || live[active] == null) return;
  var v = live[active];
  if (!(v > 0 && v <= MAX_MM)){ logLine('Rechazado fuera de rango 0–150 mm: ' + v.toFixed(2), 'e'); return; }
  var simBusy = source === 'simulador';
  captureBox(Math.round(v*100)/100, 'C:' + v.toFixed(2) + ' (botón)');
  stepUI();
  if (simBusy) resumeSim();
}
function redoAxis(){
  if (busy || job || build) return;
  if (mode === 'done' && current && current.guiada){
    // vuelve a medir la última cota de una pieza terminada
    prev = snapshot(); clearDetails();
    var keep = {L:cap.L, W:cap.W, H:null};
    resetForMeasure(keep); sm = {L:keep.L, W:keep.W, H:0};
    logLine('Repetir cota: alto', 's'); nextAxis(); resumeSim(); return;
  }
  if (mode !== 'measuring') return;
  if (active && live[active] != null){ live[active] = null; logLine('Repetir cota: ' + NAMES[active].toLowerCase(), 's'); }
  else {
    var idx = active ? AX.indexOf(active) - 1 : AX.length - 1;
    if (idx < 0) return;
    var k = AX[idx]; cap[k] = null; live[k] = null;
    if (active) tagShow[active] = false;
    logLine('Repetir cota: ' + NAMES[k].toLowerCase(), 's');
  }
  nextAxis(); resumeSim();
}
function cancelMeasure(){
  if (mode !== 'measuring') return;
  stopSim(); active = null; prompt(null);
  logLine('Medición cancelada', 's');
  if (prev && prev.cap.L != null){
    cap = prev.cap; holes = prev.holes; nextId = prev.nextId; current = prev.current;
    bodies = [bodies[0]].concat(prev.blocks); nextBlockId = prev.nextBlockId; nextSeq = prev.nextSeq;
    showPiece();
  } else { mode = 'done'; ghost.visible = ghostFill.visible = false; setState('Listo', ''); whatIdle(); stepUI(); }
}
function finishMeasure(){
  active = null; prompt(null); stopSim();
  current = {id:null, fecha:null, figura:'caja', fuente:srcName(lastSrc), guiada:true,
             largo_mm:cap.L, ancho_mm:cap.W, alto_mm:cap.H, cuerpos:[], agujeros:[]};
  reconstruct().then(function(){ saveCurrent(); });
}
function showPiece(){
  // pieza terminada sin animación (inicio, cancelar o reducir movimiento)
  dims = {L:cap.L, W:cap.W, H:cap.H}; live = {L:cap.L, W:cap.W, H:cap.H}; active = null;
  sm = {L:cap.L, W:cap.W, H:cap.H};
  setSolidScale(cap.L, cap.W, cap.H); setFade(1); solidMat.emissive.copy(EM0);
  solid.visible = true; edges.visible = true; holeLines.visible = true; blockEdges.visible = true; edges.geometry.setDrawRange(0, Infinity);
  ghost.visible = ghostFill.visible = false; points.visible = false;
  mode = 'done'; tagShow = {L:true, W:true, H:true};
  fitAll(); metrics(1); phaseUI(4, 1); renderDetails();
  setState('Pieza lista', 'ok'); whatIdle(); stepUI(); prompt(null);
}
function readManual(){
  var out = {}, bad = [];
  [['L','inL'],['W','inW'],['H','inH']].forEach(function(p){
    var v = parseFloat(String($(p[1]).value).replace(',', '.'));
    if (!(v > 0 && v <= MAX_MM)) bad.push(NAMES[p[0]]); else out[p[0]] = Math.round(v*100)/100;
  });
  if (bad.length){ $('err').textContent = bad.join(', ') + ': escribe un valor mayor que 0 y hasta 150 mm.'; return null; }
  $('err').textContent = ''; return out;
}
function manual(){
  if (busy || job || build) return;
  var m = readManual(); if (!m) return;
  stopSim();
  logLine('— Medición manual: ' + m.L.toFixed(2) + ' × ' + m.W.toFixed(2) + ' × ' + m.H.toFixed(2) + ' mm —', 's');
  clearDetails(); resetForMeasure(m); active = null; ghost.visible = ghostFill.visible = false;
  readoutLive(m.H, 'Última medida', true);
  current = {id:null, fecha:null, figura:'caja', fuente:'manual', guiada:false, largo_mm:m.L, ancho_mm:m.W, alto_mm:m.H, cuerpos:[], agujeros:[]};
  reconstruct().then(function(){ saveCurrent(); });
}
function replay(){
  if (busy || job || build || mode === 'measuring' || cap.L == null) return;
  logLine('Repite la reconstrucción', 's');
  var keep = {L:cap.L, W:cap.W, H:cap.H};
  resetForMeasure(keep); active = null; ghost.visible = ghostFill.visible = false;
  reconstruct();
}

/* ---------- Reconstrucción: nube de puntos → malla → sólido (sin barrido) ---------- */
var T = {cloud:[0, 0.95], mesh:[0.72, 1.3], solid:[1.1, 1.7], settle:[1.5, 2.05]};
function reconstruct(){
  return new Promise(function(res){
    var L = cap.L, W = cap.W, H = cap.H;
    busy = true; dims = {L:L, W:W, H:H};
    setState('Reconstruyendo', 'work'); prompt(null);
    what('Reconstrucción', 'Nube de puntos → malla → sólido', 'Con las tres cotas el programa siembra puntos sobre la superficie, une las aristas y cierra las caras del sólido.', false);
    setSolidScale(L, W, H); setFade(0);
    fitAll();
    seedParticles(bodies);
    solid.visible = true; edges.visible = true; holeLines.visible = false; blockEdges.visible = false;
    edges.geometry.setDrawRange(0, 0);
    tagShow = {L:false, W:false, H:false};
    points.visible = true; pMat.uniforms.uProg.value = 0; pMat.uniforms.uAlpha.value = 0;
    logLine('Nube de puntos: ' + N + ' puntos sobre la superficie', 's');
    mode = 'recon'; recon = {t0:performance.now(), res:res, step:0, cotas:false};
    if (REDUCED) recon.t0 -= 10000;
    stepUI(); faceBtnsUI();
  });
}
function clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
function ease(x){ return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2; }
function easeOut(x){ return 1 - Math.pow(1 - x, 3); }
function span(t, s){ return clamp01((t - s[0])/(s[1]-s[0])); }

function stepRecon(t){
  var e = (performance.now() - recon.t0)/1000, L = dims.L, W = dims.W, H = dims.H;
  var pc = span(e, T.cloud), pm = span(e, T.mesh), ps = easeOut(span(e, T.solid)), st = span(e, T.settle);
  // 01 nube: el shader mueve cada punto en arco desde las aristas medidas
  pMat.uniforms.uProg.value = pc; pMat.uniforms.uTime.value = t;
  pMat.uniforms.uJit.value = 0.35*(1 - pm);
  pMat.uniforms.uAlpha.value = 0.8*easeOut(clamp01(e/0.18))*(1 - ease(st));
  ghost.visible = ghostFill.visible = false;
  // 02 malla: las 12 aristas se dibujan una por una
  edges.geometry.setDrawRange(0, Math.floor(ease(pm)*24/2)*2);
  // 03 sólido: las caras aparecen por opacidad y se asientan
  setFade(ps); blockEdges.visible = ps > 0.4;
  solidMat.emissive.copy(EM0).lerp(EM1, (1 - ps)*0.5*(ps > 0 ? 1 : 0));
  if (e < T.mesh[0]) phaseUI(1, pc); else if (e < T.solid[0]) phaseUI(2, pm); else phaseUI(3, ps);
  if (recon.step === 0 && e >= T.mesh[0]){ recon.step = 1; logLine('Malla: 8 vértices, 12 aristas, 6 caras' + (bodies.length > 1 ? ' + ' + (bodies.length - 1) + ' bloque(s)' : ''), 's'); }
  if (recon.step === 1 && e >= T.solid[0]){ recon.step = 2; logLine('Sólido: caras cerradas' + (holes.length ? ' con ' + holes.length + ' agujero(s)' : ''), 's'); }
  if (st > 0){ recon.cotas = true; tagShow = {L:true, W:true, H:true}; metrics(easeOut(st)); }
  if (e >= T.settle[1]){
    mode = 'done'; points.visible = false; holeLines.visible = true; blockEdges.visible = true; renderDetails();
    edges.geometry.setDrawRange(0, Infinity); setFade(1); solidMat.emissive.copy(EM0);
    phaseUI(4, 1); metrics(1);
    setState('Pieza lista', 'ok'); whatIdle();
    logLine('Pieza lista: ' + L.toFixed(2) + ' × ' + W.toFixed(2) + ' × ' + H.toFixed(2) + ' mm', 'c');
    var r = recon.res; recon = null; busy = false; stepUI(); faceBtnsUI(); lastInput = performance.now(); r();
  }
}

/* ---------- Bucle ---------- */
var clock = new THREE.Clock(), lastT = 0;
function smooth(cur, target, dt){ return cur + (target - cur)*(1 - Math.exp(-dt/0.08)); }
function frame(){
  requestAnimationFrame(frame);
  var t = clock.getElapsedTime(), dt = Math.min(0.1, t - lastT); lastT = t;

  if (mode === 'measuring'){
    var tL = cap.L != null ? cap.L : (active === 'L' ? Math.max(0, live.L || 0) : 0);
    var tW = cap.W != null ? cap.W : (active === 'W' ? Math.max(0, live.W || 0) : 0);
    var tH = cap.H != null ? cap.H : (active === 'H' ? Math.max(0, live.H || 0) : 0);
    sm.L = smooth(sm.L, Math.min(tL, MAX_MM), dt); sm.W = smooth(sm.W, Math.min(tW, MAX_MM), dt); sm.H = smooth(sm.H, Math.min(tH, MAX_MM), dt);
    setGhost(sm.L, sm.W, sm.H);
    ghostFill.material.opacity = 0.07 + Math.sin(t*3)*0.02;
    var big = Math.max(sm.L, sm.W, sm.H);
    if (big > 4 && (big > framed*0.92 || (framed > 30 && big < framed*0.45))) fit(Math.max(sm.L, 10), sm.W, sm.H);
    updateBoxCotas(sm.L, sm.W, sm.H);
  } else if (mode === 'recon' && recon){
    stepRecon(t); updateBoxCotas(dims.L, dims.W, dims.H);
  } else {
    edgeMat.opacity = 0.78 + Math.sin(t*1.6)*0.14;
    updateBoxCotas(dims.L, dims.W, dims.H);
  }

  if (job) updateJobGhost(dt);
  if (drill) stepDrill();
  if (build) stepBuild(t);
  updateHighlight(t);
  var fl = clamp01(1 - (t - flashT)/0.7);
  if (mode === 'done') solidMat.emissive.copy(EM0).lerp(EM1, fl*0.6);
  if (job && job.stage === 'corner'){ var pul = 1 + Math.sin(t*5)*0.15; cornerMeshes.forEach(function(m){ m.scale.setScalar(m.userData.r*(m.userData.hov ? 1.5 : pul)); }); }

  // espera: la pieza gira muy despacio si nadie toca la vista
  controls.autoRotate = !REDUCED && mode === 'done' && !job && !sel && !drill && !build && performance.now() - lastInput > 7000;
  if (camGoal.on){
    var k = 1 - Math.exp(-dt*3.2);
    camera.position.lerp(camGoal.pos, k); controls.target.lerp(camGoal.tgt, k*1.1);
    if (camera.position.distanceTo(camGoal.pos) < 0.4) camGoal.on = false;
  }
  controls.update();
  placeTags();

  if (sparkDirty) drawSpark();
  if (t - pktWindow >= 0.5){
    stability();
    if (t - pktWindow >= 1){ $('liveSub').textContent = (packets - pktCount) + ' paquetes/s · último: ' + lastPacket; pktCount = packets; pktWindow = t; }
  }
  renderer.render(scene, camera);
}
function resize(){
  var w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w/h; camera.updateProjectionMatrix();
  pMat.uniforms.uScale.value = h*renderer.getPixelRatio()/(2*Math.tan(camera.fov*Math.PI/360));
}
if ('ResizeObserver' in window) new ResizeObserver(resize).observe(view); else window.addEventListener('resize', resize);

/* ==========================================================================
   Caras de los cuerpos. Cada cara tiene centro c, normal N hacia afuera y ejes U, V
   con U × V = N (tabla 16.3 de contexto.md). Las esquinas 1–4 tienen signos (su, sv).
   ========================================================================== */
var FACES = {
  top:   {name:'Superior',  N:[0,1,0],  U:[1,0,0],  V:[0,0,-1], opp:'bottom'},
  bottom:{name:'Inferior',  N:[0,-1,0], U:[1,0,0],  V:[0,0,1],  opp:'top'},
  front: {name:'Frontal',   N:[0,0,1],  U:[1,0,0],  V:[0,1,0],  opp:'back'},
  back:  {name:'Trasera',   N:[0,0,-1], U:[-1,0,0], V:[0,1,0],  opp:'front'},
  right: {name:'Derecha',   N:[1,0,0],  U:[0,0,-1], V:[0,1,0],  opp:'left'},
  left:  {name:'Izquierda', N:[-1,0,0], U:[0,0,1],  V:[0,1,0],  opp:'right'}
};
var FACE_KEYS = ['top','front','right','bottom','back','left'];
var CORNERS = [[-1,-1],[1,-1],[1,1],[-1,1]];

function v3(a){ return new THREE.Vector3(a[0], a[1], a[2]); }
function faceInfo(id, k){
  var b = B(id), f = FACES[k], N = v3(f.N), U = v3(f.U), V = v3(f.V);
  var s = b.max.clone().sub(b.min), ctr = b.min.clone().add(b.max).multiplyScalar(0.5);
  var ext = function(a){ return Math.abs(a.x)*s.x + Math.abs(a.y)*s.y + Math.abs(a.z)*s.z; };
  var t = ext(N);
  return {body:id, k:k, name:f.name, N:N, U:U, V:V, su:ext(U), sv:ext(V), t:t, opp:f.opp, c:ctr.addScaledVector(N, t/2)};
}
function faceLabel(id, k){ return FACES[k].name.toLowerCase() + (id === 0 ? '' : ' de B' + id); }
function faceMatrix(fi, off){ return new THREE.Matrix4().makeBasis(fi.U, fi.V, fi.N).setPosition(fi.c.clone().addScaledVector(fi.N, off || 0)); }
function facePoint(fi, u, v, off){ return fi.c.clone().addScaledVector(fi.U, u).addScaledVector(fi.V, v).addScaledVector(fi.N, off || 0); }
function cornerPoint(fi, cs, off){ return facePoint(fi, cs[0]*fi.su/2, cs[1]*fi.sv/2, off); }

/* ---------- Agujeros ---------- */
var holes = [], nextId = 1, job = null, sel = null, curBody = 0, jobBusy = false, drill = null, build = null, flashT = -10, typeThrough = true;
function holeCenter(h){ var fi = faceInfo(h.body, h.face), r = h.D/2; return facePoint(fi, h.cs[0]*(fi.su/2 - h.X - r), h.cs[1]*(fi.sv/2 - h.Y - r)); }
function holeAxis(h){ var fi = faceInfo(h.body, h.face); return {P:holeCenter(h), N:fi.N, dir:fi.N.clone().negate()}; }
/* tramo del eje (desde la boca hacia adentro) que queda dentro de cada cuerpo */
function axisSpan(b, P, dir){
  var s0 = -Infinity, s1 = Infinity, eps = 0.01;
  for (var a of ['x','y','z']){
    var d = dir[a], p = P[a], lo = b.min[a], hi = b.max[a];
    if (Math.abs(d) < 1e-9){ if (p < lo - eps || p > hi + eps) return null; }
    else { var t0 = (lo - p)/d, t1 = (hi - p)/d; s0 = Math.max(s0, Math.min(t0, t1)); s1 = Math.min(s1, Math.max(t0, t1)); }
  }
  return s1 > s0 + 1e-6 ? [s0, s1] : null;
}
/* material continuo bajo la boca: un taladro real atraviesa todos los cuerpos que se tocan en su eje */
function runLength(P, dir){
  var iv = [];
  bodies.forEach(function(b){ var s = axisSpan(b, P, dir); if (s) iv.push(s); });
  iv.sort(function(a, b){ return a[0] - b[0]; });
  var end = 0;
  iv.forEach(function(r){ if (r[0] <= end + 0.01 && r[1] > end) end = r[1]; });
  return end;
}
function holeRun(h){ var ax = holeAxis(h); return runLength(ax.P, ax.dir); }
function holeDepth(h){ return h.through ? holeRun(h) : h.depth; }

/* ---------- Geometría: cada cara es una figura con huecos; las paredes son cilindros abiertos ---------- */
var circleUnit = []; for (var ci=0; ci<64; ci++){ var ca = ci/64*Math.PI*2; circleUnit.push(new THREE.Vector3(Math.cos(ca), Math.sin(ca), 0)); }
var holeEdgeMat = new THREE.LineBasicMaterial({color:COL.sys, transparent:true, opacity:0.85});
function ringLine(P, N, r, mat){
  var l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circleUnit), mat);
  l.scale.set(r, r, 1); l.quaternion.setFromUnitVectors(Z_FWD, N); l.position.copy(P); return l;
}
function clearGroup(g){ for (var i=g.children.length-1; i>=0; i--){ var o = g.children[i]; g.remove(o); if (o.geometry) o.geometry.dispose(); } }
/* huecos que deja cada agujero en una cara: la boca, las caras que cruza y la salida si es pasante */
function openingsOn(id, k, list){
  var fi = faceInfo(id, k), out = [];
  (list || holes).forEach(function(h){
    var ax = holeAxis(h);
    if (Math.abs(fi.N.dot(ax.N)) < 0.99) return;
    var d = holeDepth(h), s = fi.c.clone().sub(ax.P).dot(ax.dir);
    if (s < -0.01 || s > (h.through ? d + 0.01 : d - 0.01)) return;
    var q = ax.P.clone().addScaledVector(ax.dir, s).sub(fi.c), u = q.dot(fi.U), v = q.dot(fi.V);
    if (Math.abs(u) > fi.su/2 + 0.01 || Math.abs(v) > fi.sv/2 + 0.01) return;
    out.push({u:u, v:v, r:h.D/2, id:h.id, entry:h.body === id && h.face === k, s:s});
  });
  return out;
}
function rebuildSolid(){
  clearGroup(solid); clearGroup(holeLines); clearGroup(blockEdges);
  bodies.forEach(function(b){
    var skip = attachedFace(b);   // la cara de abajo del bloque está pegada a su base: no se dibuja
    FACE_KEYS.forEach(function(k){
      if (k === skip) return;
      var fi = faceInfo(b.id, k), a = fi.su/2, c = fi.sv/2, s = new THREE.Shape();
      s.moveTo(-a,-c); s.lineTo(a,-c); s.lineTo(a,c); s.lineTo(-a,c); s.lineTo(-a,-c);
      openingsOn(b.id, k).forEach(function(o){
        var p = new THREE.Path(); p.absarc(o.u, o.v, o.r, 0, Math.PI*2, true); s.holes.push(p);
        holeLines.add(ringLine(facePoint(fi, o.u, o.v, 0.03), fi.N, o.r, holeEdgeMat));
      });
      var g = new THREE.ShapeGeometry(s, 40); g.applyMatrix4(faceMatrix(fi));
      var m = new THREE.Mesh(g, solidMat); m.userData = {body:b.id, face:k}; solid.add(m);
    });
    if (b.parent != null){
      var size = b.max.clone().sub(b.min), e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), edgeMat);
      e.position.copy(b.min).add(b.max).multiplyScalar(0.5); blockEdges.add(e);
    }
  });
  holes.forEach(function(h){
    var fi = faceInfo(h.body, h.face), P = holeCenter(h), d = holeDepth(h), r = h.D/2;
    var w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, 48, 1, true), wallMat);
    w.quaternion.setFromUnitVectors(Y_UP, fi.N); w.position.copy(P).addScaledVector(fi.N, -d/2); solid.add(w);
    if (!h.through){
      var bt = new THREE.Mesh(new THREE.CircleGeometry(r, 48), wallMat);
      bt.quaternion.setFromUnitVectors(Z_FWD, fi.N); bt.position.copy(P).addScaledVector(fi.N, -d); solid.add(bt);
      holeLines.add(ringLine(P.clone().addScaledVector(fi.N, -d + 0.03), fi.N, r, holeEdgeMat));
    }
  });
}

/* ---------- Ayudas visuales ---------- */
function faceOverlay(op){
  var g = new THREE.Group(); g.matrixAutoUpdate = false; g.visible = false;
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial({color:COL.sys, transparent:true, opacity:op, depthWrite:false, side:THREE.DoubleSide})));
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.5,-.5,0), new THREE.Vector3(.5,-.5,0), new THREE.Vector3(.5,.5,0), new THREE.Vector3(-.5,.5,0)]),
        new THREE.LineBasicMaterial({color:COL.sys, transparent:true, opacity:Math.min(1, op*6)})));
  scene.add(g); return g;
}
var selOv = faceOverlay(0.16), hovOv = faceOverlay(0.07);
function putOverlay(g, id, k){
  var fi = faceInfo(id, k);
  g.matrix.copy(faceMatrix(fi, 0.06)).multiply(new THREE.Matrix4().makeScale(fi.su, fi.sv, 1));
  g.matrixWorldNeedsUpdate = true; g.visible = true;
}
var cornerMat = new THREE.MeshBasicMaterial({color:COL.sys}), cornerSelMat = new THREE.MeshBasicMaterial({color:COL.ok});
var cornerMeshes = CORNERS.map(function(cs, i){ var m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), cornerMat); m.userData.ci = i; m.userData.r = 1; m.visible = false; scene.add(m); return m; });
var axX = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), 10, COL.sys);
var axY = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), 10, COL.sys);
axX.visible = axY.visible = false; scene.add(axX); scene.add(axY);
function segLine(color){
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  var l = new THREE.Line(g, new THREE.LineBasicMaterial({color:color, depthTest:false}));
  l.renderOrder = 5; l.frustumCulled = false; l.visible = false; scene.add(l); return l;
}
function setSeg(l, a, b){ var p = l.geometry.attributes.position.array; p[0]=a.x; p[1]=a.y; p[2]=a.z; p[3]=b.x; p[4]=b.y; p[5]=b.z; l.geometry.attributes.position.needsUpdate = true; l.visible = true; }
var refEdge = segLine(COL.live);
var jc = [new Cota(COL.live), new Cota(COL.live), new Cota(COL.live), new Cota(COL.live), new Cota(COL.live)];   // cotas del trabajo en curso
var gCyl = new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,48,1,true), new THREE.MeshBasicMaterial({color:COL.live, transparent:true, opacity:0.2, side:THREE.DoubleSide, depthWrite:false}));
var amberLine = new THREE.LineBasicMaterial({color:COL.live, depthTest:false});
var gRing = ringLine(new THREE.Vector3(), Z_FWD, 1, amberLine), gBot = ringLine(new THREE.Vector3(), Z_FWD, 1, new THREE.LineBasicMaterial({color:COL.live, transparent:true, opacity:0.6}));
gRing.renderOrder = 6; [gCyl, gRing, gBot].forEach(function(o){ o.visible = false; scene.add(o); });
var drillRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.3, 48), new THREE.MeshBasicMaterial({color:COL.sys, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false}));
drillRing.visible = false; scene.add(drillRing);
var CHIPS = 90, chipPos = new Float32Array(CHIPS*3), chipVel = new Float32Array(CHIPS*3);
var chipGeo = new THREE.BufferGeometry(); chipGeo.setAttribute('position', new THREE.BufferAttribute(chipPos, 3));
var chipMat = new THREE.PointsMaterial({size:1.3, color:COL.live, transparent:true, opacity:0, depthWrite:false});
var chips = new THREE.Points(chipGeo, chipMat); chips.visible = false; chips.frustumCulled = false; scene.add(chips);

/* etiquetas HTML extra: 'h…' del trabajo en curso, 'n…' agujeros y 'b…' bloques terminados */
var htags = {};
function setH(key, w, html, cls, cota){
  var o = htags[key];
  if (!o){ o = htags[key] = {el:makeTag(), w:new THREE.Vector3(), show:false, html:''}; }
  o.w.copy(w); o.show = true; o.cls = cls || ''; o.cota = cota || null;
  if (o.html !== html){ o.html = html; o.el.innerHTML = html; }
}
function hideH(prefix){ for (var k in htags) if (k.indexOf(prefix) === 0) htags[k].show = false; }

/* ---------- Selección de cara ---------- */
var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), cvs = renderer.domElement;
function pick(e, objs){
  var r = cvs.getBoundingClientRect();
  ndc.set(((e.clientX - r.left)/r.width)*2 - 1, -((e.clientY - r.top)/r.height)*2 + 1);
  ray.setFromCamera(ndc, camera);
  var hit = ray.intersectObjects(objs.filter(function(o){ return o.visible; }), false);
  return hit[0] || null;
}
function canSelectFace(){ return mode === 'done' && !busy && !job && !jobBusy && !build && !edit && cap.L != null; }
function hitFace(e){ var h = pick(e, solid.children); return h && h.object.userData.face ? h : null; }
function selectFace(id, k, pt){
  var fi = faceInfo(id, k); curBody = id; sel = {body:id, k:k, pt:(pt || fi.c).clone()};
  putOverlay(selOv, id, k); hovOv.visible = false;
  $('fmTxt').textContent = (id === 0 ? '' : 'B' + id + ' · ') + fi.name + ' · ' + fi.su.toFixed(1) + ' × ' + fi.sv.toFixed(1);
  $('faceMenu').hidden = false; faceBtnsUI();
}
function deselect(){ sel = null; selOv.visible = false; hovOv.visible = false; $('faceMenu').hidden = true; faceBtnsUI(); }
function faceBtnsUI(){
  var ok = canSelectFace(), b = B(curBody) || B(0);
  if (!b) return;
  var skip = attachedFace(b);
  FACE_KEYS.forEach(function(k){ var el = $('fb_' + k); if (!el) return; el.classList.toggle('on', !!sel && sel.k === k); el.disabled = !ok || k === skip; });
  $('btnHole').disabled = $('btnBlock').disabled = !sel || !ok;
  $('hBody').textContent = curBody === 0 ? 'Caras de la base' : 'Caras del bloque B' + curBody;
  $('hHint').textContent = sel ? 'Cara ' + faceLabel(sel.body, sel.k) + ' seleccionada (' + faceInfo(sel.body, sel.k).su.toFixed(1) + ' × ' + faceInfo(sel.body, sel.k).sv.toFixed(1) + ' mm).'
                               : (ok ? 'Toca una cara de la pieza o de un bloque, o elígela aquí.' : 'Primero termina la pieza.');
}
var downAt = null;
cvs.addEventListener('pointerdown', function(e){ downAt = {x:e.clientX, y:e.clientY}; lastInput = performance.now(); });
cvs.addEventListener('wheel', function(){ lastInput = performance.now(); }, {passive:true});
cvs.addEventListener('pointerup', function(e){
  lastInput = performance.now();
  if (!downAt) return;
  var moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y); downAt = null;
  if (moved > 6) return;   // fue un giro de cámara, no un toque
  if (job){
    if (job.stage === 'corner'){ var c = pick(e, cornerMeshes); if (c) chooseCorner(c.object.userData.ci); }
    return;
  }
  if (!canSelectFace()) return;
  var f = hitFace(e);
  if (f) selectFace(f.object.userData.body, f.object.userData.face, f.point); else deselect();
});
cvs.addEventListener('pointermove', function(e){
  if (e.buttons) return;
  var cur = '';
  if (canSelectFace()){
    var f = hitFace(e), u = f && f.object.userData;
    if (f && (!sel || sel.k !== u.face || sel.body !== u.body)) putOverlay(hovOv, u.body, u.face); else hovOv.visible = false;
    if (f) cur = 'pointer';
  } else {
    hovOv.visible = false;
    if (job && job.stage === 'corner'){
      var c = pick(e, cornerMeshes);
      cornerMeshes.forEach(function(m){ m.userData.hov = !!c && c.object === m; });
      if (c) cur = 'pointer';
    }
  }
  cvs.style.cursor = cur;
});

/* ==========================================================================
   Trabajos sobre una cara: agujero o bloque. Mismo esqueleto:
   cara → esquina de origen → medidas M:/C: en orden → vista previa → confirmar.
   ========================================================================== */
var KIND = {
  hole:{
    title:'Agujero', all:['D','X','Y','P'], keys:function(){ return job.through ? ['D','X','Y'] : ['D','X','Y','P']; },
    name:{D:'diámetro', X:'distancia X', Y:'distancia Y', P:'profundidad'},
    lbl:{D:'Ø', X:'X', Y:'Y', P:'Profundidad'},
    prompt:{D:'Mide el DIÁMETRO con las mordazas de interiores', X:'X: de la orilla resaltada a la pared del agujero',
            Y:'Y: de la orilla resaltada a la pared del agujero', P:'Mide la PROFUNDIDAD con la varilla'},
    panel:'holeJob', step:'hs', val:'hv', inp:'hi', btn:'btnH', corner:'cb', checks:'hChecks'
  },
  block:{
    title:'Bloque', all:['L','W','H','X','Y'], keys:function(){ return ['L','W','H','X','Y']; },
    name:{L:'largo del bloque', W:'ancho del bloque', H:'alto del bloque', X:'distancia X', Y:'distancia Y'},
    lbl:{L:'Largo', W:'Ancho', H:'Alto', X:'X', Y:'Y'},
    prompt:{L:'Mide el LARGO del bloque (dirección X)', W:'Mide el ANCHO del bloque (dirección Y)', H:'Mide el ALTO del bloque con el escalón',
            X:'X: de la orilla resaltada a la pared del bloque', Y:'Y: de la orilla resaltada a la pared del bloque'},
    panel:'blockJob', step:'bs', val:'bv', inp:'bi', btn:'btnB', corner:'bc', checks:'bChecks'
  }
};
function K(){ return KIND[job.kind]; }
function focusFace(fi){
  var m = Math.max(fi.su, fi.sv, 20), aspect = (view.clientWidth || 1)/(view.clientHeight || 1);
  var dir = fi.N.clone().add(new THREE.Vector3(0.35, 0.45, 0.4)).normalize();
  camGoal.tgt.copy(fi.c); camGoal.pos.copy(fi.c).addScaledVector(dir, (m*1.9 + 60)*Math.max(1, 1.25/aspect)); camGoal.on = true;
}
function startJob(kind, id, k){
  if (!canSelectFace()) return;
  var fi = faceInfo(id, k);
  job = {kind:kind, body:id, face:k, stage:'corner', cs:null, ci:null, cap:{}, live:{}, sm:{}, active:null, through:typeThrough, pr:null};
  var kd = K();
  putOverlay(selOv, id, k); hovOv.visible = false; $('faceMenu').hidden = true;
  $('boxCtl').hidden = true; $('holeSec').hidden = true; $(kd.panel).hidden = false;
  $(kind === 'hole' ? 'hjTitle' : 'bjTitle').textContent = kd.title + ' ' + (kind === 'hole' ? '#' + nextId : 'B' + nextBlockId) + ' · cara ' + faceLabel(id, k);
  $(kd.checks).innerHTML = ''; kd.all.forEach(function(c){ $(kd.inp + c).value = ''; });
  var rc = Math.max(0.9, Math.min(fi.su, fi.sv)*0.04);
  cornerMeshes.forEach(function(m, i){
    var p = cornerPoint(fi, CORNERS[i], 0.3);
    m.position.copy(p); m.userData.r = rc; m.userData.hov = false; m.scale.setScalar(rc); m.material = cornerMat; m.visible = true;
    var out = p.clone().sub(fi.c); out.addScaledVector(fi.N, -out.dot(fi.N)).normalize();
    setH('hc' + i, p.clone().addScaledVector(out, rc*2 + 4), String(i + 1), 'corner');
  });
  prompt('Toca la esquina de origen (1–4)'); setState(kd.title + ' · elige esquina', 'live');
  what('Esquina de origen', 'Referencia de las medidas', 'De esa esquina salen los ejes X y Y. Todas las distancias se miden desde sus dos orillas.', false);
  logLine('Nuevo ' + kd.title.toLowerCase() + ' en cara ' + faceLabel(id, k) + ': ' + fi.su.toFixed(2) + ' × ' + fi.sv.toFixed(2) + ' mm, grosor ' + fi.t.toFixed(2) + ' mm', 's');
  focusFace(fi); jobUI(); stepUI();
}
function chooseCorner(i){
  if (!job || jobBusy || job.stage === 'busy') return;
  var fi = faceInfo(job.body, job.face);
  job.cs = CORNERS[i]; job.ci = i; job.cap = {}; job.live = {}; job.sm = {};
  hideH('hc');
  cornerMeshes.forEach(function(m, j){ m.visible = j === i; m.material = cornerSelMat; m.scale.setScalar(m.userData.r); });
  var C = cornerPoint(fi, job.cs, 0.15);
  var xd = fi.U.clone().multiplyScalar(-job.cs[0]), yd = fi.V.clone().multiplyScalar(-job.cs[1]);
  var hl = Math.max(3, Math.min(fi.su, fi.sv)*0.08);
  axX.position.copy(C); axX.setDirection(xd); axX.setLength(fi.su + 6, hl, hl*0.55); axX.visible = true;
  axY.position.copy(C); axY.setDirection(yd); axY.setLength(fi.sv + 6, hl, hl*0.55); axY.visible = true;
  setH('hax', C.clone().addScaledVector(xd, fi.su + 6 + hl), 'X', 'axis');
  setH('hay', C.clone().addScaledVector(yd, fi.sv + 6 + hl), 'Y', 'axis');
  setH('hco', C.clone().addScaledVector(xd, -5).addScaledVector(yd, -5), 'Origen ' + (i + 1), 'origin');
  logLine('Esquina de origen: ' + (i + 1), 's');
  advance();
}
function nextKey(){ var ks = K().keys(); for (var i=0; i<ks.length; i++) if (job.cap[ks[i]] == null) return ks[i]; return null; }
function advance(){
  job.pr = null; $(K().checks).innerHTML = '';
  var k = nextKey();
  if (k){
    job.stage = 'measure'; job.active = k; job.live[k] = null;
    prompt(K().prompt[k]); setState(K().title + ' · ' + K().name[k], 'live'); whatKey(job.kind + '.' + k);
    readoutLive(0, 'Midiendo ' + K().name[k], false); $('liveVal').textContent = '--.--';
  } else toPreview();
  jobUI();
}
function checkCapture(k, v){
  var fi = faceInfo(job.body, job.face);
  if (job.kind === 'block'){
    if (k === 'X' || k === 'Y'){ if (!(v >= 0)) return 'no puede ser negativa'; }
    else if (!(v > 0)) return 'debe ser mayor que 0';
    if (v > MAX_MM) return 'fuera del rango del vernier (0–150 mm)';
    var c = job.cap;
    if (k === 'L' && v > fi.su + 0.005) return 'más largo que la cara (' + fi.su.toFixed(2) + ' mm)';
    if (k === 'W' && v > fi.sv + 0.005) return 'más ancho que la cara (' + fi.sv.toFixed(2) + ' mm)';
    if (k === 'X' && v + c.L > fi.su + 0.005) return 'con largo ' + c.L.toFixed(2) + ' el bloque se sale de la cara en X';
    if (k === 'Y' && v + c.W > fi.sv + 0.005) return 'con ancho ' + c.W.toFixed(2) + ' el bloque se sale de la cara en Y';
    return '';
  }
  var D = job.cap.D;
  if (!(v > 0)) return 'debe ser mayor que 0';
  if (v > MAX_MM) return 'fuera del rango del vernier (0–150 mm)';
  if (k === 'D' && v >= Math.min(fi.su, fi.sv)) return 'un Ø de ' + v.toFixed(2) + ' no cabe en esta cara';
  if (k === 'X' && v + D >= fi.su) return 'con Ø ' + D.toFixed(2) + ' el agujero se sale de la cara en X';
  if (k === 'Y' && v + D >= fi.sv) return 'con Ø ' + D.toFixed(2) + ' el agujero se sale de la cara en Y';
  if (k === 'P'){ var run = jobRun(); if (v > run + 0.05) return 'más profundo que el material bajo la boca (' + run.toFixed(2) + ' mm)'; }
  return '';
}
function jobMessage(kind, v, line){
  var k = job.active, kd = K();
  if (kind === 'M'){
    job.live[k] = v; readoutLive(v, 'Midiendo ' + kd.name[k], false); logLine(line, 'm');
    jobUI(); return;
  }
  var msg = checkCapture(k, v);
  if (msg){ logLine('Rechazado (' + kd.name[k] + '): ' + msg + ' · ' + line, 'e'); setState('Captura rechazada', 'bad'); return; }
  setCap(k, v, line + '   ✔ ' + kd.name[k] + ' capturado' +
         (job.kind === 'hole' && (k === 'X' || k === 'Y') ? ' → centro a ' + (v + job.cap.D/2).toFixed(2) + ' mm' : ''));
}
function setCap(k, v, msg){
  job.cap[k] = v; job.live[k] = v;
  readoutLive(v, K().lbl[k] + ' capturado', true);
  logLine(msg, 'c');
  var el = $(K().step + k); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  advance();
}
/* bloque pegado a la orilla: la distancia vale 0 y no se mide */
function stickTo(k){
  if (!job || job.kind !== 'block' || job.stage !== 'measure' || job.cap[k] != null || jobBusy) return;
  var simulating = source === 'simulador' && job.live[job.active] != null;
  stopSim();
  if (job.active !== k){ job.cap[k] = 0; job.live[k] = 0; logLine(k + ' pegado a la orilla (0.00 mm)', 'c'); jobUI(); }
  else setCap(k, 0, k + ' pegado a la orilla (0.00 mm)');
  // si el simulador estaba midiendo, sigue con las medidas que faltan
  if (simulating && job && job.stage === 'measure'){ job.live[job.active] = null; setTimeout(jobSim, 250); }
}
/* material bajo la boca del agujero en curso (atraviesa todos los cuerpos que se tocan) */
function jobRun(){
  var c = job.cap;
  if (!job.cs || c.D == null || c.X == null || c.Y == null) return faceInfo(job.body, job.face).t;
  return holeRun({body:job.body, face:job.face, cs:job.cs, D:c.D, X:c.X, Y:c.Y});
}
function jv(k){ if (!job) return null; if (job.cap[k] != null) return job.cap[k]; return job.active === k ? job.live[k] : null; }

/* fantasma del trabajo en curso: valores reales para el texto, suavizados para la geometría */
function updateJobGhost(dt){
  hideH('hD'); hideH('hX'); hideH('hY'); hideH('hP'); hideH('hL'); hideH('hW'); hideH('hH');
  gCyl.visible = gRing.visible = gBot.visible = refEdge.visible = bGhost.visible = bGhostFill.visible = false;
  jc.forEach(function(c){ c.hide(); });
  if (!job || !job.cs || job.stage === 'busy') return;
  var fi = faceInfo(job.body, job.face), cs = job.cs;
  var xd = fi.U.clone().multiplyScalar(-cs[0]), yd = fi.V.clone().multiplyScalar(-cs[1]);
  var C = cornerPoint(fi, cs, 0.15);
  var raw = {}, s = {};
  K().all.forEach(function(k){
    var v = jv(k); raw[k] = v;
    if (v == null){ job.sm[k] = null; s[k] = null; return; }
    var tgt = Math.max(0, v);
    job.sm[k] = job.sm[k] == null ? tgt : smooth(job.sm[k], tgt, dt || 0.016); s[k] = job.sm[k];
  });
  var cls = function(k){ return job.active === k ? 'live' : (job.cap[k] != null ? 'cap' : ''); };
  var col = function(k){ return job.active === k ? COL.live : COL.ok; };
  var head = Math.min(2.5, Math.max(0.9, Math.min(fi.su, fi.sv)*0.03)), lift = fi.N.clone().multiplyScalar(0.2);
  if (job.active === 'X') setSeg(refEdge, C, C.clone().addScaledVector(yd, fi.sv));
  if (job.active === 'Y') setSeg(refEdge, C, C.clone().addScaledVector(xd, fi.su));
  if (job.kind === 'hole') holeGhost(fi, xd, yd, C, s, raw, cls, col, head, lift);
  else blockGhost(fi, xd, yd, C, s, raw, cls, col, head, lift);
}
function holeGhost(fi, xd, yd, C, s, raw, cls, col, head, lift){
  var r = s.D > 0 ? Math.min(s.D, Math.min(fi.su, fi.sv))/2 : 0;
  var cx = s.X != null ? s.X + r : fi.su/2, cy = s.Y != null ? s.Y + r : fi.sv/2;
  var Pc = cornerPoint(fi, job.cs, 0).addScaledVector(xd, cx).addScaledVector(yd, cy);
  var run = runLength(Pc, fi.N.clone().negate()) || fi.t;
  var d = job.through ? run : (s.P > 0 ? Math.min(s.P, run) : run*0.5);
  if (r > 0){
    gCyl.scale.set(r, d, r); gCyl.quaternion.setFromUnitVectors(Y_UP, fi.N); gCyl.position.copy(Pc).addScaledVector(fi.N, -d/2); gCyl.visible = true;
    gRing.scale.set(r, r, 1); gRing.quaternion.setFromUnitVectors(Z_FWD, fi.N); gRing.position.copy(Pc).addScaledVector(fi.N, 0.1); gRing.visible = true;
    gBot.scale.set(r, r, 1); gBot.quaternion.setFromUnitVectors(Z_FWD, fi.N); gBot.position.copy(Pc).addScaledVector(fi.N, -d); gBot.visible = true;
    jc[0].set(Pc.clone().addScaledVector(xd, -r).add(lift), Pc.clone().addScaledVector(xd, r).add(lift), yd, 0, head); jc[0].color(col('D'));
    setH('hD', Pc.clone().addScaledVector(yd, -Math.max(2.5, r*0.45)).add(lift), '<small>Ø</small>' + raw.D.toFixed(2), cls('D'));
  }
  if (s.X != null){
    var a = C.clone().addScaledVector(yd, cy), b = a.clone().addScaledVector(xd, s.X);
    jc[1].set(a.add(lift), b.add(lift), yd, 0, head); jc[1].color(col('X'));
    setH('hX', jc[1].mid.clone().addScaledVector(yd, -Math.max(3, r*0.6)), '<small>X</small>' + raw.X.toFixed(2), cls('X'));
  }
  if (s.Y != null){
    var a2 = C.clone().addScaledVector(xd, cx), b2 = a2.clone().addScaledVector(yd, s.Y);
    jc[2].set(a2.add(lift), b2.add(lift), xd, 0, head); jc[2].color(col('Y'));
    setH('hY', jc[2].mid.clone().addScaledVector(xd, -Math.max(3, r*0.6)), '<small>Y</small>' + raw.Y.toFixed(2), cls('Y'));
  }
  if (r > 0 && (job.through || raw.P != null)){
    setH('hP', Pc.clone().addScaledVector(fi.N, -d/2).addScaledVector(xd, r + 6),
         job.through ? '<small>PASANTE</small>' + run.toFixed(2) : '<small>PROF</small>' + raw.P.toFixed(2), cls('P'));
  }
}
/* el bloque crece pegado a la esquina y se desliza a su lugar cuando llegan X y Y */
function blockGhost(fi, xd, yd, C, s, raw, cls, col, head, lift){
  var L = Math.max(s.L || 0, 0.05), W = Math.max(s.W || 0, 0.05), H = Math.max(s.H || 0, 0.05);
  var x = s.X || 0, y = s.Y || 0;
  if (raw.L == null) return;
  var p0 = cornerPoint(fi, job.cs, 0).addScaledVector(xd, x).addScaledVector(yd, y);
  var p1 = p0.clone().addScaledVector(xd, L).addScaledVector(yd, W).addScaledVector(fi.N, H);
  var mn = p0.clone().min(p1), mx = p0.clone().max(p1), size = mx.clone().sub(mn);
  [bGhost, bGhostFill].forEach(function(o){ o.position.copy(mn).add(mx).multiplyScalar(0.5); o.scale.set(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05)); o.visible = true; });
  bGhostFill.material.opacity = 0.14 + Math.sin(clock.getElapsedTime()*3)*0.04;
  var off = 3 + Math.max(L, W, H)*0.12, h2 = head*1.2;
  jc[0].set(p0.clone().add(lift), p0.clone().addScaledVector(xd, L).add(lift), yd.clone().negate(), off, h2); jc[0].color(col('L'));
  setH('hL', jc[0].mid, '<small>LARGO</small>' + raw.L.toFixed(2), cls('L'), jc[0]);
  if (raw.W != null){
    jc[1].set(p0.clone().add(lift), p0.clone().addScaledVector(yd, W).add(lift), xd.clone().negate(), off, h2); jc[1].color(col('W'));
    setH('hW', jc[1].mid, '<small>ANCHO</small>' + raw.W.toFixed(2), cls('W'), jc[1]);
  }
  if (raw.H != null){
    var hb = p0.clone().addScaledVector(xd, L);
    jc[2].set(hb, hb.clone().addScaledVector(fi.N, H), yd.clone().negate(), off, h2); jc[2].color(col('H'));
    setH('hH', jc[2].mid, '<small>ALTO</small>' + raw.H.toFixed(2), cls('H'), jc[2]);
  }
  if (raw.X != null && x > 0.05){
    var a = C.clone().addScaledVector(yd, y + W/2), b = a.clone().addScaledVector(xd, x);
    jc[3].set(a.add(lift), b.add(lift), yd, 0, head); jc[3].color(col('X'));
    setH('hX', jc[3].mid.clone().addScaledVector(yd, -3), '<small>X</small>' + raw.X.toFixed(2), cls('X'));
  }
  if (raw.Y != null && y > 0.05){
    var a2 = C.clone().addScaledVector(xd, x + L/2), b2 = a2.clone().addScaledVector(yd, y);
    jc[4].set(a2.add(lift), b2.add(lift), xd, 0, head); jc[4].color(col('Y'));
    setH('hY', jc[4].mid.clone().addScaledVector(xd, -3), '<small>Y</small>' + raw.Y.toFixed(2), cls('Y'));
  }
}
function setJobBusy(b){ jobBusy = b; jobUI(); }
function jobUI(){
  ['tThrough','tBlind'].forEach(function(id, i){ var b = $(id); b.classList.toggle('on', (i === 0) === (job && job.kind === 'hole' ? job.through : typeThrough)); b.disabled = jobBusy; });
  if (!job) return;
  var kd = K(), ks = kd.keys();
  kd.all.forEach(function(k){
    var el = $(kd.step + k), v = $(kd.val + k); el.classList.remove('active','done','skip');
    if (ks.indexOf(k) < 0){ el.classList.add('skip'); v.textContent = 'pasante'; return; }
    if (job.cap[k] != null){ el.classList.add('done'); v.textContent = job.kind === 'block' && (k === 'X' || k === 'Y') && job.cap[k] === 0 ? 'pegado' : job.cap[k].toFixed(2); }
    else if (job.active === k){ el.classList.add('active'); v.textContent = fmt(job.live[k]); }
    else v.textContent = '--.--';
  });
  var ncap = Object.keys(job.cap).length, b = kd.btn;
  for (var i=0; i<4; i++){ var cb = $(kd.corner + i); cb.classList.toggle('on', job.ci === i); cb.disabled = jobBusy || (job.stage !== 'corner' && ncap > 0); }
  $(b + 'Sim').disabled = jobBusy || job.stage !== 'measure' || source === 'serial';
  $(b + 'Cap').disabled = jobBusy || job.stage !== 'measure' || job.live[job.active] == null;
  $(b + 'Man').disabled = jobBusy || !(job.stage === 'measure' || job.stage === 'preview');
  $(b + 'Ok').disabled = jobBusy || job.stage !== 'preview' || !job.pr || job.pr.e.length > 0;
  $(b + 'Redo').disabled = jobBusy || !job.cs || ncap === 0;
  $(b + 'Cancel').disabled = jobBusy;
  if (job.kind === 'hole'){
    var D = jv('D'), X = jv('X'), Y = jv('Y');
    $('hCenter').textContent = job.cs
      ? 'Centro desde la esquina ' + (job.ci + 1) + ':  X ' + (X != null && D != null ? (X + D/2).toFixed(2) : '—') + '  ·  Y ' + (Y != null && D != null ? (Y + D/2).toFixed(2) : '—') + ' mm'
      : 'Toca la esquina de origen en la vista 3D o elige su número.';
    $('hiP').disabled = job.through;
  } else {
    var mstage = job.stage === 'measure';
    $('btnBX0').disabled = jobBusy || !mstage || job.cap.X != null;
    $('btnBY0').disabled = jobBusy || !mstage || job.cap.Y != null;
    var f = function(k){ var v = jv(k); return v == null ? '—' : v.toFixed(2); };
    $('bPos').textContent = job.cs
      ? f('L') + ' × ' + f('W') + ' × ' + f('H') + ' mm · a X ' + f('X') + ' · Y ' + f('Y') + ' de la esquina ' + (job.ci + 1)
      : 'Toca la esquina de origen en la vista 3D o elige su número.';
  }
}
function setType(t){
  if (jobBusy) return;
  typeThrough = t;
  if (job && job.kind === 'hole'){
    job.through = t;
    if (job.stage === 'measure' || job.stage === 'preview'){ if (t && job.active === 'P') job.active = null; stopSim(); advance(); }
    else jobUI();
  } else jobUI();
}

/* ---------- Validación ---------- */
function cylInfo(h){ var fi = faceInfo(h.body, h.face); return {P:holeCenter(h), N:fi.N, d:holeDepth(h), r:h.D/2}; }
function cylBox(c){
  var b = new THREE.Box3().setFromPoints([c.P, c.P.clone().addScaledVector(c.N, -c.d)]);
  return b.expandByVector(new THREE.Vector3(c.r*(1 - Math.abs(c.N.x)), c.r*(1 - Math.abs(c.N.y)), c.r*(1 - Math.abs(c.N.z))));
}
function collide(a, b){
  var A = cylInfo(a), Bc = cylInfo(b), dot = A.N.dot(Bc.N);
  if (Math.abs(dot) > 0.5){   // ejes paralelos: misma cara o cara opuesta
    var diff = Bc.P.clone().sub(A.P), lat = diff.clone().addScaledVector(A.N, -diff.dot(A.N)).length();
    var s0 = -diff.dot(A.N), s1 = s0 + Bc.d*dot;
    var ov = Math.min(A.d, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1));
    if (ov <= 0) return null;
    if (lat < A.r + Bc.r) return 'hit';
    if (lat < A.r + Bc.r + 1) return 'near';
    return null;
  }
  return cylBox(A).intersectsBox(cylBox(Bc)) ? 'maybe' : null;   // caras perpendiculares: prueba conservadora
}
/* huella de los bloques apoyados en una cara, en coordenadas (u, v) de esa cara */
function footprints(id, k, list){
  var fi = faceInfo(id, k), out = [];
  (list || blocks()).forEach(function(b){
    if (b.parent !== id || b.face !== k) return;
    var a = b.min.clone().sub(fi.c), z = b.max.clone().sub(fi.c);
    var u0 = a.dot(fi.U), u1 = z.dot(fi.U), v0 = a.dot(fi.V), v1 = z.dot(fi.V);
    out.push({id:b.id, u0:Math.min(u0,u1), u1:Math.max(u0,u1), v0:Math.min(v0,v1), v1:Math.max(v0,v1)});
  });
  return out;
}
function circleInRect(o, f){
  var du = Math.max(f.u0 - o.u, 0, o.u - f.u1), dv = Math.max(f.v0 - o.v, 0, o.v - f.v1);
  return du*du + dv*dv < (o.r - 0.001)*(o.r - 0.001) || (o.u > f.u0 && o.u < f.u1 && o.v > f.v0 && o.v < f.v1);
}
function jobHole(){
  var h = {id:nextId, body:job.body, face:job.face, cs:job.cs.slice(), ci:job.ci, D:job.cap.D, X:job.cap.X, Y:job.cap.Y,
           depth:job.through ? null : job.cap.P, through:job.through};
  if (!h.through && h.depth != null && h.D > 0 && Math.abs(h.depth - holeRun(h)) <= 0.05){ h.through = true; h.depth = null; }
  return h;
}
function bodyRef(id){ return id === 0 ? 'la base' : 'el bloque B' + id; }
/* el agujero debe atravesar completo cada cuerpo que cruza y no rozar los que no cruza */
function crossErrors(h){
  var ax = holeAxis(h), d = holeDepth(h), r = h.D/2, e = [], tag = 'El agujero #' + h.id;
  var cb = cylBox({P:ax.P, N:ax.N, d:d, r:r});
  bodies.forEach(function(b){
    var s = axisSpan(b, ax.P, ax.dir);
    if (!(s && s[1] > 0.01 && s[0] < d - 0.01)){
      if (overlaps(cb, b)) e.push(tag + ' roza ' + bodyRef(b.id) + ' sin atravesarlo.');
      return;
    }
    var cut = FACE_KEYS.some(function(k){
      var fi = faceInfo(b.id, k);
      if (Math.abs(fi.N.dot(ax.N)) < 0.99 || (b.id === h.body && k === h.face)) return false;
      var q = ax.P.clone().sub(fi.c), u = q.dot(fi.U), v = q.dot(fi.V);
      return Math.abs(u) + r > fi.su/2 + 0.01 || Math.abs(v) + r > fi.sv/2 + 0.01;
    });
    if (cut) e.push(tag + ' corta la orilla de ' + bodyRef(b.id) + '.');
  });
  return e;
}
function problems(h){
  var fi = faceInfo(h.body, h.face), e = [], w = [];
  if (!(h.D > 0)) e.push('Falta el diámetro.');
  else if (h.D >= Math.min(fi.su, fi.sv)) e.push('Un Ø de ' + h.D.toFixed(2) + ' no cabe en la cara.');
  if (!(h.X > 0) || h.X + h.D >= fi.su) e.push('En X el agujero se sale de la cara.');
  if (!(h.Y > 0) || h.Y + h.D >= fi.sv) e.push('En Y el agujero se sale de la cara.');
  var run = e.length ? 0 : holeRun(h);
  if (!h.through && !e.length){
    if (!(h.depth > 0)) e.push('Falta la profundidad.');
    else if (h.depth > run + 0.05) e.push('Profundidad mayor que el material bajo la boca (' + run.toFixed(2) + ' mm).');
  }
  if (!e.length){
    var mn = Math.min(h.X, fi.su - h.X - h.D, h.Y, fi.sv - h.Y - h.D);
    if (mn < 1) w.push('Queda una pared de ' + mn.toFixed(2) + ' mm hasta la orilla; con menos de ~1 mm suele imprimirse mal (estimado para FDM).');
    if (!h.through && run - h.depth < 1) w.push('El fondo queda de ' + (run - h.depth).toFixed(2) + ' mm; muy delgado para imprimir bien.');
    holes.forEach(function(o){
      if (o.id === h.id) return;
      var c = collide(h, o);
      if (c === 'hit') e.push('Choca con el agujero #' + o.id + '.');
      else if (c === 'maybe') e.push('Puede cruzarse con el agujero #' + o.id + ' dentro de la pieza.');
      else if (c === 'near') w.push('Queda a menos de 1 mm del agujero #' + o.id + '.');
    });
    // la boca no puede quedar tapada por un bloque; la salida sí: el taladro sigue y lo atraviesa
    var o = openingsOn(h.body, h.face, [h]).filter(function(x){ return x.entry; })[0];
    if (o) footprints(h.body, h.face).forEach(function(f){ if (circleInRect(o, f)) e.push('El bloque B' + f.id + ' tapa la boca del agujero.'); });
    crossErrors(h).forEach(function(t){ e.push(t); });
  }
  return {e:e, w:w};
}
function jobBlock(){
  var c = job.cap;
  return placeBlock({id:nextBlockId, parent:job.body, face:job.face, cs:job.cs.slice(), ci:job.ci, L:c.L, W:c.W, H:c.H, X:c.X || 0, Y:c.Y || 0});
}
function overlaps(a, o){
  var eps = 0.005;
  return a.min.x < o.max.x - eps && a.max.x > o.min.x + eps && a.min.y < o.max.y - eps && a.max.y > o.min.y + eps && a.min.z < o.max.z - eps && a.max.z > o.min.z + eps;
}
function blockProblems(b){
  var fi = faceInfo(b.parent, b.face), e = [], w = [];
  if (!(b.L > 0 && b.W > 0 && b.H > 0)) e.push('Faltan medidas del bloque.');
  if (b.X + b.L > fi.su + 0.005) e.push('En X el bloque se sale de la cara.');
  if (b.Y + b.W > fi.sv + 0.005) e.push('En Y el bloque se sale de la cara.');
  if (!e.length){
    var temp = bodies.indexOf(b) < 0;
    if (temp) bodies.push(b);   // se prueba con el bloque ya puesto: los pasantes que salen bajo él lo atraviesan
    bodies.forEach(function(o){ if (o !== b && o.id !== b.parent && overlaps(b, o)) e.push('Se encima con ' + bodyRef(o.id) + '.'); });
    var fp = footprints(b.parent, b.face, [b])[0];
    openingsOn(b.parent, b.face).forEach(function(o){ if (o.entry && circleInRect(o, fp)) e.push('Tapa la boca del agujero #' + o.id + '.'); });
    holes.forEach(function(h){ crossErrors(h).forEach(function(t){ e.push(t); }); });
    if (temp) bodies.pop();
    if (Math.min(b.L, b.W, b.H) < 1) w.push('El bloque mide menos de 1 mm en un lado; muy delgado para imprimir bien (estimado para FDM).');
    var env = envelope(temp ? bodies.concat([b]) : bodies).size;
    if (Math.max(env.x, env.y, env.z) > MAX_MM) w.push('La pieza completa pasa de 150 mm: ya no se podría medir de una vez con el vernier.');
  }
  return {e:e, w:w};
}
function addCheck(cls, txt){ var d = document.createElement('div'); d.className = cls; d.textContent = txt; $(K().checks).appendChild(d); }
function toPreview(){
  job.stage = 'preview'; job.active = null;
  $(K().checks).innerHTML = '';
  var pr;
  if (job.kind === 'hole'){
    var h = jobHole(); pr = problems(h);
    if (!job.through && h.through) addCheck('ok', '✔ La profundidad es igual al grosor: se tomará como pasante.');
    if (h.through && h.D > 0 && !problems(h).e.length){
      var crossed = bodies.filter(function(b){ var ax = holeAxis(h), s = axisSpan(b, ax.P, ax.dir); return s && s[1] > 0.01 && s[0] < holeRun(h) - 0.01; });
      if (crossed.length > 1) addCheck('ok', '✔ Atraviesa ' + crossed.map(function(b){ return b.id === 0 ? 'la base' : 'B' + b.id; }).join(' y ') + ': ' + holeRun(h).toFixed(2) + ' mm de material.');
    }
    what('Vista previa del agujero', 'Centro X ' + (h.X + h.D/2).toFixed(2) + ' · Y ' + (h.Y + h.D/2).toFixed(2) + ' mm desde la esquina ' + (h.ci + 1),
         'El cilindro naranja muestra dónde quedará. Confirma para perforar la pieza.', false);
  } else {
    var b = jobBlock(); pr = blockProblems(b);
    what('Vista previa del bloque', b.L.toFixed(2) + ' × ' + b.W.toFixed(2) + ' × ' + b.H.toFixed(2) + ' mm',
         'El bloque naranja muestra dónde quedará, a X ' + b.X.toFixed(2) + ' · Y ' + b.Y.toFixed(2) + ' mm de la esquina ' + (b.ci + 1) + '. Confirma para agregarlo.', false);
  }
  job.pr = pr;
  pr.e.forEach(function(t){ addCheck('bad', '✕ ' + t); });
  pr.w.forEach(function(t){ addCheck('warn', '! ' + t); });
  if (!pr.e.length && !pr.w.length) addCheck('ok', job.kind === 'hole' ? '✔ Cabe en la cara y no choca con otros agujeros.' : '✔ Cabe en la cara y no choca con otros cuerpos ni agujeros.');
  prompt(pr.e.length ? 'Corrige la medida marcada' : 'Revisa la vista previa y confirma');
  setState(pr.e.length ? K().title + ' con error' : 'Vista previa', pr.e.length ? 'bad' : 'work');
  jobUI();
}

/* ---------- Fuentes del trabajo: simulador y manual ---------- */
function suggestHole(){
  var fi = faceInfo(job.body, job.face), m = Math.min(fi.su, fi.sv);
  var sizes = [3,4,5,6,8,10,12,16,20].filter(function(d){ return d <= m*0.4; });
  for (var i=0; i<80; i++){
    var D = job.cap.D != null ? job.cap.D : (sizes.length ? Math.round((sizes[Math.floor(Math.random()*sizes.length)] + Math.random()*0.06)*100)/100 : rnd(1, Math.max(1.1, m*0.4)));
    var X = job.cap.X != null ? job.cap.X : rnd(1.2, fi.su - D - 1.2);
    var Y = job.cap.Y != null ? job.cap.Y : rnd(1.2, fi.sv - D - 1.2);
    var P = job.through ? null : (job.cap.P != null ? job.cap.P : rnd(fi.t*0.3, fi.t*0.8));
    var pr = problems({body:job.body, face:job.face, cs:job.cs, D:D, X:X, Y:Y, depth:P, through:job.through});
    if (!pr.e.length && (!pr.w.length || i > 50)) return {D:D, X:X, Y:Y, P:P};
  }
  return null;
}
function suggestBlock(){
  var fi = faceInfo(job.body, job.face), c = job.cap;
  for (var i=0; i<120; i++){
    var L = c.L != null ? c.L : rnd(fi.su*0.25, fi.su*0.6);
    var W = c.W != null ? c.W : rnd(fi.sv*0.25, fi.sv*0.6);
    var H = c.H != null ? c.H : rnd(5, Math.min(30, Math.max(6, Math.max(fi.su, fi.sv)*0.4)));
    var X = c.X != null ? c.X : (Math.random() < 0.3 ? 0 : rnd(0, Math.max(0, fi.su - L)));
    var Y = c.Y != null ? c.Y : (Math.random() < 0.3 ? 0 : rnd(0, Math.max(0, fi.sv - W)));
    var b = placeBlock({id:-1, parent:job.body, face:job.face, cs:job.cs, L:L, W:W, H:H, X:X, Y:Y});
    var pr = blockProblems(b);
    if (!pr.e.length && (!pr.w.length || i > 90)) return {L:L, W:W, H:H, X:X, Y:Y};
  }
  return null;
}
function jobSim(){
  if (!job || job.stage !== 'measure' || jobBusy) return;
  var g = job.kind === 'hole' ? suggestHole() : suggestBlock();
  if (!g){ logLine('No encontré un lugar libre en esta cara para simular el ' + K().title.toLowerCase() + '.', 'e'); return; }
  logLine('— ' + K().title + ': medición simulada —', 's');
  simulate(K().keys().filter(function(k){ return job.cap[k] == null; }).map(function(k){ return g[k]; }));
}
function jobManual(){
  if (!job || !job.cs || jobBusy) return;
  stopSim();
  var kd = K(), saved = job.cap, ks = kd.keys(); job.cap = {}; $(kd.checks).innerHTML = '';
  for (var i=0; i<ks.length; i++){
    var k = ks[i], txt = String($(kd.inp + k).value).replace(',', '.').trim();
    if (job.kind === 'block' && (k === 'X' || k === 'Y') && txt === '') txt = '0';   // vacío = pegado
    var v = parseFloat(txt);
    var msg = isNaN(v) ? 'escribe un número en mm' : checkCapture(k, v);
    if (msg){ job.cap = saved; addCheck('bad', '✕ ' + kd.lbl[k] + ': ' + msg + '.'); jobUI(); return; }
    job.cap[k] = Math.round(v*100)/100;
  }
  var c = job.cap;
  logLine(job.kind === 'hole'
    ? 'Agujero manual: Ø' + c.D.toFixed(2) + ', X ' + c.X.toFixed(2) + ', Y ' + c.Y.toFixed(2) + (job.through ? ', pasante' : ', prof. ' + c.P.toFixed(2))
    : 'Bloque manual: ' + c.L.toFixed(2) + ' × ' + c.W.toFixed(2) + ' × ' + c.H.toFixed(2) + ' mm, X ' + c.X.toFixed(2) + ', Y ' + c.Y.toFixed(2), 's');
  toPreview();
}

/* ---------- Perforar ---------- */
function drillAnim(h){
  return new Promise(function(res){
    var fi = faceInfo(h.body, h.face), P = holeCenter(h), r = h.D/2;
    drillRing.scale.set(r, r, 1); drillRing.quaternion.setFromUnitVectors(Z_FWD, fi.N); drillRing.position.copy(P); drillRing.visible = true;
    for (var i=0; i<CHIPS; i++){
      var o = i*3, a = Math.random()*Math.PI*2, rr = r*Math.sqrt(Math.random());
      var p = P.clone().addScaledVector(fi.U, Math.cos(a)*rr).addScaledVector(fi.V, Math.sin(a)*rr);
      var vel = fi.N.clone().multiplyScalar(18 + Math.random()*30).addScaledVector(fi.U, Math.cos(a)*(10 + Math.random()*25)).addScaledVector(fi.V, Math.sin(a)*(10 + Math.random()*25));
      vel.y += 10 + Math.random()*20;
      chipPos[o] = p.x; chipPos[o+1] = p.y; chipPos[o+2] = p.z; chipVel[o] = vel.x; chipVel[o+1] = vel.y; chipVel[o+2] = vel.z;
    }
    chipGeo.attributes.position.needsUpdate = true; chips.visible = !REDUCED; chipMat.opacity = 0.9;
    drill = {t0:performance.now(), last:performance.now(), P:P, N:fi.N, d:holeDepth(h), res:res};
  });
}
function stepDrill(){
  var now = performance.now(), de = clamp01((now - drill.t0)/(REDUCED ? 60 : 1100)), dt = Math.min(0.05, (now - drill.last)/1000);
  drill.last = now;
  drillRing.position.copy(drill.P).addScaledVector(drill.N, -drill.d*ease(de) + 0.05);
  drillRing.material.opacity = 0.95 - 0.5*de;
  for (var c=0;c<CHIPS;c++){ var q = c*3; chipVel[q+1] -= 140*dt; chipPos[q] += chipVel[q]*dt; chipPos[q+1] += chipVel[q+1]*dt; chipPos[q+2] += chipVel[q+2]*dt; }
  chipGeo.attributes.position.needsUpdate = true; chipMat.opacity = 0.9*(1 - easeOut(de));
  if (de >= 1){ drillRing.visible = false; chips.visible = false; var dr = drill.res; drill = null; dr(); }
}

/* ---------- Levantar un bloque: las partículas se juntan sobre la cara y aparece el sólido ---------- */
var BUILD = {cloud:0.6, show:0.5, end:0.95};
function buildAnim(b){
  return new Promise(function(res){
    seedParticles([b]);
    points.visible = true; pMat.uniforms.uProg.value = 0; pMat.uniforms.uAlpha.value = 0; pMat.uniforms.uJit.value = 0;
    build = {t0:performance.now() - (REDUCED ? 10000 : 0), b:b, added:false, res:res};
  });
}
function stepBuild(t){
  var e = (performance.now() - build.t0)/1000;
  pMat.uniforms.uProg.value = clamp01(e/BUILD.cloud); pMat.uniforms.uTime.value = t;
  pMat.uniforms.uAlpha.value = 0.85*easeOut(clamp01(e/0.12))*(1 - ease(clamp01((e - BUILD.show)/(BUILD.end - BUILD.show))));
  if (!build.added && e >= BUILD.show){
    build.added = true; bodies.push(build.b); rebuildSolid(); flashT = clock.getElapsedTime(); metrics(1);
  }
  if (e >= BUILD.end){ points.visible = false; var r = build.res; build = null; r(); }
}

async function confirmJob(){
  if (!job || job.stage !== 'preview' || jobBusy || !job.pr || job.pr.e.length) return;
  setJobBusy(true); job.stage = 'busy';
  prompt(null);
  if (job.kind === 'hole'){
    var h = jobHole(), fi = faceInfo(h.body, h.face);
    setState('Perforando', 'work');
    await drillAnim(h);
    h.seq = nextSeq++; holes.push(h); nextId++;
    rebuildSolid(); flashT = clock.getElapsedTime();
    logLine('Agujero #' + h.id + ': Ø' + h.D.toFixed(2) + ' en cara ' + faceLabel(h.body, h.face) + ', centro a X ' + (h.X + h.D/2).toFixed(2) + ' · Y ' + (h.Y + h.D/2).toFixed(2) +
            ' mm de la esquina ' + (h.ci + 1) + ', ' + (h.through ? 'pasante' : 'ciego de ' + h.depth.toFixed(2) + ' mm'), 'c');
  } else {
    var b = jobBlock(); b.seq = nextSeq++;
    setState('Levantando bloque', 'work');
    await buildAnim(b);
    nextBlockId++;
    logLine('Bloque B' + b.id + ': ' + b.L.toFixed(2) + ' × ' + b.W.toFixed(2) + ' × ' + b.H.toFixed(2) + ' mm en cara ' + faceLabel(b.parent, b.face) +
            ', a X ' + b.X.toFixed(2) + ' · Y ' + b.Y.toFixed(2) + ' mm de la esquina ' + (b.ci + 1), 'c');
  }
  metrics(1); renderDetails();
  setJobBusy(false); endJob(); saveCurrent();
}
function endJob(){
  stopSim();
  var panel = job ? K().panel : null;
  job = null;
  cornerMeshes.forEach(function(m){ m.visible = false; }); axX.visible = axY.visible = false;
  updateJobGhost(); hideH('h');
  if (panel) $(panel).hidden = true;
  $('boxCtl').hidden = false; $('holeSec').hidden = false;
  $('readout').classList.remove('live'); $('liveLbl').textContent = 'Sin cota activa';
  prompt(null); setState('Pieza lista', 'ok'); whatIdle();
  deselect(); fitAll(); stepUI(); lastInput = performance.now();
}
function cancelJob(){ if (!job || jobBusy) return; logLine(K().title + ' cancelado', 's'); endJob(); }
function removeBlock(id){
  // quita el bloque, los bloques apoyados en él y sus agujeros
  var gone = [id], grew = true;
  while (grew){ grew = false; bodies.forEach(function(b){ if (b.parent != null && gone.indexOf(b.parent) >= 0 && gone.indexOf(b.id) < 0){ gone.push(b.id); grew = true; } }); }
  bodies = bodies.filter(function(b){ return gone.indexOf(b.id) < 0; });
  holes = holes.filter(function(h){ return gone.indexOf(h.body) < 0; });
  if (gone.indexOf(curBody) >= 0) curBody = 0;
  return gone;
}
/* ==========================================================================
   Árbol del modelo: cada sólido o corte con su sketch. Cada cota se edita
   midiéndola otra vez con el vernier (M: en vivo, C: fija); teclear es el respaldo.
   ========================================================================== */
var edit = null, hover = null;
var EDIT_LBL = {base:{L:'largo', W:'ancho', H:'alto'},
                block:{L:'largo', W:'ancho', H:'alto', X:'distancia X', Y:'distancia Y'},
                hole:{D:'diámetro', X:'distancia X', Y:'distancia Y', P:'profundidad'}};
var EDIT_WHAT = {base:'box', block:'block', hole:'hole'};
function holeById(id){ for (var i=0; i<holes.length; i++) if (holes[i].id === id) return holes[i]; return null; }
function deName(kind, id){ return kind === 'base' ? 'de la base' : kind === 'block' ? 'de B' + id : 'del agujero #' + id; }
function getVal(kind, id, key){
  if (kind === 'base') return cap[key];
  if (kind === 'block') return B(id)[key];
  var h = holeById(id); return key === 'P' ? h.depth : h[key];
}
function setVal(kind, id, key, v){
  if (kind === 'base'){ cap[key] = v; dims[key] = v; live[key] = v; setSolidScale(cap.L, cap.W, cap.H); }
  else if (kind === 'block'){ B(id)[key] = v; syncBodies(); rebuildSolid(); }
  else { var h = holeById(id); if (key === 'P') h.depth = v; else h[key] = v; rebuildSolid(); }
  metrics(1); renderDetails();
}
function okRange(e, v){
  var zeroOk = e.kind === 'block' && (e.key === 'X' || e.key === 'Y');
  return (zeroOk ? v >= 0 : v > 0) && v <= MAX_MM;
}
function validateAll(){
  var e = [];
  blocks().forEach(function(b){ blockProblems(b).e.forEach(function(t){ e.push('B' + b.id + ': ' + t); }); });
  holes.forEach(function(h){ problems(h).e.forEach(function(t){ e.push('#' + h.id + ': ' + t); }); });
  return e;
}
function startEdit(kind, id, key){
  if (mode !== 'done' || busy || job || build || jobBusy) return;
  if (edit) cancelEdit(true);
  stopSim(); deselect();
  edit = {kind:kind, id:id, key:key, old:getVal(kind, id, key), live:null, prevThrough:null};
  var lbl = EDIT_LBL[kind][key];
  whatKey(EDIT_WHAT[kind] + '.' + key);
  prompt('Mide el ' + lbl.toUpperCase() + ' ' + deName(kind, id).toUpperCase() + ' y presiona Capturar');
  setState('Editando ' + lbl, 'live');
  readoutLive(edit.old, 'Editando ' + lbl + ' ' + deName(kind, id), false);
  logLine('Editar ' + lbl + ' ' + deName(kind, id) + ' (antes ' + edit.old.toFixed(2) + ' mm)', 's');
  editUI(); renderDetails(); stepUI(); faceBtnsUI();
}
function editMessage(modo, v, line){
  var lbl = EDIT_LBL[edit.kind][edit.key];
  if (modo === 'M'){
    edit.live = v; readoutLive(v, 'Editando ' + lbl + ' ' + deName(edit.kind, edit.id), false); logLine(line, 'm');
    if (okRange(edit, v)) setVal(edit.kind, edit.id, edit.key, v);
    editUI(); return;
  }
  commitEdit(v, line);
}
function rejectEdit(msg){
  setVal(edit.kind, edit.id, edit.key, edit.old);
  $('ebErr').textContent = msg; logLine('Rechazado: ' + msg, 'e'); setState('Cambio rechazado', 'bad');
  edit.live = null; editUI();
}
function commitEdit(v, line){
  if (!edit) return;
  var e = edit, lbl = EDIT_LBL[e.kind][e.key];
  v = Math.round(v*100)/100;
  if (!okRange(e, v)){ rejectEdit(lbl + ' de ' + v.toFixed(2) + ' mm está fuera del rango del vernier (0–150 mm).'); return; }
  setVal(e.kind, e.id, e.key, v);
  var errs = validateAll();
  if (errs.length){ rejectEdit(errs[0]); return; }
  if (e.kind === 'hole' && e.key === 'P'){
    var h = holeById(e.id);
    if (Math.abs(v - holeRun(h)) <= 0.05){ h.through = true; h.depth = null; rebuildSolid(); logLine('La profundidad llega al final del material: se toma como pasante.', 'c'); }
  }
  logLine(line + '   ✔ ' + lbl + ' ' + deName(e.kind, e.id) + ': ' + e.old.toFixed(2) + ' → ' + v.toFixed(2) + ' mm', 'c');
  readoutLive(v, lbl + ' actualizado', true);
  flashT = clock.getElapsedTime();
  edit = null; endEditUI(); saveCurrent();
}
function cancelEdit(quiet){
  if (!edit) return;
  stopSim();
  var e = edit;
  if (e.prevThrough != null){ var h = holeById(e.id); if (h){ h.through = true; h.depth = null; } rebuildSolid(); metrics(1); }
  else setVal(e.kind, e.id, e.key, e.old);
  edit = null;
  if (!quiet){ logLine('Edición cancelada', 's'); endEditUI(); }
}
function endEditUI(){
  $('editBar').hidden = true; $('ebErr').textContent = ''; hideH('e');
  prompt(null); setState('Pieza lista', 'ok'); whatIdle();
  $('readout').classList.remove('live');
  renderDetails(); stepUI(); faceBtnsUI(); lastInput = performance.now();
}
function editUI(){
  if (!edit) return;
  var lbl = EDIT_LBL[edit.kind][edit.key];
  $('editBar').hidden = false;
  $('ebName').textContent = 'Editando ' + lbl + ' ' + deName(edit.kind, edit.id);
  $('ebOld').textContent = (edit.prevThrough ? 'Era pasante' : 'Antes ' + edit.old.toFixed(2) + ' mm') + (edit.live != null ? ' · ahora ' + edit.live.toFixed(2) : '');
  $('ebZero').hidden = !(edit.kind === 'block' && (edit.key === 'X' || edit.key === 'Y'));
  $('ebCap').disabled = edit.live == null;
  $('ebSim').disabled = source === 'serial';
}
/* simulador: una medición cercana al valor actual que sí sea válida */
function editSim(){
  if (!edit) return;
  var e = edit, pick = null;
  for (var i=0; i<40 && pick == null; i++){
    var v = e.old > 0.5 ? rnd(e.old*0.85, e.old*1.15) : rnd(0.5, 4);
    setVal(e.kind, e.id, e.key, v);
    if (!validateAll().length) pick = v;
  }
  setVal(e.kind, e.id, e.key, e.old);
  if (pick == null){ $('ebErr').textContent = 'No encontré un valor cercano que siga siendo válido.'; return; }
  $('ebErr').textContent = ''; logLine('— Edición: medición simulada —', 's');
  simulate([pick]);
}
/* pasante ↔ ciego: al volverse ciego se mide la profundidad */
function toggleThrough(id){
  if (mode !== 'done' || busy || job || build || jobBusy) return;
  var h = holeById(id); if (!h) return;
  if (edit) cancelEdit(true);
  if (h.through){
    h.through = false; h.depth = Math.round(holeRun(h)*50)/100;
    startEdit('hole', id, 'P'); edit.prevThrough = true; editUI();
    logLine('Agujero #' + id + ': pasa a ciego; mide la profundidad con la varilla', 's');
  } else {
    var before = h.depth; h.through = true; h.depth = null; rebuildSolid(); metrics(1);
    var errs = validateAll();
    if (errs.length){ h.through = false; h.depth = before; rebuildSolid(); metrics(1); logLine('Rechazado: ' + errs[0], 'e'); }
    else { logLine('Agujero #' + id + ': ahora pasante (' + holeRun(h).toFixed(2) + ' mm)', 'c'); saveCurrent(); }
    renderDetails();
  }
}
/* resaltado del elemento en edición o bajo el puntero */
var hlBox = new THREE.LineSegments(edgeGeoC, new THREE.LineBasicMaterial({color:COL.live, depthTest:false, transparent:true}));
var hlRing = ringLine(new THREE.Vector3(), Z_FWD, 1, new THREE.LineBasicMaterial({color:COL.live, depthTest:false}));
hlBox.renderOrder = hlRing.renderOrder = 7; hlBox.visible = hlRing.visible = false; scene.add(hlBox); scene.add(hlRing);
function updateHighlight(t){
  var f = edit || hover;
  hlBox.visible = hlRing.visible = false; hideH('e');
  if (!f || mode !== 'done' || job) return;
  var val = edit ? (edit.live != null ? edit.live : getVal(edit.kind, edit.id, edit.key)) : null;
  if (f.kind === 'hole'){
    var h = holeById(f.id); if (!h) return;
    var ax = holeAxis(h);
    hlRing.position.copy(ax.P).addScaledVector(ax.N, 0.15); hlRing.quaternion.setFromUnitVectors(Z_FWD, ax.N);
    hlRing.scale.set(h.D/2 + 0.6, h.D/2 + 0.6, 1); hlRing.visible = true;
    if (edit) setH('e1', ax.P.clone().addScaledVector(ax.N, 3), '<small>' + EDIT_LBL.hole[edit.key].toUpperCase() + '</small>' + val.toFixed(2), 'live');
  } else {
    var b = B(f.kind === 'base' ? 0 : f.id); if (!b) return;
    var size = b.max.clone().sub(b.min);
    hlBox.position.copy(b.min).add(b.max).multiplyScalar(0.5);
    hlBox.scale.set(size.x + 0.4, size.y + 0.4, size.z + 0.4); hlBox.visible = true;
    hlBox.material.opacity = edit ? 0.95 : 0.55 + Math.sin(t*6)*0.2;
    if (edit && f.kind === 'block') setH('e1', new THREE.Vector3(hlBox.position.x, b.max.y + 4, hlBox.position.z), '<small>' + EDIT_LBL.block[edit.key].toUpperCase() + '</small>' + val.toFixed(2), 'live');
  }
}

function chip(kind, id, key, txt, val, extra){
  var on = edit && edit.kind === kind && edit.id === id && edit.key === key;
  return '<button type="button" class="cv' + (on ? ' on' : '') + (extra || '') + '" data-kind="' + kind + '" data-id="' + id + '" data-key="' + key + '"' +
         ' title="' + (key === 'T' ? 'Cambiar entre pasante y ciego' : 'Editar midiendo con el vernier') + '">' + (txt ? '<small>' + txt + '</small>' : '') + val + '</button>';
}
function renderDetails(){
  var ol = $('holeList'); ol.innerHTML = ''; hideH('n'); hideH('b');
  if (!bodies.length || cap.L == null) return;
  var fmtv = function(v){ return v == null ? '--.--' : v.toFixed(2); };
  var base = bodies[0], bs = base.max.clone().sub(base.min);
  var items = [{seq:1, kind:'base', id:0, html:
    '<div class="nh"><i>▣</i><b>Base</b><span>caja · ' + (bs.x*bs.y*bs.z/1000).toFixed(2) + ' cm³</span></div>' +
    '<div class="sk"><em>Sketch 1</em> rectángulo en el piso</div>' +
    '<div class="cvs">' + chip('base', 0, 'L', 'L', fmtv(cap.L)) + chip('base', 0, 'W', 'A', fmtv(cap.W)) + '</div>' +
    '<div class="op">Extrusión ' + chip('base', 0, 'H', 'H', fmtv(cap.H)) + '</div>'}];
  blocks().forEach(function(b){
    items.push({seq:b.seq || 99, kind:'block', id:b.id, html:
      '<div class="nh"><i>▣</i><b>Bloque B' + b.id + '</b><span>' + (b.L*b.W*b.H/1000).toFixed(2) + ' cm³</span>' +
      '<button type="button" class="del" data-del="block" data-id="' + b.id + '" aria-label="Quitar bloque B' + b.id + '">×</button></div>' +
      '<div class="sk"><em>Sketch ' + (b.seq || '?') + '</em> rectángulo en cara ' + faceLabel(b.parent, b.face) + ' · esq. ' + (b.ci + 1) + '</div>' +
      '<div class="cvs">' + chip('block', b.id, 'L', 'L', fmtv(b.L)) + chip('block', b.id, 'W', 'A', fmtv(b.W)) +
        chip('block', b.id, 'X', 'X', b.X === 0 ? 'pegado' : fmtv(b.X)) + chip('block', b.id, 'Y', 'Y', b.Y === 0 ? 'pegado' : fmtv(b.Y)) + '</div>' +
      '<div class="op">Extrusión ' + chip('block', b.id, 'H', 'H', fmtv(b.H)) + '</div>'});
    setH('b' + b.id, b.min.clone().add(b.max).multiplyScalar(0.5).addScaledVector(v3(FACES[b.face].N), (b.H/2) + 2.5), 'B' + b.id, 'num');
  });
  holes.forEach(function(h){
    var run = holeRun(h);
    items.push({seq:h.seq || 99, kind:'hole', id:h.id, html:
      '<div class="nh"><i class="cut">◯</i><b>Agujero #' + h.id + '</b><span>−' + (Math.PI*h.D*h.D/4*holeDepth(h)/1000).toFixed(2) + ' cm³</span>' +
      '<button type="button" class="del" data-del="hole" data-id="' + h.id + '" aria-label="Quitar agujero ' + h.id + '">×</button></div>' +
      '<div class="sk"><em>Sketch ' + (h.seq || '?') + '</em> círculo en cara ' + faceLabel(h.body, h.face) + ' · esq. ' + (h.ci + 1) + '</div>' +
      '<div class="cvs">' + chip('hole', h.id, 'D', 'Ø', fmtv(h.D)) + chip('hole', h.id, 'X', 'X', fmtv(h.X)) + chip('hole', h.id, 'Y', 'Y', fmtv(h.Y)) + '</div>' +
      '<div class="op">Corte ' + chip('hole', h.id, 'T', '', h.through ? 'pasante' : 'ciego', ' type') +
        (h.through ? '<span class="ro">' + run.toFixed(2) + ' mm</span>' : chip('hole', h.id, 'P', 'P', fmtv(h.depth))) + '</div>'});
    setH('n' + h.id, holeCenter(h).addScaledVector(faceInfo(h.body, h.face).N, 2.5), '#' + h.id, 'num');
  });
  items.sort(function(a, b){ return a.seq - b.seq; });
  items.forEach(function(it){
    var li = document.createElement('li');
    li.className = 'node' + (edit && edit.kind === it.kind && edit.id === it.id ? ' editing' : '');
    li.dataset.kind = it.kind; li.dataset.id = it.id; li.innerHTML = it.html;
    ol.appendChild(li);
  });
  $('mHoles').textContent = holes.length;
  $('mBlocks').textContent = Math.max(0, bodies.length - 1);
}

/* ---------- Guardado en mediciones/mediciones.json ---------- */
function r2(v){ return v == null ? null : Math.round(v*100)/100; }
function holeRecord(h){
  return {id:h.id, sketch:h.seq, cuerpo:h.body, cara:FACES[h.face].name.toLowerCase(), esquina:h.ci + 1, diametro_mm:r2(h.D),
          x_pared_mm:r2(h.X), y_pared_mm:r2(h.Y), x_centro_mm:r2(h.X + h.D/2), y_centro_mm:r2(h.Y + h.D/2),
          tipo:h.through ? 'pasante' : 'ciego', profundidad_mm:r2(holeDepth(h))};
}
function blockRecord(b){
  return {id:b.id, sketch:b.seq, base:b.parent, cara:FACES[b.face].name.toLowerCase(), esquina:b.ci + 1,
          largo_mm:r2(b.L), ancho_mm:r2(b.W), alto_mm:r2(b.H), x_orilla_mm:r2(b.X), y_orilla_mm:r2(b.Y)};
}
function saveCurrent(){
  if (!current){
    if (!holes.length && bodies.length < 2) return;
    current = {id:null, fecha:null, figura:'caja', fuente:'ejemplo', guiada:false, largo_mm:cap.L, ancho_mm:cap.W, alto_mm:cap.H, cuerpos:[], agujeros:[]};
  }
  if (!current.id){
    var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
    current.fecha = d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    current.id = current.fecha + '.' + String(d.getMilliseconds()).padStart(3,'0');
  }
  current.cuerpos = blocks().map(blockRecord);
  current.agujeros = holes.map(holeRecord);
  current.largo_mm = cap.L; current.ancho_mm = cap.W; current.alto_mm = cap.H;   // la base pudo editarse
  var rec = {}; for (var k in current) if (k !== 'guiada') rec[k] = current[k];
  ['largo_mm','ancho_mm','alto_mm'].forEach(function(k){ rec[k] = r2(rec[k]); });
  if (!send({cmd:'guardar', medicion:rec})){
    pendingSave = rec;
    logLine('Sin servidor: la medición se guardará al reconectar.', 'e');
  }
}

/* ---------- Fuente de medidas ---------- */
function srcName(s){ return s === 'serial' || s === 'esp32' ? 'esp32' : s === 'local' ? 'simulador' : s; }
function setSource(s, fromServer){
  if (s === source && !fromServer && !firstLoad) return;
  if (edit && !firstLoad) cancelEdit();
  if (mode === 'measuring' && s !== source) cancelMeasure();
  stopSim();
  source = s;
  try { localStorage.setItem('vernier3d.fuente', s); } catch (e){}
  Array.prototype.forEach.call(document.querySelectorAll('#srcBtns button'), function(b){
    var on = b.dataset.src === s; b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
  $('serialBox').hidden = s !== 'serial';
  $('guidedCtl').hidden = s === 'manual';
  $('manualCtl').hidden = s !== 'manual';
  if (!fromServer) send({cmd:'fuente', nombre:s, puerto:$('selPort').value});
  if (s === 'serial') send({cmd:'puertos'});
  if (!firstLoad) logLine('Fuente: ' + (s === 'serial' ? 'ESP32 por USB' : s), 's');
  pipeUI(); serialUI(); if (mode === 'done' && !job) whatIdle(); jobUI();
}

/* ---------- Controles ---------- */
FACE_KEYS.forEach(function(k){
  var b = document.createElement('button'); b.type = 'button'; b.id = 'fb_' + k; b.textContent = FACES[k].name;
  b.addEventListener('click', function(){ if (canSelectFace()) selectFace(B(curBody) ? curBody : 0, k); });
  $('faceBtns').appendChild(b);
});
Array.prototype.forEach.call(document.querySelectorAll('#srcBtns button'), function(b){
  b.addEventListener('click', function(){ setSource(b.dataset.src); });
});
$('selPort').addEventListener('change', function(){ if (source === 'serial') send({cmd:'fuente', nombre:'serial', puerto:this.value}); });
$('btnPorts').addEventListener('click', function(){ if (!send({cmd:'puertos'})) logLine('Sin servidor: no puedo buscar puertos.', 'e'); });
$('btnHole').addEventListener('click', function(){ if (sel) startJob('hole', sel.body, sel.k); });
$('btnBlock').addEventListener('click', function(){ if (sel) startJob('block', sel.body, sel.k); });
$('fmHole').addEventListener('click', function(){ if (sel) startJob('hole', sel.body, sel.k); });
$('fmBlock').addEventListener('click', function(){ if (sel) startJob('block', sel.body, sel.k); });
for (var cbi=0; cbi<4; cbi++) (function(i){
  $('cb' + i).addEventListener('click', function(){ chooseCorner(i); });
  $('bc' + i).addEventListener('click', function(){ chooseCorner(i); });
})(cbi);
$('tThrough').addEventListener('click', function(){ setType(true); });
$('tBlind').addEventListener('click', function(){ setType(false); });
['H','B'].forEach(function(p){
  $('btn' + p + 'Sim').addEventListener('click', jobSim);
  $('btn' + p + 'Cap').addEventListener('click', captureNow);
  $('btn' + p + 'Man').addEventListener('click', jobManual);
  $('btn' + p + 'Ok').addEventListener('click', confirmJob);
  $('btn' + p + 'Redo').addEventListener('click', function(){ if (!job || jobBusy) return; stopSim(); job.cap = {}; job.live = {}; job.sm = {}; logLine(K().title + ': medir de nuevo', 's'); advance(); });
  $('btn' + p + 'Cancel').addEventListener('click', cancelJob);
});
$('hForm').addEventListener('submit', function(e){ e.preventDefault(); jobManual(); });
$('bForm').addEventListener('submit', function(e){ e.preventDefault(); jobManual(); });
$('btnBX0').addEventListener('click', function(){ stickTo('X'); });
$('btnBY0').addEventListener('click', function(){ stickTo('Y'); });
$('holeList').addEventListener('click', function(e){
  if (job || busy || jobBusy || build || mode !== 'done') return;
  var c = e.target.closest('button.cv');
  if (c){
    var kind = c.dataset.kind, id = +c.dataset.id, key = c.dataset.key;
    if (key === 'T') toggleThrough(id);
    else if (edit && edit.kind === kind && edit.id === id && edit.key === key) cancelEdit();
    else startEdit(kind, id, key);
    return;
  }
  var d = e.target.closest('button.del'); if (!d) return;
  if (edit) cancelEdit(true);
  var did = +d.dataset.id;
  if (d.dataset.del === 'block'){
    var gone = removeBlock(did);
    logLine('Bloque' + (gone.length > 1 ? 's ' + gone.map(function(g){ return 'B' + g; }).join(', ') : ' B' + did) + ' quitado' + (gone.length > 1 ? 's' : ''), 's');
  } else { holes = holes.filter(function(h){ return h.id !== did; }); logLine('Agujero #' + did + ' quitado', 's'); }
  hover = null; deselect(); rebuildSolid(); metrics(1); endEditUI(); saveCurrent();
});
$('holeList').addEventListener('mouseover', function(e){
  var li = e.target.closest('li.node'); hover = li ? {kind:li.dataset.kind, id:+li.dataset.id} : null;
});
$('holeList').addEventListener('mouseleave', function(){ hover = null; });
$('ebCap').addEventListener('click', captureNow);
$('ebSim').addEventListener('click', editSim);
$('ebZero').addEventListener('click', function(){ if (edit){ stopSim(); commitEdit(0, 'pegado (0)'); } });
$('ebCancel').addEventListener('click', function(){ cancelEdit(); });
$('ebForm').addEventListener('submit', function(e){
  e.preventDefault(); if (!edit) return;
  var v = parseFloat(String($('ebIn').value).replace(',', '.')); $('ebIn').value = '';
  if (isNaN(v)){ $('ebErr').textContent = 'Escribe un número en mm.'; return; }
  stopSim(); commitEdit(v, 'manual ' + v.toFixed(2));
});
$('btnNew').addEventListener('click', startMeasure);
/* pantalla completa: botón o tecla F */
function toggleFs(){
  var d = document;
  if (!d.fullscreenElement){ if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(function(){ logLine('El navegador no permitió la pantalla completa.', 'e'); }); }
  else if (d.exitFullscreen) d.exitFullscreen();
}
$('btnFs').addEventListener('click', toggleFs);
document.addEventListener('fullscreenchange', function(){
  var on = !!document.fullscreenElement;
  $('fsTxt').textContent = on ? 'Salir' : 'Pantalla completa'; $('fsIc').textContent = on ? '✕' : '⛶';
});
$('btnCap').addEventListener('click', captureNow);
$('btnRedoAx').addEventListener('click', redoAxis);
$('btnStop').addEventListener('click', cancelMeasure);
$('btnGen').addEventListener('click', manual);
$('btnReplay').addEventListener('click', replay);
$('manForm').addEventListener('submit', function(e){ e.preventDefault(); manual(); });
$('conForm').addEventListener('submit', function(e){
  e.preventDefault();
  var line = $('conIn').value; if (!line.trim()) return;
  $('conIn').value = '';
  if (!send({cmd:'linea', linea:line})){
    var m = /^([MC]):(-?\d+(?:\.\d+)?)$/.exec(line.trim());
    if (m) onLectura(m[1], parseFloat(m[2]), line.trim(), 'consola');
    else { packets++; lastPacket = line; logLine('Ignorado (formato inválido): ' + line, 'e'); }
  }
});
document.addEventListener('keydown', function(e){
  var tag = (e.target && e.target.tagName) || '';
  if ((e.key === 'f' || e.key === 'F') && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); toggleFs(); return; }
  if (e.key === 'Escape'){ if (edit) cancelEdit(); else if (job) cancelJob(); else if (sel) deselect(); }
  if ((e.key === ' ' || e.code === 'Space') && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)){ e.preventDefault(); captureNow(); }
});

/* ---------- Estado inicial: pieza de ejemplo ya armada ---------- */
var firstLoad = true;
var savedSrc = null; try { savedSrc = localStorage.getItem('vernier3d.fuente'); } catch (e){}
bodies = [baseBody(50, 30, 20)];
setSource(savedSrc === 'manual' || savedSrc === 'serial' ? savedSrc : 'simulador', true);
firstLoad = false;
cap = {L:50, W:30, H:20};
showPiece(); fitAll(true);
logLine('Pieza de ejemplo cargada. Presiona “Nueva medición” para ver el flujo completo.', 's');
resize(); pipeUI(); connect(); frame();
})();
