import html2canvas from "html2canvas";
import { PaperFoldGeometry } from "./PaperFoldGeometry";

type Direction = 1 | -1;
type Snapshot = { front: HTMLCanvasElement; back: HTMLCanvasElement };

const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));

/** A continuous, textured sheet. The document is rasterized once per turn, before any
 * geometry is drawn. Every frame then changes one shared WebGL mesh, so there are no
 * independently composited DOM strips for the Android WebView to separate. */
export class FlexiblePageCurl {
  private static serial = 0;
  private readonly columns = 128;
  private readonly rows = 64;
  private readonly geometry = new PaperFoldGeometry();
  private page: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private frontTexture: WebGLTexture | null = null;
  private backTexture: WebGLTexture | null = null;
  /* A phone has a single visible leaf: forward uses its prepared next-page verso,
     while a backward turn uses the previous page already rendered underneath. The
     cache therefore keeps those two physical faces separately. */
  private static readonly snapshotCache = new WeakMap<HTMLElement, Map<string, Promise<Snapshot>>>();
  private readonly snapshots = FlexiblePageCurl.snapshotCache;
  private token = 0;
  private width = 0;
  private height = 0;
  private scale = 1;
  private direction: Direction = 1;
  private touchX = 1;
  private touchY = .5;
  private speed = 0;
  private progress = 0;

  /** `ready` is intentionally separate from mounted: until both textures exist, the
   * DOM PageCurl underneath remains visible and opaque. */
  public get mounted(): boolean { return this.canvas !== null && this.gl !== null; }
  public get ready(): boolean { return this.page?.classList.contains("page-turn-flexible-ready") ?? false; }

  /** Started at pointerdown, before horizontal intent is resolved. No page is hidden. */
  public prepare(page: HTMLElement, backSource: HTMLElement | null = null): void {
    if (!page.clientWidth || !page.clientHeight) return;
    const key = this.snapshotKey(backSource);
    const cache = this.snapshots.get(page) ?? new Map<string, Promise<Snapshot>>();
    if (cache.has(key)) return;
    this.snapshots.set(page, cache);
    const capture = this.capture(page, backSource);
    cache.set(key, capture);
    void capture.catch(error => {
      page.dataset.curlCaptureError = error instanceof Error && /color function/.test(error.message) ? "unsupported_color" : "snapshot_failed";
      if (cache.get(key) === capture) cache.delete(key);
      if (!cache.size) this.snapshots.delete(page);
    });
  }

