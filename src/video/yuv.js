// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
// Conversion RVB → Y′CbCr 4:2:0 selon UIT-R BT.709, faite par la puce graphique, dans le contexte WebGL du rendu 3D
// (aucune copie d'image entre contextes : l'image rendue est copiée en texture sur la puce, la marque et la légende
// sont une seconde texture refaite seulement quand la légende change).
//
// Pourquoi : chaque webview convertit à sa façon une image RVB donnée à l'encodeur (mesuré : Chromium en BT.601 ;
// WebKit en plage limitée, mais le flux se dit « plage pleine », d'où une vidéo délavée). Une image I420 est encodée
// telle quelle par les deux : on lui donne du BT.709 dans la plage que l'encodeur annoncera (sondée avant le rendu),
// et ce que dit le fichier est enfin vrai.
//
// Un passage de shader écrit l'image I420 (plan Y, puis Cb, puis Cr) dans une cible RGBA de W/4 × 1,5·H texels :
// chaque texel porte quatre octets consécutifs. La lecture passe par des tampons de pixels (PBO) et une barrière :
// le processeur n'attend pas la puce, l'image suivante se calcule pendant que la précédente remonte.
import * as THREE from 'three';

const VS = `in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D tScene;
uniform sampler2D tOver;
uniform int W;
uniform int H;
uniform float full;
uniform int mode; // 0 : I420 empaqueté ; 1 : RVBA, ligne du haut en premier (master par ffmpeg)
out vec4 o;
const vec3 KY = vec3(0.2126, 0.7152, 0.0722);
// Pixel (x, y depuis le haut) : rendu 3D, puis marque et légende par-dessus. Les deux textures ont le bas en ligne 0.
vec3 px(ivec2 q) {
  ivec2 t = ivec2(q.x, H - 1 - q.y);
  vec3 c = texelFetch(tScene, t, 0).rgb;
  vec4 a = texelFetch(tOver, t, 0);
  return mix(c, a.rgb, a.a);
}
float yOf(vec3 c) { float e = dot(c, KY); return full > 0.5 ? e : (16.0 + 219.0 * e) / 255.0; }
vec2 cOf(vec3 c) {
  float e = dot(c, KY);
  vec2 d = vec2((c.b - e) / 1.8556, (c.r - e) / 1.5748);
  return full > 0.5 ? d + 128.0 / 255.0 : (128.0 + 224.0 * d) / 255.0;
}
float byteAt(int i) {
  int n = W * H;
  if (i < n) return yOf(px(ivec2(i % W, i / W)));
  int cw = W / 2, cs = cw * (H / 2), j = i - n;
  bool v = j >= cs;
  if (v) j -= cs;
  ivec2 b = ivec2(j % cw, j / cw) * 2;
  vec3 c = 0.25 * (px(b) + px(b + ivec2(1, 0)) + px(b + ivec2(0, 1)) + px(b + ivec2(1, 1)));
  vec2 uv = cOf(c);
  return v ? uv.y : uv.x;
}
void main() {
  if (mode == 1) { o = vec4(px(ivec2(gl_FragCoord.xy)), 1.0); return; }
  int base = int(gl_FragCoord.y) * W + int(gl_FragCoord.x) * 4;
  o = vec4(byteAt(base), byteAt(base + 1), byteAt(base + 2), byteAt(base + 3));
}`;

/**
 * Convertisseur pour des images W × H (W multiple de 4, H pair) rendues par `renderer` (WebGL 2).
 * full : plage pleine (0–255) au lieu de la plage limitée (16–235).
 * setOverlay(canvas) : marque et légende, transparentes ailleurs (à rappeler quand elles changent).
 * capture(timestamp µs, duration µs) : juste après renderer.render(), sur la toile ; rend une Promise<VideoFrame>
 * (options.rgba : Promise<Uint8Array> RVBA W × H, ligne du haut en premier, pour un master par ffmpeg).
 * Pas plus de `depth` captures en attente à la fois.
 */
export function createYuv(renderer, W, H, options = {}) {
  const { full = false, depth = 3 } = options;
  const gl = renderer.getContext();
  if (W % 4 || H % 2 || !renderer.capabilities.isWebGL2 || !gl.fenceSync) return null;
  const sceneTex = new THREE.FramebufferTexture(W, H, THREE.RGBAFormat);
  let overTex = null;
  const rt = new THREE.WebGLRenderTarget(W / 4, (H * 3) / 2, { depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
    uniforms: { tScene: { value: sceneTex }, tOver: { value: blank }, W: { value: W }, H: { value: H }, full: { value: full ? 1 : 0 }, mode: { value: 0 } }
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rgba = options.rgba, size = rgba ? W * H * 4 : (W * H * 3) / 2, origin = new THREE.Vector2(0, 0);
  if (rgba) { rt.setSize(W, H); mat.uniforms.mode.value = 1; }
  const slots = Array.from({ length: depth }, () => {
    const buf = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf); gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
    return { buf, data: new Uint8Array(size), busy: null };
  });
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: full };
  let n = 0;

  function setOverlay(canvas) {
    if (!overTex || overTex.image !== canvas) {
      if (overTex) overTex.dispose();
      overTex = new THREE.CanvasTexture(canvas);
      Object.assign(overTex, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      mat.uniforms.tOver.value = overTex;
    }
    overTex.needsUpdate = true;
  }

  async function capture(timestamp, duration) {
    const slot = slots[n++ % depth];
    if (slot.busy) await slot.busy;
    renderer.copyFramebufferToTexture(origin, sceneTex);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(qScene, qCam);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buf);
    gl.readPixels(0, 0, rgba ? W : W / 4, rgba ? H : (H * 3) / 2, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    renderer.setRenderTarget(prev);
    const job = (async () => {
      while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise(r => setTimeout(r, 1));
      gl.deleteSync(sync);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, slot.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (rgba) return slot.data.slice(); // octets RVBA pour ffmpeg (copie : le créneau resservira)
      // VideoFrame copie les octets : le créneau peut resservir tout de suite.
      return new VideoFrame(slot.data, { format: 'I420', codedWidth: W, codedHeight: H, timestamp, duration, colorSpace });
    })();
    slot.busy = job.then(() => {}, () => {});
    return job;
  }

  function dispose() {
    for (const s of slots) gl.deleteBuffer(s.buf);
    sceneTex.dispose(); if (overTex) overTex.dispose(); blank.dispose(); rt.dispose(); mat.dispose(); quad.geometry.dispose();
  }
  return { capture, setOverlay, dispose, full };
}

/**
 * Plage que l'encodeur annoncera pour des images I420 (il les encode telles quelles) : on encode une petite image
 * avec le même codec et on lit ce qu'il déclare. Rend true (plage pleine), false (limitée) ou null (inconnu).
 */
export async function probeFullRange(config) {
  const W = 320, H = 180;
  let full = null;
  try {
    const enc = new VideoEncoder({ output: (c, m) => { const cs = m && m.decoderConfig && m.decoderConfig.colorSpace; if (cs && typeof cs.fullRange === 'boolean') full = cs.fullRange; }, error: () => {} });
    const { codec, hardwareAcceleration } = config;
    enc.configure({ codec, hardwareAcceleration, width: W, height: H, bitrate: 1e6, framerate: 30, ...(config.avc ? { avc: config.avc } : {}) });
    const d = new Uint8Array((W * H * 3) / 2).fill(128);
    const f = new VideoFrame(d, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: 0, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } });
    enc.encode(f, { keyFrame: true }); f.close();
    await enc.flush(); enc.close();
  } catch (e) { return null; }
  return full;
}
