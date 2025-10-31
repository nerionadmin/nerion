/* eslint-disable @typescript-eslint/no-explicit-any */
// app/components/AutoFaceScanner.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";

/**
 * FaceMesh = UMD LOCAL -> /public/mediapipe/face_mesh/face_mesh.js
 * Hands    = UMD LOCAL -> /public/mediapipe/hands/hands.js
 * SelfieSeg= UMD LOCAL -> /public/mediapipe/selfie_segmentation/selfie_segmentation.js
 *
 * ⚠️ Assure-toi d’avoir copié TOUT le contenu de:
 * - node_modules/@mediapipe/face_mesh/*             -> public/mediapipe/face_mesh/
 * - node_modules/@mediapipe/hands/*                 -> public/mediapipe/hands/
 * - node_modules/@mediapipe/selfie_segmentation/*   -> public/mediapipe/selfie_segmentation/
 * (inclure .js/.wasm/.data/.tflite)
 */
const MP_FM_VER = "0.4.1633559619";

/** UX & règles */
const MIRRORED_VIEW = true;
// Overlay en CERCLE :
const OVAL_RX_N = 0.18;
const OVAL_RY_N = 0.28;
const CENTER_STRICTNESS = 0.90;

const STABLE_HOLD_MS = 900;

/** Taille visage autorisée (0..1) */
const OVAL_W_N = OVAL_RX_N * 2;
const OVAL_H_N = OVAL_RY_N * 2;
const MIN_FACE_WIDTH_N  = OVAL_W_N * 0.60;
const MAX_FACE_WIDTH_N  = OVAL_W_N * 0.96;
const MIN_FACE_HEIGHT_N = OVAL_H_N * 0.60;
const MAX_FACE_HEIGHT_N = OVAL_H_N * 0.96;

/** % de points dans le cercle */
const INSIDE_RATIO = 0.90;

/** Caméra */
const IDEAL_W = 1920;
const IDEAL_H = 1080;

/** Occlusion profondeur */
const OCCL_INNER_RX = 0.22;
const OCCL_INNER_RY = 0.32;
const OCCL_OUTER_RX = 0.52;
const OCCL_OUTER_RY = 0.78;

const OCCL_Z_DELTA_THRESH = 0.035;
const OCCL_SUPPORT_RATIO  = 0.62;

/** Bases locales pour les assets (sans CDN) */
const FACE_ASSETS_BASE   = "/mediapipe/face_mesh";
const HANDS_ASSETS_BASE  = "/mediapipe/hands";
const SELFIE_ASSETS_BASE = "/mediapipe/selfie_segmentation";

/** router d’assets */
const locateMediaPipeFile = (file: string) => {
  const f = file.split("/").pop() || file;

  // SelfieSegmentation
  if (
    f.includes("selfie_segmentation") ||
    f.startsWith("selfie_") ||
    f === "selfie_segmentation.binarypb"
  ) {
    return `${SELFIE_ASSETS_BASE}/${f}`;
  }

  // FaceMesh
  if (
    f.includes("face_mesh") ||
    f.includes("face_landmark") ||
    f === "face_mesh.binarypb"
  ) {
    return `${FACE_ASSETS_BASE}/${f}`;
  }

  // Hands
  if (
    f.includes("hands") ||
    f.includes("palm_detection") ||
    f.includes("hand_landmark") ||
    f === "hands.binarypb"
  ) {
    return `${HANDS_ASSETS_BASE}/${f}`;
  }

  return `${FACE_ASSETS_BASE}/${f}`;
};

/** Gate humain via SelfieSegmentation (global) */
const HUMAN_RATIO_MIN = 0.55; // (durci de 0.40 -> 0.55)
const MASK_SAMPLE_W   = 64;

/** -------- AJOUT : veto objet non-humain sur bas du visage -------- */
const LOWER_FACE_HUMAN_MIN = 0.60; // seuil humain attendu dans l’ellipse bas du visage (nez/bouche)
const LOWER_ROI_RX = 0.30;         // rayon X de l’ellipse (en fraction de la largeur bbox)
const LOWER_ROI_RY = 0.18;         // rayon Y de l’ellipse (en fraction de la hauteur bbox)
const LOWER_ROI_CY = 0.72;         // position verticale du centre du ROI (72% vers le bas de la bbox)
const SKIN_SAMPLE_W = 64;          // échantillonnage vidéo pour test “peau”
const SKIN_RATIO_MIN = 0.30;       // au moins 30% de peau dans l’ellipse (sinon on suspecte un objet)
const OBJECT_HOLD_MS = 160;        // temporisation anti-flicker pour l'état "objet"

/** --- AJOUT : contrôle par bandes (haut/bas) dans la bbox (via SelfieSeg) --- */
const BAND_LOWER_FACE_MIN = 0.72;  // humain mini dans la bande basse
const BAND_UPPER_FACE_MIN = 0.65;  // humain mini dans la bande haute (front/yeux)
const BAND_LOWER_START = 0.58;     // 58% -> 100% de la bbox (bouche/menton)
const BAND_LOWER_END   = 1.00;
const BAND_UPPER_START = 0.08;     // 8% -> 45% de la bbox (front/yeux)
const BAND_UPPER_END   = 0.45;
const BAND_CENTER_X_PAD = 0.16;    // ignore ~16% de chaque joue (zone centrale)
/** ------------------------------------------------------------------ */

/** --- AJOUT : ROIs supplémentaires (nez, bouche, joues, front, menton) --- */
type RoiSpec = { cx: number; cy: number; rx: number; ry: number; humanMin: number; skinMin: number };
const ROI_SPECS: Record<"nose"|"mouth"|"cheekL"|"cheekR"|"forehead"|"chin", RoiSpec> = {
  nose:     { cx: 0.50, cy: 0.56, rx: 0.22, ry: 0.14, humanMin: 0.88, skinMin: 0.60 },
  mouth:    { cx: 0.50, cy: 0.80, rx: 0.28, ry: 0.15, humanMin: 0.88, skinMin: 0.60 },
  cheekL:   { cx: 0.30, cy: 0.58, rx: 0.18, ry: 0.18, humanMin: 0.85, skinMin: 0.55 },
  cheekR:   { cx: 0.70, cy: 0.58, rx: 0.18, ry: 0.18, humanMin: 0.85, skinMin: 0.55 },
  forehead: { cx: 0.50, cy: 0.24, rx: 0.32, ry: 0.20, humanMin: 0.88, skinMin: 0.60 },
  chin:     { cx: 0.50, cy: 0.94, rx: 0.26, ry: 0.14, humanMin: 0.88, skinMin: 0.60 },
};
/** ------------------------------------------------------------------ */