  public mount(page: HTMLElement, direction: Direction, backSource: HTMLElement | null = null): void {
    this.unmount();
    if (!page.clientWidth || !page.clientHeight || typeof document === "undefined") return;
    this.page = page;
    this.width = page.clientWidth;
    this.height = page.clientHeight;
    this.scale = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
    this.direction = direction;
    this.prepare(page, backSource);
    const canvas = document.createElement("canvas");
    canvas.className = "page-turn-flexible";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.width = `${this.width * 2}px`;
    canvas.style.height = `${this.height}px`;
    canvas.width = Math.round(this.width * 2 * this.scale);
    canvas.height = Math.round(this.height * this.scale);
    page.append(canvas);
    this.canvas = canvas;
    // Empty canvas pixels reveal the underlying page; every paper fragment writes
    // alpha=1. Making the whole canvas opaque hides the revealed page as a rectangle.
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl || !this.initialize(gl)) { canvas.remove(); this.canvas = null; this.page = null; return; }
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      page.classList.remove("page-turn-flexible-ready");
      this.gl = null;
    }, { once: true });
    const token = ++this.token;
    const snapshot = this.snapshots.get(page)?.get(this.snapshotKey(backSource));
    void snapshot?.then(snapshot => {
      if (this.token !== token || this.page !== page || !this.gl) return;
      this.frontTexture = this.texture(this.gl, snapshot.front);
      this.backTexture = this.texture(this.gl, snapshot.back);
      this.draw();
      page.classList.add("page-turn-flexible-ready");
    }).catch(() => { /* The original, opaque DOM sheet remains visible. */ });
  }

  public setPointer(x: number, y: number, velocityX = 0): void {
    this.touchX = clamp(x / Math.max(1, this.width));
    this.touchY = clamp(y / Math.max(1, this.height));
    this.speed = clamp(Math.abs(velocityX) / 1.6);
  }

  public apply(progress: number, _landingAngle: number, direction: Direction): void {
    this.progress = clamp(progress);
    this.direction = direction;
    if (this.canvas) this.canvas.style.left = direction === 1 ? `${-this.width}px` : "0px";
    this.draw();
  }

  public unmount(): void {
    ++this.token;
    this.page?.classList.remove("page-turn-flexible-ready");
    if (this.gl) {
      if (this.frontTexture) this.gl.deleteTexture(this.frontTexture);
      if (this.backTexture) this.gl.deleteTexture(this.backTexture);
      if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
      if (this.indexBuffer) this.gl.deleteBuffer(this.indexBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.canvas?.remove();
    this.page = null;
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.frontTexture = null;
    this.backTexture = null;
  }

  private snapshotKey(backSource: HTMLElement | null): string {
    return backSource ? `under:${backSource.dataset.page ?? "previous"}` : "verso";
  }

  private async capture(page: HTMLElement, backSource: HTMLElement | null): Promise<Snapshot> {
    const front = this.captureFace(page, "front");
    const back = backSource ? this.captureFace(backSource, "source") : this.captureFace(page, "verso");
    return Promise.all([front, back]).then(([frontFace, backFace]) => ({ front: frontFace, back: backFace }));
  }

  private async captureFace(page: HTMLElement, face: "front" | "verso" | "source"): Promise<HTMLCanvasElement> {
    const marker = `page-curl-${++FlexiblePageCurl.serial}`;
    page.dataset.curlCapture = marker;
    const style = getComputedStyle(page);
    const paper = this.rgb(style.backgroundColor !== "rgba(0, 0, 0, 0)" ? style.backgroundColor :
      getComputedStyle(page.closest<HTMLElement>(".reader") ?? page).getPropertyValue("--reader-paper-lit").trim() || "#f7f2e8");
    const ink = this.rgb(style.color);
    const snapshot = html2canvas(page, {
      backgroundColor: paper,
      scale: Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 3000,
      onclone: clonedDocument => {
        // html2canvas 1.x cannot parse modern color()/color-mix() syntax. Resolve
        // computed colors through the browser's sRGB canvas only in the capture copy.
        const clone = [...clonedDocument.querySelectorAll<HTMLElement>("[data-curl-capture]")]
          .find(element => element.dataset.curlCapture === marker);
        if (!clone) return;
        /* html2canvas paints only the captured element and its descendants, so only they
           need their colours rewritten. Walking the whole cloned document instead cost
           every capture one getComputedStyle per property per element of the entire
           reader: a desktop spread keeps six full pages in the DOM against three sheets on
           a phone, and each turn needs four captures - measured in production, the fold
           was not ready until ~1.5s into the drag and an arrow turn never got one. */
        const resolved=new Map<string,string>();
        const rgb=(color:string)=>{let value=resolved.get(color);if(value===undefined){value=this.rgb(color);resolved.set(color,value);}return value;};
        const properties=["color","background-color","border-top-color","border-right-color","border-bottom-color","border-left-color","text-decoration-color","outline-color"];
        for(const element of [clone,...clone.querySelectorAll<HTMLElement>("*")]){
          const computed=clonedDocument.defaultView!.getComputedStyle(element);
          /* Chromium exposes inherited ink to a number of vendor and logical colour
             properties (not only `color`). html2canvas parses those too, so normalize
             every computed value that still contains modern colour syntax. */
          for(const property of computed){
            const value=computed.getPropertyValue(property);
            if(!/(?:color|lab|lch)\(/.test(value))continue;
            const normalized=value.replace(/(?:color|oklab|oklch|lab|lch)\([^()]*\)/g,color=>rgb(color));
            element.style.setProperty(property,normalized,"important");
          }
          for(const property of properties){
            const value=computed.getPropertyValue(property);
            if(/(?:color|lab|lch)\(/.test(value))element.style.setProperty(property,rgb(value),"important");
          }
          for(const property of ["background-image","box-shadow","text-shadow"]){
            const value=computed.getPropertyValue(property);
            if(/(?:color|lab|lch)\(/.test(value))element.style.setProperty(property,value.replace(/(?:color|oklab|oklch|lab|lch)\([^()]*\)/g,color=>rgb(color)),"important");
          }
        }
        /* Pseudo-elements are not present in querySelectorAll above.  Keep their
           inherited paper/ink variables to plain rgba in the cloned tree as well:
           html2canvas 1.x otherwise encounters the WebView's computed `color()`
           value while parsing ::before/::after and aborts the capture. */
        clone.style.setProperty("--reader-paper-lit", paper, "important");
        clone.style.setProperty("--reader-paper", paper, "important");
        clone.style.setProperty("--reader-ink", ink, "important");
        clone.style.setProperty("--reader-custom-ink", ink, "important");
        clone.classList.remove("page-turn-active", "page-turn-curled", "page-turn-flexible-ready");
        clone.style.cssText += ";transform:none!important;visibility:visible!important;overflow:hidden!important;";
        clone.querySelectorAll(".page-turn-curl,.page-turn-flexible").forEach(element => element.remove());
        const verso = clone.querySelector<HTMLElement>(":scope > .page-turn-verso");
        if (face === "front" || face === "source") verso?.remove();
        if (face === "verso") {
          [...clone.children].forEach(child => { if (child !== verso) child.remove(); });
          if (verso) verso.style.cssText += `;display:block!important;opacity:1!important;transform:none!important;visibility:visible!important;background-color:${paper}!important;background-image:none!important;`;
        }
      },
    });
    try {
      return await snapshot;
    } finally {
      if (page.dataset.curlCapture === marker) delete page.dataset.curlCapture;
    }
  }

  private rgb(color:string):string {
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
    const context=canvas.getContext("2d")!;
    context.fillStyle=color;context.fillRect(0,0,1,1);
    const [r,g,b,a]=context.getImageData(0,0,1,1).data;
    return `rgba(${r},${g},${b},${a!/255})`;
  }

  private initialize(gl: WebGLRenderingContext): boolean {
    const vertex = this.shader(gl, gl.VERTEX_SHADER, `
      attribute vec3 aPosition;
      attribute vec2 aUv;
      attribute float aLight;
      varying vec2 vUv;
      varying float vLight;
      void main(){gl_Position=vec4(aPosition,1.0);vUv=aUv;vLight=aLight;}`);
    const fragment = this.shader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uFront;
      uniform sampler2D uBack;
      uniform float uDirection;
      varying vec2 vUv;
      varying float vLight;
      void main(){
        bool front = gl_FrontFacing == (uDirection > 0.0);
        float sourceX = front ? (uDirection > 0.0 ? vUv.x : 1.0-vUv.x)
                              : (uDirection > 0.0 ? 1.0-vUv.x : vUv.x);
        vec4 ink = front ? texture2D(uFront,vec2(sourceX,vUv.y))
                         : texture2D(uBack,vec2(sourceX,vUv.y));
        gl_FragColor=vec4(ink.rgb * vLight,1.0);
      }`);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return false; }
    const vertexBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
    if (!vertexBuffer || !indexBuffer) { gl.deleteProgram(program); return false; }
    this.program = program;
    this.vertexBuffer = vertexBuffer;
    this.indexBuffer = indexBuffer;
    const indices: number[] = [];
    for (let row = 0; row < this.rows; row++) for (let column = 0; column < this.columns; column++) {
      const a = row * (this.columns + 1) + column;
      const b = a + 1, c = a + this.columns + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, this.canvas!.width, this.canvas!.height);
    return true;
  }

  private shader(gl: WebGLRenderingContext, kind: number, source: string): WebGLShader | null {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  private texture(gl: WebGLRenderingContext, canvas: HTMLCanvasElement): WebGLTexture | null {
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  private draw(): void {
    const gl = this.gl, program = this.program;
    if (!gl || !program || !this.frontTexture || !this.backTexture || !this.vertexBuffer || !this.indexBuffer) return;
    const vertices = this.vertices();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    for (const [name, size, offset] of [["aPosition", 3, 0], ["aUv", 2, 3], ["aLight", 1, 5]] as const) {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) continue;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frontTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uFront"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backTexture);
    gl.uniform1i(gl.getUniformLocation(program, "uBack"), 1);
    gl.uniform1f(gl.getUniformLocation(program, "uDirection"), this.direction);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.columns * this.rows * 6, gl.UNSIGNED_SHORT, 0);
  }

  /** Integrates the tangent of a cylindrical fold along the paper, separately for each
   * Y row. Moving the finger vertically advances the near corner first; moving it in X
   * shifts the crest. The curvature radius also responds to gesture speed. */
  private vertices(): Float32Array {
    return this.geometry.build(this.width,this.height,this.columns,this.rows,this.progress,this.direction,this.touchX,this.touchY,this.speed);
  }
}
