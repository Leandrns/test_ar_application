import * as THREE from 'https://unpkg.com/three@0.179.1/build/three.module.js';
import { ARButton } from 'https://unpkg.com/three@0.179.1/examples/jsm/webxr/ARButton.js';

// Variáveis globais
let camera, scene, renderer;
let controller, reticle;
let hitTestSource = null;
let localReferenceSpace = null;

// Sistema de calibração
let pontoReferencia = null;
let calibrado = false;
let pontosCreated = 0;
let pontosCarregados = [];
let botaoAR = null

// Modo atual
let currentMode = 'home'; // 'home', 'admin', 'user'

// QR Scanner
let qrStream = null;
let qrScanning = false;

// Inicialização
window.addEventListener('load', () => {
    updateHomeStats();
});

// NAVEGAÇÃO ENTRE TELAS
window.enterAdminMode = function() {
    currentMode = 'admin';
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('admin-screen').style.display = 'block';
    setupQRCalibration('admin');
}

window.enterUserMode = function() {
    currentMode = 'user';
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('user-screen').style.display = 'block';
    setupQRCalibration('user');
    updateUserStats();
}

window.goHome = function() {
    // Limpar AR
    if (renderer && renderer.xr && renderer.xr.getSession()) {
    renderer.xr.getSession().end();
    }
    
    // Parar QR scanner se ativo
    stopQRScanning();
    
    // Resetar estado
    calibrado = false;
    pontoReferencia = null;
    pontosCarregados = [];
    
    // Mostrar tela inicial
    document.getElementById('admin-screen').style.display = 'none';
    document.getElementById('user-screen').style.display = 'none';
    document.getElementById('home-screen').style.display = 'flex';
    
    currentMode = 'home';
    updateHomeStats();
}

function updateHomeStats() {
    const pontos = JSON.parse(localStorage.getItem('pontos') || '[]');
    const eventos = [...new Set(pontos.map(p => p.qrReferencia))];
    
    const infoEl = document.getElementById('stored-points-info');
    if (pontos.length === 0) {
    infoEl.innerHTML = 'Nenhum ponto salvo ainda';
    } else {
    infoEl.innerHTML = `
        📍 ${pontos.length} pontos salvos<br>
        🎪 ${eventos.length} eventos registrados
    `;
    }
}

function updateUserStats() {
    const pontos = JSON.parse(localStorage.getItem('pontos') || '[]');
    const eventos = [...new Set(pontos.map(p => p.qrReferencia))];
    
    document.getElementById('user-points-available').textContent = 
    `Pontos disponíveis: ${pontos.length}`;
    document.getElementById('user-events-available').textContent = 
    `Eventos: ${eventos.length}`;
    
    const eventoAtual = pontoReferencia ? pontoReferencia.qrCode : 'Nenhum';
    document.getElementById('user-current-event').textContent = 
    `Evento atual: ${eventoAtual}`;
}

// INICIALIZAÇÃO AR
function initAR() {
    const container = document.createElement('div');
    const activeScreen = currentMode === 'admin' 
    ? document.getElementById('admin-screen') 
    : document.getElementById('user-screen');
    activeScreen.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.01, 20);

    // Luzes
    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    container.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // Reticle
    const geometry = new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI/2);
    const material = new THREE.MeshBasicMaterial({ 
    color: currentMode === 'admin' ? 0x00ff00 : 0x4ecdc4 
    });
    reticle = new THREE.Mesh(geometry, material);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Controller
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    // Event listeners
    window.addEventListener('resize', onWindowResize);
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    animate();
}

// QR CODE SETUP
function setupQRCalibration(mode) {
    const calibrateBtn = document.getElementById(mode === 'admin' ? 'calibrate-btn' : 'user-calibrate-btn');
    const cancelBtn = document.getElementById('cancel-qr');

    calibrateBtn.addEventListener('click', startQRScanning);
    cancelBtn.addEventListener('click', stopQRScanning);
}

async function startQRScanning() {
    try {
    const qrScanner = document.getElementById('qr-scanner');
    const video = document.getElementById('qr-video');

    qrScanner.style.display = 'flex';
    qrScanning = true;

    qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
    });

    video.srcObject = qrStream;
    video.play();

    scanQRCode(video);

    } catch (error) {
    console.error('Erro ao acessar câmera:', error);
    alert('Não foi possível acessar a câmera');
    stopQRScanning();
    }
}

function scanQRCode(video) {
    if (!qrScanning) return;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    function tick() {
    if (!qrScanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
        processQRCode(code.data);
        return;
        }
    }

    requestAnimationFrame(tick);
    }
    tick();
}

function processQRCode(qrData) {
    console.log('QR Code detectado:', qrData);

    if (qrData.length > 3) {
    definirPontoReferencia(qrData);
    stopQRScanning();
    } else {
    alert('QR Code inválido. Use um QR Code válido.');
    }
}