type Props = {
  onCapture: (payload: { dataUrl: string; blob: Blob }) => void;
  width?: number;
  height?: number;
  centerTolerance?: { x: number; y: number };
  eyeOpenThreshold?: number;
  cooldownMs?: number;
};

export default function AutoFaceScanner({
  onCapture,
  width = 720,
  height = 540,
  centerTolerance = { x: 0.18, y: 0.22 },
  eyeOpenThreshold = 0.22,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const webcamRef = useRef<Webcam>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Overlay DOM (fond de page qui masque tout sauf le cercle)
  const coverRef = useRef<HTMLDivElement | null>(null);

  // === Refs stables pour les résultats ===
  const faceMeshRef = useRef<any | null>(null);
  const handsRef    = useRef<any | null>(null);
  const selfieRef   = useRef<any | null>(null);

  const lastFaceLmRef  = useRef<any[] | null>(null);
  const lastHandsLmRef = useRef<any[] | null>(null);

  const segReadyRef        = useRef<boolean>(false);
  const lastSegMaskRef     = useRef<CanvasImageSource | null>(null);
  const offscreenMaskRef   = useRef<HTMLCanvasElement | null>(null);
  const lastHumanRatioRef  = useRef<number>(1);

  // AJOUT : offscreen pour lire la frame vidéo et tester la “peau”
  const offscreenVideoRef  = useRef<HTMLCanvasElement | null>(null);

  const rafIdRef = useRef<number | null>(null);
  const preRafIdRef = useRef<number | null>(null);
  const markedMpReadyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);

  const capturedOnceRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);

  // Clignement
  const awaitingBlinkRef = useRef(false);
  const wasEyesOpenRef   = useRef(false);
  const blinkTriggeredRef = useRef(false);

  // AJOUT : temporisation pour l'état "objet masque le bas du visage"
  const lowerObjSinceRef = useRef<number | null>(null);
  const lowerObjActiveRef = useRef<boolean>(false);

  // AJOUT : temporisations/états ROI supplémentaires
  const noseSinceRef     = useRef<number | null>(null);
  const noseActiveRef    = useRef<boolean>(false);
  const mouthSinceRef    = useRef<number | null>(null);
  const mouthActiveRef   = useRef<boolean>(false);
  const cheekLSinceRef   = useRef<number | null>(null);
  const cheekLActiveRef  = useRef<boolean>(false);
  const cheekRSinceRef   = useRef<number | null>(null);
  const cheekRActiveRef  = useRef<boolean>(false);
  const foreheadSinceRef = useRef<number | null>(null);
  const foreheadActiveRef= useRef<boolean>(false);
  const chinSinceRef     = useRef<number | null>(null);
  const chinActiveRef    = useRef<boolean>(false);

  /** ===== Utils couleurs ===== */
  const getCssVar = (name: string, fallback: string) => {
    if (typeof window === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v?.trim() || fallback;
  };

  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const num = parseInt(full.slice(0, 6), 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  };

  const colorFromVar = (varName: string, alpha = 0.95, fallbackHex = "#30D158") => {
    const raw = getCssVar(varName, fallbackHex);
    if (raw.startsWith("#")) {
      const { r, g, b } = hexToRgb(raw);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    if (raw.startsWith("rgb(")) {
      const inside = raw.substring(raw.indexOf("(") + 1, raw.indexOf(")"));
      return `rgba(${inside},${alpha})`;
    }
    return raw;
  };

  /** Charger un script (UMD) une seule fois */
  const loadScriptOnce = (src: string, id: string) =>
    new Promise<void>((resolve, reject) => {
      const existed = document.getElementById(id) as HTMLScriptElement | null;
      if (existed && existed.getAttribute("data-loaded") === "true") return resolve();
      if (existed) {
        existed.addEventListener("load", () => resolve(), { once: true });
        existed.addEventListener("error", () => reject(new Error(`Failed ${src}`)), { once: true });
        return;
      }
      const s = document.createElement("script");
      s.id = id;
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = () => { s.setAttribute("data-loaded", "true"); resolve(); };
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });

  /** S’assure que la vidéo est prête (Safari veut un play() explicite) */
  const ensureVideoReady = async (video: HTMLVideoElement) => {
    try { await video.play().catch(() => undefined); } catch {}
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return;
    await new Promise<void>((resolve) => {
      const onReady = () => { cleanup(); resolve(); };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("canplay", onReady);
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("canplay", onReady, { once: true });
    });
  };

  /** Scroll doux */
  const scrollIntoViewPolitely = useCallback(() => {
    const doScroll = () => {
      try {
        rootRef.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        const nearBottom = Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 20;
        if (!nearBottom) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      } catch {}
    };
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 150);
    setTimeout(doScroll, 400);
  }, []);

  // -------- utilitaires
  const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

  /** EAR (simplifié) */
  const eyesOpen = (landmarks: any[]): boolean => {
    if (!landmarks || landmarks.length < 387) return false;
    const L_TOP = landmarks[159], L_BOT = landmarks[145], L_L = landmarks[33],  L_R = landmarks[133];
    const R_TOP = landmarks[386], R_BOT = landmarks[374], R_L = landmarks[263], R_R = landmarks[362];
    if (!L_TOP || !L_BOT || !L_L || !L_R || !R_TOP || !R_BOT || !R_L || !R_R) return false;
    const leftEAR  = dist(L_TOP, L_BOT) / (dist(L_L, L_R) + 1e-6);
    const rightEAR = dist(R_TOP, R_BOT) / (dist(R_L, R_R) + 1e-6);
    return leftEAR > eyeOpenThreshold && rightEAR > eyeOpenThreshold;
  };

  /** BBox normalisée (après miroir X si besoin) */
  const bboxFromLandmarks = (lm: any[]) => {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < lm.length; i++) {
      const raw = lm[i];
      const x = MIRRORED_VIEW ? 1 - raw.x : raw.x;
      const y = raw.y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const xCenter = (minX + maxX) / 2;
    const yCenter = (minY + maxY) / 2;
    return { xMin: minX, yMin: minY, widthN: maxX - minX, heightN: maxY - minY, xCenter, yCenter };
  };

  /** Point dans le cercle */
  const isPointInsideOval = (x: number, y: number, rx: number, ry: number) => {
    const dx = x - 0.5, dy = y - 0.5;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  };

  /** Visage “majoritairement” à l’intérieur */
  const faceMostlyInsideOval = (landmarks: any[], ratio = INSIDE_RATIO): boolean => {
    if (!landmarks || !Array.isArray(landmarks) || landmarks.length === 0) return false;
    const rx = OVAL_RX_N * CENTER_STRICTNESS, ry = OVAL_RY_N * CENTER_STRICTNESS;
    let inside = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const raw = landmarks[i];
      const x = MIRRORED_VIEW ? 1 - raw.x : raw.x;
      const y = raw.y;
      if (isPointInsideOval(x, y, rx, ry)) inside++;
    }
    return inside / landmarks.length >= ratio;
  };

  /** Ratio "humain" global (SelfieSeg) */
  const computeHumanRatio = useCallback((maskEl: CanvasImageSource, videoCssW: number, videoCssH: number) => {
    if (!offscreenMaskRef.current) offscreenMaskRef.current = document.createElement("canvas");
    const off = offscreenMaskRef.current!;
    const targetW = MASK_SAMPLE_W;
    const targetH = Math.max(8, Math.round(targetW * (videoCssH / Math.max(1, videoCssW))));
    if (off.width !== targetW) off.width = targetW;
    if (off.height !== targetH) off.height = targetH;
    const ctx = off.getContext("2d");
    if (!ctx) return 0;
    try {
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(maskEl, 0, 0, targetW, targetH);
    } catch { return 0; }
    const data = ctx.getImageData(0, 0, targetW, targetH).data;
    let insideTotal = 0, insideHuman = 0;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const nx = (x + 0.5) / targetW, ny = (y + 0.5) / targetH;
        if (isPointInsideOval(nx, ny, OVAL_RX_N, OVAL_RY_N)) {
          insideTotal++;
          const i = (y * targetW + x) * 4;
          const r = data[i];
          if (r >= 128) insideHuman++;
        }
      }
    }
    if (insideTotal === 0) return 0;
    return insideHuman / insideTotal;
  }, []);

  /** AJOUT : ratio "humain" dans une ellipse ROI (coords normalisées 0..1) */
  const computeHumanRatioInEllipse = useCallback((
    maskEl: CanvasImageSource,
    videoCssW: number, videoCssH: number,
    cxN: number, cyN: number, rxN: number, ryN: number
  ) => {
    if (!offscreenMaskRef.current) offscreenMaskRef.current = document.createElement("canvas");
    const off = offscreenMaskRef.current!;
    const targetW = MASK_SAMPLE_W;
    const targetH = Math.max(8, Math.round(targetW * (videoCssH / Math.max(1, videoCssW))));
    if (off.width !== targetW) off.width = targetW;
    if (off.height !== targetH) off.height = targetH;
    const ctx = off.getContext("2d");
    if (!ctx) return 0;
    try {
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(maskEl, 0, 0, targetW, targetH);
    } catch { return 0; }
    const data = ctx.getImageData(0, 0, targetW, targetH).data;
    let tot = 0, human = 0;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const nx = (x + 0.5) / targetW, ny = (y + 0.5) / targetH;
        const dx = (nx - cxN) / Math.max(rxN, 1e-6);
        const dy = (ny - cyN) / Math.max(ryN, 1e-6);
        if (dx*dx + dy*dy <= 1) {
          tot++;
          const i = (y * targetW + x) * 4;
          const r = data[i];
          if (r >= 128) human++;
        }
      }
    }
    return tot ? human / tot : 0;
  }, []);

  /** AJOUT : test “peau” dans une ellipse ROI, à partir de la frame vidéo */
  const computeSkinRatioInEllipseFromVideo = useCallback((
    videoEl: HTMLVideoElement,
    videoCssW: number, videoCssH: number,
    cxN: number, cyN: number, rxN: number, ryN: number
  ) => {
    if (!offscreenVideoRef.current) offscreenVideoRef.current = document.createElement("canvas");
    const off = offscreenVideoRef.current!;
    const targetW = SKIN_SAMPLE_W;
    const targetH = Math.max(8, Math.round(targetW * (videoCssH / Math.max(1, videoCssW))));
    if (off.width !== targetW) off.width = targetW;
    if (off.height !== targetH) off.height = targetH;
    const ctx = off.getContext("2d");
    if (!ctx) return 0;
    try {
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(videoEl, 0, 0, targetW, targetH);
    } catch { return 0; }
    const data = ctx.getImageData(0, 0, targetW, targetH).data;

    const isSkin = (r: number, g: number, b: number) => {
      // Règles simples RGB + YCbCr
      const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
      const condRGB = (r > 95 && g > 40 && b > 20 && (maxc - minc) > 15 && Math.abs(r - g) > 15 && r > g && r > b);
      const Cb = (-0.168736*r - 0.331264*g + 0.5*b + 128);
      const Cr = (0.5*r - 0.418688*g - 0.081312*b + 128);
      const condYCbCr = (Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173);
      return condRGB || condYCbCr;
    };

    let tot = 0, skin = 0;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const nx = (x + 0.5) / targetW, ny = (y + 0.5) / targetH;
        const dx = (nx - cxN) / Math.max(rxN, 1e-6);
        const dy = (ny - cyN) / Math.max(ryN, 1e-6);
        if (dx*dx + dy*dy <= 1) {
          tot++;
          const i = (y * targetW + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2];
          if (isSkin(r,g,b)) skin++;
        }
      }
    }
    return tot ? skin / tot : 0;
  }, []);

  /** AJOUT : ratio "humain" dans une bande (upper|lower) de la bbox (via SelfieSeg) */
  const computeBandHumanRatio = useCallback((
    maskEl: CanvasImageSource,
    videoCssW: number,
    videoCssH: number,
    bb: { xMin: number; yMin: number; widthN: number; heightN: number },
    band: "upper" | "lower"
  ) => {
    if (!offscreenMaskRef.current) offscreenMaskRef.current = document.createElement("canvas");
    const off = offscreenMaskRef.current!;
    const targetW = MASK_SAMPLE_W;
    const targetH = Math.max(8, Math.round(targetW * (videoCssH / Math.max(1, videoCssW))));
    if (off.width !== targetW) off.width = targetW;
    if (off.height !== targetH) off.height = targetH;
    const ctx = off.getContext("2d");
    if (!ctx) return 1;

    try {
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(maskEl, 0, 0, targetW, targetH);
    } catch { return 1; }

    const xMinBand = bb.xMin + bb.widthN * BAND_CENTER_X_PAD;
    const xMaxBand = bb.xMin + bb.widthN * (1 - BAND_CENTER_X_PAD);
    const yStartBand =
      band === "lower"
        ? bb.yMin + bb.heightN * BAND_LOWER_START
        : bb.yMin + bb.heightN * BAND_UPPER_START;
    const yEndBand =
      band === "lower"
        ? bb.yMin + bb.heightN * BAND_LOWER_END
        : bb.yMin + bb.heightN * BAND_UPPER_END;

    const data = ctx.getImageData(0, 0, targetW, targetH).data;
    let insideTotal = 0;
    let insideHuman = 0;

    for (let py = 0; py < targetH; py++) {
      const ny = (py + 0.5) / targetH;
      if (ny < yStartBand || ny > yEndBand) continue;

      for (let px = 0; px < targetW; px++) {
        const nx = (px + 0.5) / targetW;
        if (nx < xMinBand || nx > xMaxBand) continue;

        if (!isPointInsideOval(nx, ny, OVAL_RX_N, OVAL_RY_N)) continue;

        const i = (py * targetW + px) * 4;
        const r = data[i];
        insideTotal++;
        if (r >= 128) insideHuman++;
      }
    }

    if (insideTotal === 0) return 1;
    return insideHuman / insideTotal;
  }, []);

  /** Aligner canvas + cover */
  const syncCanvasToVideo = useCallback(() => {
    const root = rootRef.current, videoEl = videoRef.current, canvas = canvasRef.current, cover = coverRef.current;
    if (!root || !videoEl || !canvas) return;

    const vr = videoEl.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const cssW = vr.width, cssH = vr.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const left = vr.left - rr.left, top = vr.top - rr.top;

    // Canvas
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const pxW = Math.round(cssW * dpr), pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Cover DOM
    if (cover) {
      cover.style.left = `${left}px`;
      cover.style.top = `${top}px`;
      cover.style.width = `${cssW}px`;
      cover.style.height = `${cssH}px`;

      const cx = cssW * 0.5;
      const cy = cssH * 0.5;
      const ringWidth = 3;
      const r = cssH * OVAL_RY_N;
      const hole = r + ringWidth / 2 + 1;

      const mask = `radial-gradient(circle ${hole}px at ${cx}px ${cy}px, transparent ${hole - 0.5}px, black ${hole}px)`;
      (cover.style as any).WebkitMaskImage = mask;
      (cover.style as any).maskImage = mask;
    }
  }, []);

  // -------- Overlay (anneau + grille + texte) — cercle
  const drawOverlay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      W: number,
      H: number,
      opts: {
        bboxPx?: { x: number; y: number; width: number; height: number };
        ok: boolean;
        progress: number;  // 0..1
        statusText: string;
        faceN?: { xCenter: number; yCenter: number; widthN: number; heightN: number };
      }
    ) => {
      const { bboxPx, ok, progress, statusText, faceN } = opts;

      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5, cy = H * 0.5;
      const r  = H * OVAL_RY_N;
      const ringWidth = 3;

      // Couleurs
      const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
      const successVar = isLight ? "--success-ring" : "--success-solid";
      const dangerVar  = isLight ? "--danger-ring"  : "--danger-solid";

      const success = colorFromVar(successVar, 0.95, isLight ? "#7EE8A6" : "#30D158");
      const danger  = colorFromVar(dangerVar,  0.95, isLight ? "#FF8088" : "#FF5A5F");
      const ringColor = ok ? success : danger;

      // Grille dans le cercle
      {
        const neutral = "rgba(190,190,190,0.78)";
        ctx.save();
        const clipR = Math.max(0, r - (ringWidth + 1));
        ctx.beginPath();
        ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
        ctx.clip();

        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.strokeStyle = ok ? success : neutral;

        let xOff = 0, yOff = 0;
        let spacing = clipR * 0.40;

        if (faceN) {
          const { xCenter, yCenter, widthN, heightN } = faceN;
          const dx = (xCenter - 0.5);
          const dy = (yCenter - 0.5);

          xOff = dx * clipR * 2.00;
          yOff = dy * clipR * 2.00;

          const norm = (v: number, vmin: number, vmax: number) =>
            Math.max(0, Math.min(1, (v - vmin) / Math.max(1e-6, vmax - vmin)));
          const tW = norm(widthN,  MIN_FACE_WIDTH_N,  MAX_FACE_WIDTH_N);
          const tH = norm(heightN, MIN_FACE_HEIGHT_N, MAX_FACE_HEIGHT_N);
          const tSize = (tW + tH) * 0.5;

          const minS = clipR * 0.18;
          const maxS = clipR * 0.36;
          const distCenter = Math.min(1, Math.hypot(dx, dy) * 2);
          const compress = 1 - 0.35 * distCenter;

          spacing = (minS + (maxS - minS) * tSize) * compress * 1.50;
        }

        const xs = [cx - spacing + xOff, cx + xOff, cx + spacing + xOff];
        const ys = [cy - spacing + yOff, cy + yOff, cy + spacing + yOff];

        const yTop = cy - clipR;
        const yBot = cy + clipR;
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i];
          ctx.beginPath();
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBot);
          ctx.stroke();
        }

        const xLeft = cx - clipR;
        const xRight = cx + clipR;
        for (let i = 0; i < ys.length; i++) {
          const y = ys[i];
          ctx.beginPath();
          ctx.moveTo(xLeft, y);
          ctx.lineTo(xRight, y);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Bord du cercle
      ctx.lineWidth = 3;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Anneau de progression
      if (progress > 0) {
        ctx.save();
        ctx.lineWidth = 6;
        ctx.strokeStyle = ringColor;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Texte d’état
      ctx.font = `${Math.max(14, Math.round(W * 0.028))}px system-ui, -apple-system, Segoe UI, Roboto`;
      ctx.fillStyle = ringColor;
      ctx.textAlign = "center";
      ctx.fillText(statusText, cx, Math.min(H - 8, cy + r + 36));
    },
    []
  );

  /** --- helpers occlusion profondeur --- */
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const pointInEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  /** Overlay de pré-chargement (gris) */
  const drawPreloadOverlay = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number) => {
    ctx.clearRect(0, 0, W, H);

    const cx = W * 0.5, cy = H * 0.5;
    const r  = H * OVAL_RY_N;
    const ringWidth = 3;

    const clipR = Math.max(0, r - (ringWidth + 1));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
    ctx.clip();

    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(190,190,190,0.78)";

    const spacing = clipR * 0.40;
    const xs = [cx - spacing, cx, cx + spacing];
    const ys = [cy - spacing, cy, cy + spacing];

    const yTop = cy - clipR;
    const yBot = cy + clipR;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      ctx.beginPath();
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
      ctx.stroke();
    }

    const xLeft = cx - clipR;
    const xRight = cx + clipR;
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i];
      ctx.beginPath();
      ctx.moveTo(xLeft, y);
      ctx.lineTo(xRight, y);
      ctx.stroke();
    }

    ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(160,160,160,0.85)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }, []);

  /** Démarre la détection dès que la vidéo est prête */
  useEffect(() => {
    if (!mediaReady) return;

    const videoEl = (webcamRef.current?.video as HTMLVideoElement) || null;
    if (!videoEl) return;
    videoRef.current = videoEl;

    const canvas = canvasRef.current;
    let cancelled = false;

    (async () => {
      try {
        await ensureVideoReady(videoEl);
        scrollIntoViewPolitely();

        // FaceMesh
        await loadScriptOnce(`${FACE_ASSETS_BASE}/face_mesh.js`, "mp-facemesh");
        const g: any = globalThis as any;
        const ns = g.FaceMesh || g.faceMesh || (g as any).mpFaceMesh || (g as any).mpface_mesh || {};
        const FaceMeshCtor = ns.FaceMesh ?? ns;
        if (typeof FaceMeshCtor !== "function") {
          console.error("[AutoFaceScanner] FaceMesh ctor introuvable", ns);
          return;
        }
        const fm: any = new FaceMeshCtor({ locateFile: locateMediaPipeFile });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.60,
          minTrackingConfidence: 0.60,
          selfieMode: true,
        });
        faceMeshRef.current = fm;

        fm.onResults((res: any) => {
          lastFaceLmRef.current = res?.multiFaceLandmarks || null;
        });

        // Hands
        await loadScriptOnce(`${HANDS_ASSETS_BASE}/hands.js`, "mp-hands");
        const gh: any = globalThis as any;
        const HandsNS = gh.Hands || gh.hands || gh.mpHands || (gh as any).mp_hands || {};
        const HandsCtor = HandsNS.Hands ?? HandsNS;
        if (typeof HandsCtor !== "function") {
          console.error("[AutoFaceScanner] Hands ctor introuvable", HandsNS);
        } else {
          const hands: any = new HandsCtor({ locateFile: locateMediaPipeFile });
          hands.setOptions({
            selfieMode: true,
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.70,
            minTrackingConfidence: 0.70,
          });
          handsRef.current = hands;
          hands.onResults((res: any) => {
            lastHandsLmRef.current = res?.multiHandLandmarks || null;
          });
        }

        // Selfie Segmentation
        await loadScriptOnce(`${SELFIE_ASSETS_BASE}/selfie_segmentation.js`, "mp-selfieseg");
        const gs: any = globalThis as any;
        const SSNS = gs.SelfieSegmentation || gs.selfieSegmentation || gs.mpSelfieSegmentation || (gs as any).mp_selfie_segmentation || {};
        const SelfieSegmentationCtor = SSNS.SelfieSegmentation ?? SSNS;
        if (typeof SelfieSegmentationCtor !== "function") {
          console.error("[AutoFaceScanner] SelfieSegmentation ctor introuvable", SSNS);
        } else {
          const ss: any = new SelfieSegmentationCtor({ locateFile: locateMediaPipeFile });
          ss.setOptions({
            modelSelection: 1, // 0: general, 1: landscape
            selfieMode: true
          });
          selfieRef.current = ss;
          ss.onResults((res: any) => {
            if (res?.segmentationMask) {
              lastSegMaskRef.current = res.segmentationMask as any;
              segReadyRef.current = true;
            }
          });
        }

        const useRVFC = typeof (videoEl as any).requestVideoFrameCallback === "function";

        const processFrame = async () => {
          if (cancelled) return;
          syncCanvasToVideo();

          // Envoi aux modèles
          if (videoRef.current) {
            try { await faceMeshRef.current?.send?.({ image: videoRef.current }); } catch {}
            try { await handsRef.current?.send?.({ image: videoRef.current }); } catch {}
            try { await selfieRef.current?.send?.({ image: videoRef.current }); } catch {}
          }

          const ctx = canvas?.getContext("2d");
          if (ctx && canvas) {
            const W = canvas.clientWidth, H = canvas.clientHeight;

            // Ratios humains (global)
            if (lastSegMaskRef.current) {
              const rAll = computeHumanRatio(lastSegMaskRef.current as CanvasImageSource, W, H);
              lastHumanRatioRef.current = rAll;
            }
            const humanOk = !segReadyRef.current || lastHumanRatioRef.current >= HUMAN_RATIO_MIN;

            let drawBBox: { x: number; y: number; width: number; height: number } | undefined;
            let exactlyOneFace = false, faceInsideOval = false, eyesOk = false, sizeOk = false, landmarksOk = false;
            let tooSmall = false, tooLarge = false;

            let occludedByDepth = false;
            let handInFace = false;

            // veto objet bas du visage (final, après temporisation)
            let lowerFaceBlockedByObject = false;

            // AJOUT : autres ROIs
            let noseBlocked = false, mouthBlocked = false, cheekLBlocked = false, cheekRBlocked = false, foreheadBlocked = false, chinBlocked = false;

            let faceBoxN:
              | { xCenter: number; yCenter: number; widthN: number; heightN: number }
              | undefined;

            const lastFace = lastFaceLmRef.current;

            if (lastFace && lastFace.length > 0) {
              exactlyOneFace = lastFace.length === 1;
              const lm = lastFace[0];

              landmarksOk = Array.isArray(lm) && lm.length >= 468;

              const bb = bboxFromLandmarks(lm);
              faceBoxN = bb;
              drawBBox = { x: bb.xMin * W, y: bb.yMin * H, width: bb.widthN * W, height: bb.heightN * H };

              faceInsideOval = faceMostlyInsideOval(lm, INSIDE_RATIO);
              sizeOk = (bb.widthN >= MIN_FACE_WIDTH_N && bb.widthN <= MAX_FACE_WIDTH_N &&
                        bb.heightN >= MIN_FACE_HEIGHT_N && bb.heightN <= MAX_FACE_HEIGHT_N);
              tooSmall = bb.widthN < MIN_FACE_WIDTH_N || bb.heightN < MIN_FACE_HEIGHT_N;
              tooLarge = bb.widthN > MAX_FACE_WIDTH_N || bb.heightN > MAX_FACE_HEIGHT_N;

              eyesOk = eyesOpen(lm);

              // Occlusion profondeur (global)
              if (landmarksOk) {
                const cx = MIRRORED_VIEW ? 1 - bb.xCenter : bb.xCenter;
                const cy = bb.yCenter;

                const rxIn  = bb.widthN  * OCCL_INNER_RX;
                const ryIn  = bb.heightN * OCCL_INNER_RY;
                const rxOut = bb.widthN  * OCCL_OUTER_RX;
                const ryOut = bb.heightN * OCCL_OUTER_RY;

                const zCenter: number[] = [];
                const zRing: number[] = [];

                for (let i = 0; i < lm.length; i++) {
                  const raw = lm[i];
                  const x = MIRRORED_VIEW ? 1 - raw.x : raw.x;
                  const y = raw.y;
                  const z = raw.z ?? 0;

                  const inInner = pointInEllipse(x, y, cx, cy, rxIn, ryIn);
                  const inOuter = pointInEllipse(x, y, cx, cy, rxOut, ryOut);

                  if (inInner) zCenter.push(z);
                  else if (inOuter) zRing.push(z);
                }

                if (zCenter.length >= 20 && zRing.length >= 30) {
                  const medC = median(zCenter);
                  const medR = median(zRing);
                  const dz = Math.abs(medC - medR);

                  let support = 0;
                  for (let k = 0; k < zCenter.length; k++) {
                    if (Math.abs(zCenter[k] - medR) > OCCL_Z_DELTA_THRESH) support++;
                  }
                  const supportRatio = support / zCenter.length;

                  occludedByDepth = dz > OCCL_Z_DELTA_THRESH && supportRatio >= OCCL_SUPPORT_RATIO;
                }
              }

              // Main dans la BBox du visage
              const handLmList = lastHandsLmRef.current;
              if (landmarksOk && handLmList && handLmList.length > 0) {
                const xMin = bb.xMin;
                const xMax = bb.xMin + bb.widthN;
                const yMin = bb.yMin;
                const yMax = bb.yMin + bb.heightN;

                outer: for (let h = 0; h < handLmList.length; h++) {
                  const hand = handLmList[h];
                  for (let j = 0; j < hand.length; j++) {
                    const raw = hand[j];
                    const x = MIRRORED_VIEW ? 1 - raw.x : raw.x;
                    const y = raw.y;
                    if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
                      handInFace = true;
                      break outer;
                    }
                  }
                }
              }

              // ----- AJOUT : Veto objet sur bas du visage (logique existante) -----
              let candidateLower = false; // ROI ellipse + peau
              let candidateBand  = false; // bandes SelfieSeg (haut/bas)

              if (segReadyRef.current && lastSegMaskRef.current) {
                // ellipse centrée sur le bas de la bbox visage
                const cxN = bb.xCenter;
                const cyN = bb.yMin + bb.heightN * LOWER_ROI_CY;
                const rxN = bb.widthN  * LOWER_ROI_RX;
                const ryN = bb.heightN * LOWER_ROI_RY;

                // 1) segmentation humaine locale
                const lowerHuman = computeHumanRatioInEllipse(
                  lastSegMaskRef.current as CanvasImageSource, W, H, cxN, cyN, rxN, ryN
                );

                // 2) peau locale (frame vidéo)
                const lowerSkin = videoRef.current
                  ? computeSkinRatioInEllipseFromVideo(videoRef.current, W, H, cxN, cyN, rxN, ryN)
                  : 0;

                candidateLower = (lowerHuman < LOWER_FACE_HUMAN_MIN) || (lowerSkin < SKIN_RATIO_MIN);

                // 3) bandes haut/bas (renforce la décision)
                const lowerBand = computeBandHumanRatio(
                  lastSegMaskRef.current as CanvasImageSource, W, H, bb, "lower"
                );
                const upperBand = computeBandHumanRatio(
                  lastSegMaskRef.current as CanvasImageSource, W, H, bb, "upper"
                );
                candidateBand = (upperBand >= BAND_UPPER_FACE_MIN) && (lowerBand < BAND_LOWER_FACE_MIN);
              }

              // Temporisation (anti-flicker) : l'objet doit durer OBJECT_HOLD_MS
              const nowT = performance.now();
              if (candidateLower || candidateBand) {
                if (lowerObjSinceRef.current === null) lowerObjSinceRef.current = nowT;
                if (nowT - (lowerObjSinceRef.current || 0) >= OBJECT_HOLD_MS) {
                  lowerObjActiveRef.current = true;
                }
              } else {
                lowerObjSinceRef.current = null;
                lowerObjActiveRef.current = false;
              }

              lowerFaceBlockedByObject = lowerObjActiveRef.current;
              // ----- fin AJOUT (logique existante) -----

              // ----- AJOUT : ROIs supplémentaires (nez, bouche, joues, front, menton) -----
              if (segReadyRef.current && lastSegMaskRef.current) {
                const checkROI = (
                  spec: RoiSpec,
                  sinceRef: React.MutableRefObject<number | null>,
                  activeRef: React.MutableRefObject<boolean>
                ): boolean => {
                  const cxN = bb.xMin + bb.widthN  * spec.cx;
                  const cyN = bb.yMin + bb.heightN * spec.cy;
                  const rxN = bb.widthN  * spec.rx;
                  const ryN = bb.heightN * spec.ry;

                  const human = computeHumanRatioInEllipse(
                    lastSegMaskRef.current as CanvasImageSource, W, H, cxN, cyN, rxN, ryN
                  );
                  const skin = videoRef.current
                    ? computeSkinRatioInEllipseFromVideo(videoRef.current, W, H, cxN, cyN, rxN, ryN)
                    : 0;

                  const candidate = (human < spec.humanMin) || (skin < spec.skinMin);
                  const t = performance.now();

                  if (candidate) {
                    if (sinceRef.current === null) sinceRef.current = t;
                    if (t - (sinceRef.current || 0) >= OBJECT_HOLD_MS) activeRef.current = true;
                  } else {
                    sinceRef.current = null;
                    activeRef.current = false;
                  }
                  return activeRef.current;
                };

                noseBlocked     = checkROI(ROI_SPECS.nose,     noseSinceRef,     noseActiveRef);
                mouthBlocked    = checkROI(ROI_SPECS.mouth,    mouthSinceRef,    mouthActiveRef);
                cheekLBlocked   = checkROI(ROI_SPECS.cheekL,   cheekLSinceRef,   cheekLActiveRef);
                cheekRBlocked   = checkROI(ROI_SPECS.cheekR,   cheekRSinceRef,   cheekRActiveRef);
                foreheadBlocked = checkROI(ROI_SPECS.forehead, foreheadSinceRef, foreheadActiveRef);
                chinBlocked     = checkROI(ROI_SPECS.chin,     chinSinceRef,     chinActiveRef);
              }
              // ----- fin AJOUT ROIs -----
            }

            const anyRegionBlocked =
              lowerFaceBlockedByObject || noseBlocked || mouthBlocked || cheekLBlocked || cheekRBlocked || foreheadBlocked || chinBlocked;

            // Logique clignement
            const baseOk =
              exactlyOneFace &&
              landmarksOk &&
              faceInsideOval &&
              sizeOk &&
              !occludedByDepth &&
              !handInFace &&
              humanOk &&
              !anyRegionBlocked;

            if (baseOk && eyesOk && !blinkTriggeredRef.current && !awaitingBlinkRef.current) {
              awaitingBlinkRef.current = true;
              wasEyesOpenRef.current = true;
            }

            if (awaitingBlinkRef.current) {
              if (!eyesOk && wasEyesOpenRef.current) {
                wasEyesOpenRef.current = false; // ouverts -> fermés
              } else if (eyesOk && !wasEyesOpenRef.current) {
                blinkTriggeredRef.current = true; // fermés -> ouverts
                awaitingBlinkRef.current = false;
              }
            }

            if (!baseOk) {
              awaitingBlinkRef.current = false;
              blinkTriggeredRef.current = false;
              wasEyesOpenRef.current = false;
              stableSinceRef.current = null;
            }

            if (blinkTriggeredRef.current && !eyesOk) {
              blinkTriggeredRef.current = false;
              stableSinceRef.current = null;
            }

            const overlayOk =
              exactlyOneFace &&
              landmarksOk &&
              faceInsideOval &&
              sizeOk &&
              !occludedByDepth &&
              !handInFace &&
              humanOk &&
              !anyRegionBlocked &&
              (eyesOk || awaitingBlinkRef.current);

            const captureOk =
              !capturedOnceRef.current && baseOk && blinkTriggeredRef.current && eyesOk;

            const now = performance.now();
            if (captureOk) {
              if (stableSinceRef.current === null) stableSinceRef.current = now;
            } else {
              stableSinceRef.current = null;
            }
            const hold = stableSinceRef.current ? now - stableSinceRef.current : 0;
            const progress = captureOk ? Math.max(0, Math.min(1, hold / STABLE_HOLD_MS)) : 0;

            // Texte d’état (ordre de priorité clair)
            let statusText = "Parfait!";
            if (!lastFace || lastFace.length === 0) statusText = "Aucun visage détecté";
            else if (!humanOk) statusText = "Personne non détectée";
            else if (!exactlyOneFace) statusText = "1 seul visage requis";
            else if (tooSmall) statusText = "Approche-toi un peu";
            else if (tooLarge) statusText = "Recule un peu";
            else if (!faceInsideOval) statusText = "Entre bien dans le cercle";
            else if (handInFace) statusText = "Visage masqué par une main";
            else if (mouthBlocked) statusText = "Objet masque la bouche";
            else if (noseBlocked) statusText = "Objet masque le nez";
            else if (cheekLBlocked) statusText = "Objet masque la joue gauche";
            else if (cheekRBlocked) statusText = "Objet masque la joue droite";
            else if (foreheadBlocked) statusText = "Objet masque le front";
            else if (chinBlocked) statusText = "Objet masque le menton";
            else if (lowerFaceBlockedByObject) statusText = "Objet masque le bas du visage";
            else if (occludedByDepth) statusText = "Visage partiellement masqué";
            else if (!eyesOk) statusText = "Ouvre les yeux";
            else if (!landmarksOk) statusText = "Visage partiellement couvert";

            // Rendu overlay
            drawOverlay(ctx, W, H, {
              bboxPx: drawBBox,
              ok: overlayOk,
              progress,
              statusText,
              faceN: faceBoxN
            });
            if (!markedMpReadyRef.current) {
              markedMpReadyRef.current = true;
              setReady(true);
            }

            // Capture (après stabilité + clignement)
            if (captureOk && hold >= STABLE_HOLD_MS && !capturedOnceRef.current) {
              capturedOnceRef.current = true;
              try {
                const dataUrl = webcamRef.current?.getScreenshot();
                if (dataUrl) {
                  const blob = await fetch(dataUrl).then((r) => r.blob());
                  onCapture({ dataUrl, blob });
                }
              } catch {
                capturedOnceRef.current = false; // retry
              }
            }
          }
        };

        const rvfcPump = (_: any, __: any) => {
          processFrame().finally(() => { if (!cancelled) (videoEl as any).requestVideoFrameCallback(rvfcPump); });
        };
        const rafPump  = () => {
          processFrame().finally(() => { if (!cancelled) rafIdRef.current = requestAnimationFrame(rafPump); });
        };

        if (useRVFC) (videoEl as any).requestVideoFrameCallback(rvfcPump);
        else rafIdRef.current = requestAnimationFrame(rafPump);
      } catch (err) {
        console.error("[AutoFaceScanner] init error:", err);
      }
    })();

    const onResize = () => syncCanvasToVideo();
    const onScroll = () => syncCanvasToVideo();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      cancelled = true;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;

      try { faceMeshRef.current?.close?.(); } catch {}
      try { handsRef.current?.close?.(); } catch {}
      try { selfieRef.current?.close?.(); } catch {}

      faceMeshRef.current = null;
      handsRef.current = null;
      selfieRef.current = null;

      lastFaceLmRef.current = null;
      lastHandsLmRef.current = null;

      stableSinceRef.current = null;
      capturedOnceRef.current = false;
      markedMpReadyRef.current = false;

      awaitingBlinkRef.current = false;
      blinkTriggeredRef.current = false;
      wasEyesOpenRef.current = false;

      segReadyRef.current = false;
      lastSegMaskRef.current = null;
      lastHumanRatioRef.current = 1;
      offscreenMaskRef.current = null;
      offscreenVideoRef.current = null;

      lowerObjSinceRef.current = null;
      lowerObjActiveRef.current = false;

      noseSinceRef.current = null;
      noseActiveRef.current = false;
      mouthSinceRef.current = null;
      mouthActiveRef.current = false;
      cheekLSinceRef.current = null;
      cheekLActiveRef.current = false;
      cheekRSinceRef.current = null;
      cheekRActiveRef.current = false;
      foreheadSinceRef.current = null;
      foreheadActiveRef.current = false;
      chinSinceRef.current = null;
      chinActiveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaReady, width, height, eyeOpenThreshold, drawOverlay, syncCanvasToVideo, scrollIntoViewPolitely, onCapture, computeHumanRatio, computeHumanRatioInEllipse, computeSkinRatioInEllipseFromVideo, computeBandHumanRatio]);

  /** Overlay de PRÉ-CHARGEMENT (jusqu’au 1er rendu MediaPipe) */
  useEffect(() => {
    const canvas = canvasRef.current;
    const videoEl = (webcamRef.current?.video as HTMLVideoElement) || null;

    if (!canvas || !videoEl || !mediaReady || ready) return;

    let cancelled = false;

    const run = async () => {
      await ensureVideoReady(videoEl);
      if (cancelled || ready) return;

      const tick = () => {
        if (cancelled || ready) return;
        syncCanvasToVideo();
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const W = canvas.clientWidth;
          const H = canvas.clientHeight;
          drawPreloadOverlay(ctx, W, H);
        }
        preRafIdRef.current = requestAnimationFrame(tick);
      };

      tick();
    };

    run();

    return () => {
      cancelled = true;
      if (preRafIdRef.current) cancelAnimationFrame(preRafIdRef.current);
      preRafIdRef.current = null;
    };
  }, [mediaReady, ready, syncCanvasToVideo, drawPreloadOverlay]);

  useEffect(() => { scrollIntoViewPolitely(); }, [scrollIntoViewPolitely]);

  return (
    <div
      ref={rootRef}
      className="relative w-full max-w=[min(92vw,1280px)]"
      style={{ aspectRatio: `${width}/${height}` }}
    >
      {/* Vidéo (miroir pour selfie) */}
      <Webcam
        ref={webcamRef}
        audio={false}
        mirrored={MIRRORED_VIEW}
        onUserMedia={() => setMediaReady(true)}
        onUserMediaError={() => setMediaReady(false)}
        screenshotFormat="image/jpeg"
        screenshotQuality={1}
        forceScreenshotSourceSize
        videoConstraints={{
          facingMode: "user",
          width:  { ideal: IDEAL_W, max: 9999 },
          height: { ideal: IDEAL_H, max: 9999 },
          frameRate: { ideal: 30, max: 60 },
        }}
        className="w-full h-full object-contain"
      />

      {/* Cover DOM : masque tout sauf le cercle */}
      <div
        ref={coverRef}
        className="absolute pointer-events-none rounded-2xl"
        style={{
          left: 0, top: 0,
          backgroundColor: "var(--bg)",
          transition: "none",
          willChange: "background-color,-webkit-mask-image,mask-image",
          zIndex: 1
        }}
      />

      {/* Canvas au-dessus */}
      <canvas
        ref={canvasRef}
        className="absolute pointer-events-none rounded-2xl"
        style={{ left: 0, top: 0, zIndex: 2 }}
      />
    </div>
  );
}
