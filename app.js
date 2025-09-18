// app.js - Full-featured, fixed, and mobile-optimized version
// - Particle classes declared before use
// - Guards for missing DOM elements and optional libs (GSAP, VanillaTilt)
// - Performance caps for mobile / low-power devices
// - Full game logic (delta-time), thrusters, obstacles, scoring
// - Magnetic/tilt UI effects enabled only on non-touch devices
// - Respect prefers-reduced-motion
// Author: ChatGPT (fixed for your project)

document.addEventListener('DOMContentLoaded', () => {
  // --------- Environment detection & basic flags ----------
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  const hwConcurrency = navigator.hardwareConcurrency || 4;
  const deviceMemory = navigator.deviceMemory || 4;
  // Detect low-end devices based on hardware concurrency and memory
  const isLowEndDevice = (hwConcurrency <= 2 || deviceMemory <= 2);

  // simple logger wrapper so we can disable logs easily
  const log = (...args) => {
    // set to false to silence
    const ENABLE_LOG = false;
    if (ENABLE_LOG) console.log('[app]', ...args);
  };

  // --------- Safe DOM references (guards) ----------
  const bgCanvas = document.getElementById('particle-canvas');
  const splash = document.getElementById('splash-screen');
  const mainContent = document.getElementById('main-content');
  const launchBtn = document.getElementById('launch-game-btn');
  const gameModal = document.getElementById('game-modal');
  const gameCanvas = document.getElementById('game-canvas');
  const closeGameBtn = document.getElementById('close-game-btn');
  const restartGameBtn = document.getElementById('restart-game-btn');
  const scoreEl = document.getElementById('score');
  const gameOverScreen = document.getElementById('game-over-screen');
  const finalScoreEl = document.getElementById('final-score');

  // If critical canvas is missing, create a fallback so code doesn't crash
  if (!bgCanvas) {
    console.warn('particle-canvas not found; creating fallback canvas');
    const c = document.createElement('canvas');
    c.id = 'particle-canvas';
    c.style.position = 'fixed';
    c.style.top = '0';
    c.style.left = '0';
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.zIndex = '-1';
    c.style.pointerEvents = 'none';
    document.body.appendChild(c);
  }

  // Re-fetch bgCanvas (in case we created)
  const bgCanvasRef = document.getElementById('particle-canvas');
  const bgCtx = bgCanvasRef ? bgCanvasRef.getContext('2d') : null;

  // ---------- PARTICLE CLASSES (must be defined BEFORE use) ----------
  // Load spark image for particles
  const sparkImage = new Image();
  sparkImage.src = './assets/spark.png';
  
  class Particle {
    constructor(w, h) {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      this.size = Math.random() * 3 + 1;
      this.speedX = (Math.random() - 0.5) * 0.6;
      this.speedY = (Math.random() - 0.5) * 0.6;
      this.alpha = Math.random() * 0.7 + 0.3;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.01;
      this.useImage = Math.random() > 0.3; // 70% chance to use spark image
      this.color = `rgba(0,200,255,${this.alpha})`;
      
      // Random color variations for non-image particles
      if (!this.useImage) {
        const hue = Math.random() > 0.5 ? 200 : 280; // Blue or lavender
        const sat = 80 + Math.random() * 20;
        const light = 50 + Math.random() * 30;
        this.color = `hsla(${hue}, ${sat}%, ${light}%, ${this.alpha})`;
      }
    }
    
    update(w, h) {
      this.x += this.speedX;
      this.y += this.speedY;
      if (this.x < -10) this.x = w + 10;
      if (this.x > w + 10) this.x = -10;
      if (this.y < -10) this.y = h + 10;
      if (this.y > h + 10) this.y = -10;
      
      this.rotation += this.rotationSpeed;
    }
    
    draw(ctx) {
      ctx.save();
      
      if (this.useImage && sparkImage.complete) {
        // Draw spark image
        ctx.globalAlpha = this.alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        const size = this.size * 4; // Make image particles a bit larger
        ctx.drawImage(sparkImage, -size/2, -size/2, size, size);
      } else {
        // Fallback to circle if image not loaded or for variation
        ctx.beginPath();
        ctx.fillStyle = this.color;
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.restore();
    }
  }

  class CursorParticle {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.size = Math.random() * 3 + 1;
      this.vx = (Math.random() - 0.5) * 2.4;
      this.vy = (Math.random() - 0.5) * 2.4;
      this.life = 1.0;
      this.color = `hsla(${Math.random() * 60 + 200}, 100%, 70%, ${this.life})`;
    }
    update(dt) {
      this.x += this.vx * (dt * 60);
      this.y += this.vy * (dt * 60);
      this.size -= 0.04 * (dt * 60);
      this.life -= 0.02 * (dt * 60);
    }
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.beginPath();
      ctx.fillStyle = this.color;
      ctx.arc(this.x, this.y, Math.max(0.2, this.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Particle system state ----------
  let bgParticles = [];
  let cursorParticles = [];
  const mouse = { x: null, y: null, radius: 120 };

  // ---------- Init & resize ----------
  function resizeBg() {
    try {
      bgCanvasRef.width = window.innerWidth;
      bgCanvasRef.height = window.innerHeight;
    } catch (e) {
      console.warn('bg canvas resize issue', e);
    }
    initParticles();
  }

  function initParticles() {
    if (!bgCanvasRef) return;
    bgParticles.length = 0;
    const area = Math.max(1, bgCanvasRef.width * bgCanvasRef.height);
    // tune density: keep lower for mobile/low-power
    // Detect low-end devices based on hardware concurrency and memory
    const isLowEndDevice = (hwConcurrency <= 2 || deviceMemory <= 2);
    const densityFactor = isLowEndDevice ? 50000 : (isTouchDevice ? 35000 : 24000);
    const raw = Math.floor(area / densityFactor);
    const cap = isLowEndDevice ? 40 : (isTouchDevice ? 80 : 240);
    const count = Math.max(16, Math.min(cap, raw));
    for (let i = 0; i < count; i++) {
      bgParticles.push(new Particle(bgCanvasRef.width, bgCanvasRef.height));
    }
    log('initParticles count', bgParticles.length);
  }

  // initial resize & listeners
  if (bgCanvasRef) {
    resizeBg();
    window.addEventListener('resize', () => {
      // throttle resize with rAF
      cancelAnimationFrame(resizeBg._raf);
      resizeBg._raf = requestAnimationFrame(resizeBg);
    }, { passive: true });
  }

  // ---------- Pointer handling (throttled for mobile) ----------
  let lastPointerTime = 0;
  const pointerThrottleMs = isTouchDevice ? 55 : 20;

  function onPointerMove(e) {
    const now = performance.now();
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (now - lastPointerTime > pointerThrottleMs) {
      cursorParticles.push(new CursorParticle(mouse.x, mouse.y));
      // occasionally add second particle on desktop
      if (!isTouchDevice && Math.random() > 0.82) cursorParticles.push(new CursorParticle(mouse.x, mouse.y));
      lastPointerTime = now;
    }
  }
  if (window.PointerEvent) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', () => { mouse.x = null; mouse.y = null; }, { passive: true });
  } else {
    window.addEventListener('mousemove', onPointerMove, { passive: true });
  }
  // touch fallback
  window.addEventListener('touchmove', (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    onPointerMove({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: true });

  // ---------- Background animation loop (fps-capped for mobile) ----------
  let lastFrameTime = performance.now();
  const targetFPS = reducedMotion ? 12 : (isLowEndDevice ? 24 : (isTouchDevice ? 30 : 60));
  const frameInterval = 1000 / targetFPS;
  function bgAnimation(now) {
    requestAnimationFrame(bgAnimation);
    if (!bgCtx || !bgCanvasRef) return;
    if (now - lastFrameTime < frameInterval) return;
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    // clear
    bgCtx.clearRect(0, 0, bgCanvasRef.width, bgCanvasRef.height);

    // draw particles
    for (let i = 0; i < bgParticles.length; i++) {
      const p = bgParticles[i];
      p.update(bgCanvasRef.width, bgCanvasRef.height);
      p.draw(bgCtx);
      // subtle lines to mouse
      if (!reducedMotion && mouse.x !== null && mouse.y !== null) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mouse.radius) {
          bgCtx.beginPath();
          bgCtx.moveTo(mouse.x, mouse.y);
          bgCtx.lineTo(p.x, p.y);
          const alpha = Math.max(0, 1 - dist / mouse.radius) * 0.28;
          bgCtx.strokeStyle = `rgba(0,200,255,${alpha})`;
          bgCtx.lineWidth = 0.3;
          bgCtx.stroke();
        }
      }
    }

    // update cursor particles
    for (let i = 0; i < cursorParticles.length; i++) {
      const cp = cursorParticles[i];
      cp.update(dt);
      cp.draw(bgCtx);
      if (cp.life <= 0 || cp.size <= 0.2) {
        cursorParticles.splice(i, 1); i--;
      }
    }
  }
  requestAnimationFrame(bgAnimation);

  // ---------- Hide splash / show main content safely ----------
  try {
    if (splash) splash.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
    document.body.style.overflowY = 'auto';
  } catch (e) {
    console.warn('error toggling splash/main visibility', e);
  }

  // ---------- Simplified hero animation ----------
  if (window.gsap && !reducedMotion) {
    try {
      const heroTitle = document.getElementById('hero-title');
      if (heroTitle) {
        // Use a simpler animation that's less glitchy
        gsap.fromTo(heroTitle,
          { opacity: 0, y: -20 },
          { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out' }
        );
        
        // Add a subtle glow animation
        gsap.to(heroTitle, {
          textShadow: '0 0 20px var(--secondary-lavender), 0 0 30px var(--secondary-lavender)',
          repeat: -1,
          yoyo: true,
          duration: 2,
          ease: 'sine.inOut'
        });
      }

      // Scroll-triggered fades (safe: check ScrollTrigger)
      if (window.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
        const sections = document.querySelectorAll('section, .portal-card, .game-content, footer');
        sections.forEach((el) => {
          try {
            gsap.from(el, {
              opacity: 0,
              y: 24,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                start: 'top 85%',
                toggleActions: 'play none none none'
              }
            });
          } catch (e) {
            // ignore per-element issues
          }
        });
      }
    } catch (e) {
      console.warn('gsap hero/scroll init failed', e);
    }
  }

  // ---------- Magnetic hover / VanillaTilt (only on non-touch) ----------
  if (!isTouchDevice && window.gsap) {
    try {
      const magnetics = document.querySelectorAll('.magnetic');
      magnetics.forEach((el) => {
        el.style.willChange = 'transform';
        el.addEventListener('mousemove', (ev) => {
          const rect = el.getBoundingClientRect();
          const x = (ev.clientX - rect.left) - rect.width / 2;
          const y = (ev.clientY - rect.top) - rect.height / 2;
          gsap.to(el, { x: x * 0.18, y: y * 0.12, duration: 0.6, ease: 'power3.out' });
        }, { passive: true });
        el.addEventListener('mouseleave', () => {
          gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1,0.4)' });
        }, { passive: true });
      });
    } catch (e) {
      console.warn('magnetic init failed', e);
    }
  }

  // VanillaTilt: only initialize when available and not touch
  try {
    if (!isTouchDevice && window.VanillaTilt) {
      const tiltNodes = document.querySelectorAll('.portal-card');
      if (tiltNodes.length) VanillaTilt.init(tiltNodes, { max: 12, speed: 450, glare: true, 'max-glare': 0.12, scale: 1.03 });
    }
  } catch (e) {
    console.warn('VanillaTilt error', e);
  }

  // ---------- SOUND (optional) ----------
  const sounds = {
    hover: document.getElementById('hover-sound'),
    click: document.getElementById('click-sound'),
    success: document.getElementById('success-sound'),
    fail: document.getElementById('fail-sound')
  };
  Object.values(sounds).forEach(s => { if (s) s.volume = 0.25; });

  // ---------- COSMIC COLLECTOR GAME ----------
  // Guards for game canvas
  const gameCtx = gameCanvas ? gameCanvas.getContext('2d') : null;

  // Game elements
  const starsEl = document.getElementById('stars');
  const finalStarsEl = document.getElementById('final-stars');
  const touchControls = document.getElementById('touch-controls');
  const leftControl = document.getElementById('left-control');
  const rightControl = document.getElementById('right-control');

  // Game state
  let active = false;
  let lastTimestamp = null;
  let rafId = null;
  let player = null;
  let stars = [];
  let obstacles = [];
  let particles = [];
  let score = 0;
  let starsCollected = 0;
  let spawnAccumulator = 0;
  let starSpawnAccumulator = 0;
  let fpsTracker = { frames: 0, last: performance.now(), fps: 60 };

  // Load game assets
  const starImage = new Image();
  starImage.src = './assets/spark.png';
  
  const iconImage = new Image();
  iconImage.src = './assets/icon.png';

  // Configuration tuned for mobile & desktop with low-end device detection
  const config = {
    maxObstacles: isLowEndDevice ? 5 : (isTouchDevice ? 8 : 12),
    maxStars: isLowEndDevice ? 3 : (isTouchDevice ? 5 : 8),
    obstacleSpawnInterval: isLowEndDevice ? 1.8 : (isTouchDevice ? 1.5 : 1.2),
    starSpawnInterval: isLowEndDevice ? 1.0 : 0.8,
    playerSpeed: isLowEndDevice ? 240 : (isTouchDevice ? 280 : 320),
    gameBaseWidth: isTouchDevice ? 360 : 480,
    gameBaseHeight: isTouchDevice ? 540 : 640,
    particleLimit: isLowEndDevice ? 20 : (isTouchDevice ? 40 : 60)
  };

  // Player class
  class Player {
    constructor(canvas) {
      this.canvas = canvas;
      this.width = 40;
      this.height = 40;
      this.x = (canvas.width - this.width) / 2;
      this.y = canvas.height - this.height - 20;
      this.speed = config.playerSpeed;
      this.rotation = 0;
      this.targetRotation = 0;
      this.color = '#ffffff';
      this.trail = [];
      this.trailMax = 5;
    }
    
    update(dt, controls) {
      // Movement
      const move = this.speed * dt;
      
      if (controls.left) {
        this.x = Math.max(0, this.x - move);
        this.targetRotation = -0.2;
      } else if (controls.right) {
        this.x = Math.min(this.canvas.width - this.width, this.x + move);
        this.targetRotation = 0.2;
      } else {
        this.targetRotation = 0;
      }
      
      // Smooth rotation
      this.rotation += (this.targetRotation - this.rotation) * dt * 5;
      
      // Trail effect
      if (this.trail.length > this.trailMax) {
        this.trail.shift();
      }
      
      if (performance.now() % 5 === 0) {
        this.trail.push({
          x: this.x + this.width / 2,
          y: this.y + this.height,
          alpha: 1
        });
      }
      
      // Update trail
      for (let i = 0; i < this.trail.length; i++) {
        this.trail[i].alpha -= dt * 2;
        if (this.trail[i].alpha <= 0) {
          this.trail.splice(i, 1);
          i--;
        }
      }
    }
    
    draw(ctx) {
      // Draw trail
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.beginPath();
        ctx.fillStyle = '#00c8ff';
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // Draw player
      ctx.save();
      ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
      ctx.rotate(this.rotation);
      
      // Draw ship body
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(0, -this.height / 2);
      ctx.lineTo(this.width / 2, this.height / 2);
      ctx.lineTo(-this.width / 2, this.height / 2);
      ctx.closePath();
      ctx.fill();
      
      // Draw glow effect
      ctx.shadowColor = '#00c8ff';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#00c8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.restore();
    }
  }

  // Star class (collectible)
  class Star {
    constructor(canvas) {
      this.canvas = canvas;
      this.width = 30;
      this.height = 30;
      this.x = Math.random() * (canvas.width - this.width);
      this.y = -this.height - (Math.random() * 100);
      this.speed = Math.random() * 30 + 70;
      this.rotation = 0;
      this.rotationSpeed = (Math.random() - 0.5) * 2;
      this.scale = 0.8 + Math.random() * 0.4;
      this.pulsePhase = Math.random() * Math.PI * 2;
    }
    
    update(dt) {
      this.y += this.speed * dt;
      this.rotation += this.rotationSpeed * dt;
      this.pulsePhase += dt * 3;
      if (this.pulsePhase > Math.PI * 2) this.pulsePhase -= Math.PI * 2;
    }
    
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
      ctx.rotate(this.rotation);
      
      const pulse = 1 + Math.sin(this.pulsePhase) * 0.1;
      ctx.scale(this.scale * pulse, this.scale * pulse);
      
      // Draw star glow
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 15;
      
      if (starImage.complete) {
        ctx.drawImage(starImage, -this.width / 2, -this.height / 2, this.width, this.height);
      } else {
        // Fallback if image not loaded
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(0, 0, this.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.restore();
    }
  }

  // Obstacle class
  class Obstacle {
    constructor(canvas) {
      this.canvas = canvas;
      this.width = Math.random() * 40 + 30;
      this.height = this.width;
      this.x = Math.random() * (canvas.width - this.width);
      this.y = -this.height - (Math.random() * 100);
      this.speed = Math.random() * 40 + 60;
      this.rotation = 0;
      this.rotationSpeed = (Math.random() - 0.5) * 1.5;
      this.color = `hsl(${Math.random() * 60 + 200}, 80%, 50%)`;
      this.sides = Math.floor(Math.random() * 3) + 3; // 3 to 5 sides
    }
    
    update(dt) {
      this.y += this.speed * dt;
      this.rotation += this.rotationSpeed * dt;
    }
    
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
      ctx.rotate(this.rotation);
      
      // Draw polygon
      ctx.beginPath();
      ctx.fillStyle = this.color;
      
      const radius = this.width / 2;
      const angleStep = (Math.PI * 2) / this.sides;
      
      for (let i = 0; i < this.sides; i++) {
        const angle = i * angleStep;
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.closePath();
      ctx.fill();
      
      // Add glow effect
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.restore();
    }
  }

  // Particle effect for collisions and star collection
  class GameParticle {
    constructor(x, y, color) {
      this.x = x;
      this.y = y;
      this.size = Math.random() * 4 + 2;
      this.speedX = (Math.random() - 0.5) * 5;
      this.speedY = (Math.random() - 0.5) * 5;
      this.color = color || '#00c8ff';
      this.life = 1.0;
    }
    
    update(dt) {
      this.x += this.speedX * dt * 60;
      this.y += this.speedY * dt * 60;
      this.size -= dt * 3;
      this.life -= dt * 2;
    }
    
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = this.life;
      ctx.beginPath();
      ctx.fillStyle = this.color;
      ctx.arc(this.x, this.y, Math.max(0.1, this.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Collision detection (circle-based for better mobile experience)
  function collides(a, b) {
    const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
    const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = (a.width + b.width) / 2 * 0.7; // 0.7 for more forgiving collisions
    
    return distance < minDistance;
  }

  // Canvas sizing
  function configureGameCanvas() {
    if (!gameCanvas) return;
    
    const cssW = Math.min(config.gameBaseWidth, Math.floor(window.innerWidth * 0.9));
    const cssH = Math.min(config.gameBaseHeight, Math.floor(window.innerHeight * 0.7));
    
    gameCanvas.style.width = cssW + 'px';
    gameCanvas.style.height = cssH + 'px';
    gameCanvas.width = cssW;
    gameCanvas.height = cssH;
    
    if (player) {
      player.x = (gameCanvas.width - player.width) / 2;
      player.y = gameCanvas.height - player.height - 20;
    }
  }

  // Create explosion particles
  function createExplosion(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      if (particles.length < config.particleLimit) {
        particles.push(new GameParticle(x, y, color));
      }
    }
  }

  // Start game
  function startGame() {
    if (!gameCanvas || !gameCtx) {
      console.warn('gameCanvas/context missing; cannot start game');
      return;
    }
    
    configureGameCanvas();
    
    // Initialize game state
    player = new Player(gameCanvas);
    stars = [];
    obstacles = [];
    particles = [];
    score = 0;
    starsCollected = 0;
    spawnAccumulator = 0;
    starSpawnAccumulator = 0;
    lastTimestamp = null;
    active = true;
    
    // Show game UI
    if (gameModal) gameModal.style.display = 'flex';
    if (scoreEl) scoreEl.textContent = 'Score: 0';
    if (starsEl) starsEl.textContent = 'Stars: 0';
    if (gameOverScreen) gameOverScreen.style.display = 'none';
    
    // Show touch controls on mobile
    if (isTouchDevice && touchControls) {
      touchControls.style.display = 'flex';
    }
    
    // Start game loop
    rafId = requestAnimationFrame(gameLoop);
  }

  // End game
  function gameOver() {
    active = false;
    
    if (rafId) cancelAnimationFrame(rafId);
    
    // Update UI
    if (gameOverScreen) gameOverScreen.style.display = 'block';
    if (finalScoreEl) finalScoreEl.textContent = score;
    if (finalStarsEl) finalStarsEl.textContent = starsCollected;
    
    // Hide touch controls
    if (touchControls) touchControls.style.display = 'none';
    
    try { if (sounds && sounds.fail) sounds.fail.play(); } catch (e) {}
  }

  // Main game loop
  function gameLoop(ts) {
    if (!active) return;
    
    if (!lastTimestamp) lastTimestamp = ts;
    const dt = Math.min(0.05, (ts - lastTimestamp) / 1000);
    lastTimestamp = ts;
    
    // FPS tracking
    fpsTracker.frames++;
    const now = performance.now();
    if (now - fpsTracker.last > 1000) {
      fpsTracker.fps = Math.round((fpsTracker.frames * 1000) / (now - fpsTracker.last));
      fpsTracker.frames = 0;
      fpsTracker.last = now;
    }
    
    // Clear canvas
    gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    // Draw starfield background
    drawStarfieldBackground(gameCtx);
    
    // Update and draw player
    if (player) {
      player.update(dt, controls);
      player.draw(gameCtx);
    }
    
    // Spawn stars
    starSpawnAccumulator += dt;
    if (starSpawnAccumulator > config.starSpawnInterval) {
      starSpawnAccumulator = 0;
      if (stars.length < config.maxStars) {
        stars.push(new Star(gameCanvas));
      }
    }
    
    // Update and draw stars
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.update(dt);
      star.draw(gameCtx);
      
      // Check for collection
      if (player && collides(player, star)) {
        stars.splice(i, 1);
        i--;
        starsCollected++;
        score += 100;
        
        // Create collection effect
        createExplosion(star.x + star.width/2, star.y + star.height/2, 10, '#ffcc00');
        
        // Update UI
        if (starsEl) starsEl.textContent = `Stars: ${starsCollected}`;
        if (scoreEl) scoreEl.textContent = `Score: ${score}`;
        
        try { if (sounds && sounds.success) sounds.success.play(); } catch (e) {}
      }
      
      // Remove if off-screen
      if (star.y > gameCanvas.height + 20) {
        stars.splice(i, 1);
        i--;
      }
    }
    
    // Spawn obstacles
    spawnAccumulator += dt;
    if (spawnAccumulator > config.obstacleSpawnInterval) {
      spawnAccumulator = 0;
      if (obstacles.length < config.maxObstacles) {
        obstacles.push(new Obstacle(gameCanvas));
      }
    }
    
    // Update and draw obstacles
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];
      obstacle.update(dt);
      obstacle.draw(gameCtx);
      
      // Check for collision
      if (player && collides(player, obstacle)) {
        // Create explosion effect
        createExplosion(
          player.x + player.width/2,
          player.y + player.height/2,
          20,
          '#ff00ff'
        );
        
        gameOver();
        return;
      }
      
      // Remove if off-screen
      if (obstacle.y > gameCanvas.height + 20) {
        obstacles.splice(i, 1);
        i--;
        score += 10; // Small score for avoiding obstacles
        if (scoreEl) scoreEl.textContent = `Score: ${score}`;
      }
    }
    
    // Update and draw particles
    for (let i = 0; i < particles.length; i++) {
      particles[i].update(dt);
      particles[i].draw(gameCtx);
      
      if (particles[i].life <= 0 || particles[i].size <= 0.1) {
        particles.splice(i, 1);
        i--;
      }
    }
    
    // Passive score increase
    score += Math.round(dt * 5);
    if (scoreEl) scoreEl.textContent = `Score: ${score}`;
    
    // Schedule next frame
    rafId = requestAnimationFrame(gameLoop);
  }
  
  // Draw starfield background
  function drawStarfieldBackground(ctx) {
    // Draw gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, gameCanvas.height);
    gradient.addColorStop(0, '#0a0a2a');
    gradient.addColorStop(1, '#1a0a3a');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    // Draw small static stars (just a few for performance)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 20; i++) {
      const x = (Math.sin(i * 567.89 + performance.now() * 0.0001) * 0.5 + 0.5) * gameCanvas.width;
      const y = (Math.cos(i * 123.45 + performance.now() * 0.0001) * 0.5 + 0.5) * gameCanvas.height;
      const size = Math.sin(i * 0.1 + performance.now() * 0.001) * 0.5 + 1;
      
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- Controls: keyboard + touch mapping ----------
  const controls = { left: false, right: false, up: false, down: false };

  window.addEventListener('keydown', (e) => {
    if (!active && (e.key === 'Enter' || e.key.toLowerCase() === 'g') && launchBtn) {
      e.preventDefault(); startGame(); return;
    }
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') controls.left = true;
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') controls.right = true;
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') controls.up = true;
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') controls.down = true;
    if (e.key === 'Escape' && gameModal && gameModal.style.display === 'flex') {
      // close game modal
      if (rafId) cancelAnimationFrame(rafId);
      gameModal.style.display = 'none';
      active = false;
    }
  }, { passive: true });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') controls.left = false;
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') controls.right = false;
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') controls.up = false;
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') controls.down = false;
  }, { passive: true });

  // Enhanced touch controls for better mobile experience
  let touchStartY = 0;
  let lastTouchX = 0;
  let touchSensitivity = isTouchDevice ? 1.5 : 1.0; // Increased sensitivity for mobile
  
  function onGameTouchStart(e) {
    if (!player || !gameCanvas) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const rect = gameCanvas.getBoundingClientRect();
    touchStartY = t.clientY - rect.top;
    lastTouchX = t.clientX - rect.left;
    
    // Add visual feedback for touch
    // Create particles for visual feedback
    createExplosion(player.x + player.width / 2, player.y + player.height, 3, '#00c8ff');
  }
  
  function onGameTouchMove(e) {
    if (!player || !gameCanvas) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const rect = gameCanvas.getBoundingClientRect();
    const tx = t.clientX - rect.left;
    const ty = t.clientY - rect.top;
    
    // Smoother horizontal movement with acceleration
    const centerX = player.x + player.width / 2;
    const dx = tx - centerX;
    const moveSpeed = Math.min(Math.abs(dx), 15) * touchSensitivity;
    player.x += Math.sign(dx) * moveSpeed;
    
    // Vertical movement based on swipe direction
    const dy = ty - touchStartY;
    if (Math.abs(dy) > 10) { // Small threshold to prevent accidental movements
      if (dy < 0) {
        controls.up = true;
        controls.down = false;
      } else {
        controls.down = true;
        controls.up = false;
      }
    }
    
    // Update last touch position
    lastTouchX = tx;
    
    // Add more particles for visual feedback
    if (performance.now() % 5 === 0) {
      createExplosion(player.x + player.width / 2, player.y + player.height, 1, '#00c8ff');
    }
  }

  function onGameTouchEnd() {
    controls.left = controls.right = controls.up = controls.down = false;
    touchStartY = 0;
  }

  if (gameCanvas) {
    gameCanvas.addEventListener('touchstart', onGameTouchStart, { passive: true });
    gameCanvas.addEventListener('touchmove', onGameTouchMove, { passive: true });
    gameCanvas.addEventListener('touchend', onGameTouchEnd, { passive: true });
    gameCanvas.addEventListener('touchcancel', onGameTouchEnd, { passive: true });
  }
  
  // Add a visible touch control hint for mobile users
  if (isTouchDevice && gameCanvas) {
    const touchHint = document.createElement('div');
    touchHint.style.position = 'absolute';
    touchHint.style.bottom = '15px';
    touchHint.style.left = '50%';
    touchHint.style.transform = 'translateX(-50%)';
    touchHint.style.color = 'rgba(0, 200, 255, 0.7)';
    touchHint.style.fontSize = '14px';
    touchHint.style.textAlign = 'center';
    touchHint.style.padding = '10px';
    touchHint.style.borderRadius = '5px';
    touchHint.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    touchHint.style.zIndex = '2002';
    touchHint.innerHTML = 'Swipe to move';
    touchHint.style.opacity = '1';
    touchHint.style.transition = 'opacity 0.5s';
    
    // Add to game UI
    const gameUI = document.getElementById('game-ui');
    if (gameUI) {
      gameUI.appendChild(touchHint);
      // Fade out after 5 seconds
      setTimeout(() => {
        touchHint.style.opacity = '0';
        // Remove after fade out
        setTimeout(() => {
          try {
            gameUI.removeChild(touchHint);
          } catch (e) {}
        }, 500);
      }, 5000);
    }
  }

  // ---------- UI Bindings ----------
  if (launchBtn) {
    ['click', 'pointerdown', 'touchstart'].forEach(evt => {
      launchBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        try { if (sounds && sounds.click) sounds.click.play(); } catch (er) {}
        startGame();
      }, { passive: true });
    });
  }

  if (closeGameBtn) {
    ['click', 'pointerdown', 'touchstart'].forEach(evt => {
      closeGameBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        if (rafId) cancelAnimationFrame(rafId);
        if (gameModal) gameModal.style.display = 'none';
        active = false;
      }, { passive: true });
    });
  }

  if (restartGameBtn) {
    ['click', 'pointerdown', 'touchstart'].forEach(evt => {
      restartGameBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        startGame();
      }, { passive: true });
    });
  }

  // double click the game section to start (discovery)
  const gameSection = document.getElementById('game-section');
  if (gameSection) {
    gameSection.addEventListener('dblclick', (e) => {
      e.preventDefault();
      startGame();
    }, { passive: true });
  }

  // ---------- Optional debug overlay (disabled by default) ----------
  const DEBUG_FPS = false;
  if (DEBUG_FPS) {
    const dbg = document.createElement('div');
    dbg.style.position = 'fixed';
    dbg.style.left = '10px';
    dbg.style.top = '10px';
    dbg.style.zIndex = 9999;
    dbg.style.color = '#00c8ff';
    dbg.style.background = 'rgba(0,0,0,0.45)';
    dbg.style.padding = '6px 8px';
    dbg.style.borderRadius = '6px';
    document.body.appendChild(dbg);
    setInterval(() => {
      dbg.textContent = `FPS: ${fpsTracker.fps} | BgP: ${bgParticles.length} | CursorP: ${cursorParticles.length} | GameP: ${particles.length}`;
    }, 600);
  }

  // ---------- Safety: catch global errors to avoid full crash ----------
  window.addEventListener('error', (ev) => {
    console.error('Global error caught:', ev.message, 'at', ev.filename + ':' + ev.lineno);
    // Keep UI available
    try { if (splash) splash.style.display = 'none'; if (mainContent) mainContent.style.display = 'block'; } catch (e) {}
  });

  window.addEventListener('unhandledrejection', (ev) => {
    console.warn('Unhandled promise rejection:', ev.reason);
  });

  // ---------- Sounds references already defined above ----------

  // ---------- Initial tips for dev debugging ----------
  log('App initialized', { reducedMotion, isTouchDevice, hwConcurrency, deviceMemory });

  // ---------- Final safety: Ensure main content shown even if JS errors earlier ----------
  try { if (splash) splash.style.display = 'none'; if (mainContent) mainContent.style.display = 'block'; } catch (e) {}

  // ---------- end DOMContentLoaded ----------
});