function definirPontoReferencia(qrData) {
    pontoReferencia = {
    qrCode: qrData,
    timestamp: Date.now(),
    gps: null,
    arPosition: null
    };

    calibrado = true;
    updateCalibrationUI();
    
    if (currentMode === 'user') {
    updateUserStats();
    }
    
    console.log('Sistema calibrado com QR Code:', qrData);
    alert(`Calibração realizada!\nEvento: ${qrData}\nEntre no modo AR para ${currentMode === 'admin' ? 'criar pontos' : 'visualizar pontos'}.`);

    // start AR aqui
    initAR();

    botaoAR = document.getElementById("ARButton");

    if (botaoAR) {
        console.log('Iniciando AR automaticamente...');
        mostrarNotificacao("Iniciando AR...", 1000);
        setTimeout(botaoAR.click(), 1000)
    } else {
        console.log("Botão não encontrado!");
    }
}

function mostrarNotificacao(mensagem, duracao = 3000) {
      // Criar elemento de notificação
      const notificacao = document.createElement('div');
      notificacao.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px 30px;
        border-radius: 10px;
        font-size: 16px;
        z-index: 1000;
        text-align: center;
        backdrop-filter: blur(10px);
        border: 2px solid ${currentMode === 'admin' ? '#ff6b35' : '#4ecdc4'};
      `;
      notificacao.textContent = mensagem;
      
      document.body.appendChild(notificacao);
      
      // Remover após duração especificada
      setTimeout(() => {
        if (notificacao && notificacao.parentNode) {
          notificacao.parentNode.removeChild(notificacao);
        }
      }, duracao);
    }

function stopQRScanning() {
    qrScanning = false;
    
    if (qrStream) {
    qrStream.getTracks().forEach(track => track.stop());
    qrStream = null;
    }

    document.getElementById('qr-scanner').style.display = 'none';
}

function updateCalibrationUI() {
    const isUser = currentMode === 'user';
    const statusEl = document.getElementById(isUser ? 'user-calibration-status' : 'calibration-status');
    const calibrateBtn = document.getElementById(isUser ? 'user-calibrate-btn' : 'calibrate-btn');
    const instructionsEl = document.getElementById(isUser ? 'user-instructions' : 'instructions');

    if (calibrado) {
    statusEl.innerHTML = '✅ Sistema Calibrado';
    statusEl.className = 'status-calibrado';
    calibrateBtn.textContent = 'Recalibrar';
    
    if (isUser) {
        const pontos = JSON.parse(localStorage.getItem('pontos') || '[]')
        .filter(p => p.qrReferencia === pontoReferencia.qrCode);
        
        instructionsEl.innerHTML = 
        `<strong>Evento:</strong> ${pontoReferencia?.qrCode}<br>
            <strong>Pontos disponíveis:</strong> ${pontos.length}<br>
            Entre no AR para visualizar`;
    } else {
        instructionsEl.innerHTML = 
        `<strong>QR:</strong> ${pontoReferencia?.qrCode}<br>
            Toque no retículo para criar novos pontos`;
    }
    } else {
    statusEl.innerHTML = '❌ Não calibrado';
    statusEl.className = 'status-nao-calibrado';
    calibrateBtn.textContent = 'Calibrar com QR Code';
    
    instructionsEl.innerHTML = isUser ?
        '1. Calibre com o QR Code do evento<br>2. Entre no AR para ver os pontos' :
        '1. Primeiro, faça a calibração<br>2. Depois toque no retículo para criar cubos';
    }
}

// WEBXR HANDLERS
function onSessionStart(){
    const session = renderer.xr.getSession();

    session.requestReferenceSpace('viewer').then(function(viewerReferenceSpace){
    session.requestHitTestSource({ space: viewerReferenceSpace }).then(function(source){
        hitTestSource = source;
    });
    });

    session.requestReferenceSpace('local').then(function(refSpace){
    localReferenceSpace = refSpace;
    
    if (calibrado && pontoReferencia) {
        if (!pontoReferencia.arPosition) {
        pontoReferencia.arPosition = new THREE.Vector3(0, 0, 0);
        }
        
        // Carregar pontos para visualização (ambos os modos)
        setTimeout(() => {
        carregarPontosSalvos();
        }, 1000);
    }
    });
}

function onSessionEnd(){
    hitTestSource = null;
    localReferenceSpace = null;
    reticle.visible = false;
    limparObjetosAR();
}

function limparObjetosAR() {
    const objetosParaRemover = [];
    scene.traverse((child) => {
    if (child.isMesh && child.geometry && child.geometry.type === 'BoxGeometry') {
        objetosParaRemover.push(child);
    }
    });
    
    objetosParaRemover.forEach(obj => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
    });
    
    pontosCarregados = [];
}

function onSelect(){
    if (currentMode !== 'admin') return; // Só admin pode criar pontos
    
    if (!calibrado) {
    alert('Faça a calibração primeiro!');
    return;
    }

    if (!reticle.visible) return;

    const boxGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const boxMat = new THREE.MeshStandardMaterial({ 
    roughness: 0.7, 
    metalness: 0.0,
    color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
    });
    const box = new THREE.Mesh(boxGeo, boxMat);

    const position = new THREE.Vector3();
    position.setFromMatrixPosition(reticle.matrix);
    
    const posicaoRelativa = calcularPosicaoRelativa(position);
    
    box.position.copy(position);
    scene.add(box);

    salvarPonto(posicaoRelativa);
    pontosCreated++;
    
    updatePointsCount();
}

function updatePointsCount() {
    if (currentMode === 'admin') {
    document.getElementById('points-count').textContent = `Pontos criados: ${pontosCreated}`;
    }
}

function carregarPontosSalvos() {
    if (!calibrado || !pontoReferencia) return;

    const pontosSalvos = JSON.parse(localStorage.getItem('pontos') || '[]');
    const pontosDoEvento = pontosSalvos.filter(ponto => 
    ponto.qrReferencia === pontoReferencia.qrCode
    );

    console.log(`Carregando ${pontosDoEvento.length} pontos salvos para modo ${currentMode}...`);

    pontosDoEvento.forEach((ponto, index) => {
    const posicaoAbsoluta = new THREE.Vector3(
        ponto.posicaoRelativa.x,
        ponto.posicaoRelativa.y,
        ponto.posicaoRelativa.z
    );

    if (pontoReferencia.arPosition) {
        posicaoAbsoluta.add(pontoReferencia.arPosition);
    }

    criarCuboCarregado(posicaoAbsoluta, ponto, index);
    });
}

function criarCuboCarregado(posicao, dadosPonto, index) {
    const boxGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    
    // Cores diferentes para admin vs usuário
    const hue = (index * 0.1) % 1;
    const saturation = currentMode === 'admin' ? 0.5 : 0.7;
    const lightness = currentMode === 'admin' ? 0.4 : 0.6;
    
    const boxMat = new THREE.MeshStandardMaterial({ 
    roughness: 0.8, 
    metalness: 0.2,
    color: new THREE.Color().setHSL(hue, saturation, lightness)
    });
    
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.copy(posicao);
    
    box.userData = {
    carregado: true,
    dadosOriginais: dadosPonto
    };
    
    scene.add(box);
    pontosCarregados.push(box);
}

function calcularPosicaoRelativa(posicaoAR) {
    if (!pontoReferencia || !pontoReferencia.arPosition) {
    return posicaoAR.clone();
    }
    return posicaoAR.clone().sub(pontoReferencia.arPosition);
}

function salvarPonto(posicaoRelativa) {
    const ponto = {
    id: generateId(),
    posicaoRelativa: {
        x: posicaoRelativa.x,
        y: posicaoRelativa.y,
        z: posicaoRelativa.z
    },
    qrReferencia: pontoReferencia.qrCode,
    timestamp: Date.now(),
    tipo: 'cubo',
    criadoPor: 'admin'
    };

    console.log('Ponto salvo:', ponto);
    
    const pontosSalvos = JSON.parse(localStorage.getItem('pontos') || '[]');
    pontosSalvos.push(ponto);
    localStorage.setItem('pontos', JSON.stringify(pontosSalvos));
}

// UTILITÁRIOS
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

window.clearAllPoints = function() {
    if (confirm('Tem certeza que deseja limpar TODOS os pontos salvos?')) {
    localStorage.removeItem('pontos');
    limparObjetosAR();
    pontosCreated = 0;
    updatePointsCount();
    updateHomeStats();
    alert('Todos os pontos foram removidos!');
    }
}

function onWindowResize(){
    if (camera && renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

function animate(){
    if (renderer) {
    renderer.setAnimationLoop(render);
    }
}

function render(timestamp, frame){
    if (frame && hitTestSource && localReferenceSpace){
    const hitTestResults = frame.getHitTestResults(hitTestSource);

    if (hitTestResults.length > 0){
        const hit = hitTestResults[0];
        const pose = hit.getPose(localReferenceSpace);

        // Reticle só aparece no modo admin e se calibrado
        reticle.visible = calibrado && currentMode === 'admin';
        if (reticle.visible) {
        reticle.matrix.fromArray(pose.transform.matrix);
        }
    } else {
        reticle.visible = false;
    }
    }

    if (renderer && scene && camera) {
    renderer.render(scene, camera);
    }
}