import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, EdgesGeometry, Group, HemisphereLight,
  LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFShadowMap,
  PerspectiveCamera, Plane, Quaternion, Raycaster, RepeatWrapping, Scene, ShadowMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
  BufferGeometry, Float32BufferAttribute, type Material,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CartonUp, PalletSpec } from './pallet-calculator-model';
import { extentOf, type BuilderBox, type BuilderItem, type Deck, type Extent, type Solid, type SpillLevel } from './pallet-builder-model';

/**
 * The three.js side of 3D laden: the pallet or the Deense kar, the omdozen
 * in kraft brown with the ENROSED mark, the shadow on the ground, the camera
 * that turns around the load, and the ray from the pointer to a place on the
 * floor. Everything is in cm; the floor's corner is at (-length/2, base,
 * -width/2), so the carrier stands in the middle. A product can be put in
 * focus (the others fade) and marked (its boxes get edges in its colour);
 * the box under the mouse gets a light shell; a box that sticks out over the
 * floor's edge or the loading height an orange shell (a little) or a red one
 * (too much). It renders only when something changed.
 */

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Kraft, the colour of a plain brown omdoos. */
const KRAFT = '#c0905f';
const KRAFT_DARK = '#a8794b';
const INK = '#3a2615';

interface Look {
  signature: string;
  key: number;
  colour: Color;
  geometry: BoxGeometry;
  edges: EdgesGeometry;
  materials: MeshStandardMaterial[];
  /** Each product's own edges, so its boxes can be marked or faded together. */
  line: LineBasicMaterial;
  faded: boolean;
}

const EDGE = new Color(0x5b3c20);
/** The ghost and the spill shells: fits, sticks out a little, sticks out too much. */
const LEVEL_COLOUR: Readonly<Record<SpillLevel, number>> = { none: 0x2e9b62, little: 0xe08a1e, much: 0xd2453c };
const BLACK = new Color(0x000000);
const EDGE_OPACITY = 0.42;

export interface Aim { centreX: number; centreZ: number }

/** A box on its way to a new place or side: where it started, where it goes, since when. */
interface Tween { from: Vector3; fromTurn: Quaternion; to: Vector3; toTurn: Quaternion; start: number }

/** How long a turn or a tip takes on screen. */
const TWEEN_MS = 280;

export class BuilderScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 1, 8000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly carrier = new Group();
  private readonly boxes = new Group();
  private readonly ground: Mesh;
  private readonly sun: DirectionalLight;
  private readonly looks = new Map<number, Look>();
  private readonly meshes = new Map<number, Mesh>();
  private readonly ghostFill = new MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false });
  private readonly ghostLine = new LineBasicMaterial({ transparent: true, opacity: 0.95 });
  private readonly pickedFill: MeshBasicMaterial;
  private readonly hoverFill = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly spillFill: Readonly<Record<'little' | 'much', MeshBasicMaterial>> = {
    little: new MeshBasicMaterial({ color: LEVEL_COLOUR.little, transparent: true, opacity: 0.34, depthWrite: false }),
    much: new MeshBasicMaterial({ color: LEVEL_COLOUR.much, transparent: true, opacity: 0.42, depthWrite: false }),
  };
  private readonly spillLine: Readonly<Record<'little' | 'much', LineBasicMaterial>> = {
    little: new LineBasicMaterial({ color: LEVEL_COLOUR.little }),
    much: new LineBasicMaterial({ color: LEVEL_COLOUR.much }),
  };
  private spillLevels: ReadonlyMap<number, SpillLevel> = new Map();
  private readonly pickedLine: LineBasicMaterial;
  private readonly accent: Color;
  private readonly inkLogo: HTMLCanvasElement | null;
  private readonly woodTexture: CanvasTexture;
  private ghost: Group | null = null;
  private ghostKey: string | null = null;
  private picked: Group | null = null;
  private pickedId: number | null = null;
  private hovered: Group | null = null;
  private hoveredId: number | null = null;
  private focusKeys: ReadonlySet<number> | null = null;
  private focusSignature = '';
  private insetTop = 0;
  /** The user turned or zoomed the view: a change of the inset no longer reframes it. */
  private moved = false;
  private markedKeys: ReadonlySet<number> | null = null;
  private hiddenId: number | null = null;
  private deck: Deck = { lengthCm: 120, widthCm: 80, usableCm: 240, spillXCm: 0, spillZCm: 0 };
  private base = 14.4;
  private frame = 0;
  private dirty = true;
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  /** The boxes the next setBoxes moves smoothly (a turn, a tip and what stands on it); null moves none. */
  private animateIds: ReadonlySet<number> | null = null;
  private readonly tweens = new Map<number, Tween>();
  private readonly calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly host: HTMLElement, logo: HTMLImageElement | null, accent: string) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;outline:none';
    host.prepend(this.canvas);

    this.accent = new Color(accent || '#b01f3f');
    this.pickedFill = new MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.16, depthWrite: false });
    this.pickedLine = new LineBasicMaterial({ color: this.accent });
    this.inkLogo = logo ? inkedLogo(logo) : null;
    this.woodTexture = woodTexture();

    this.scene.add(new HemisphereLight(0xffffff, 0xcdbfb1, 1.9));
    this.sun = new DirectionalLight(0xfff6ea, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-300, 200, -250);
    this.scene.add(fill);

    this.ground = new Mesh(new CircleGeometry(1, 64), new ShadowMaterial({ opacity: 0.16 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.carrier, this.boxes);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1400;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.render());
    this.controls.addEventListener('start', () => { this.moved = true; });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /** OrbitControls listens on the canvas: off while a box is being dragged. */
  set orbit(enabled: boolean) { this.controls.enabled = enabled; }

  /** The pallet or the kar, with the loading height drawn as a dashed frame; the camera frames it. */
  setCarrier(kind: 'pallet' | 'kar', spec: PalletSpec, deck: Deck): void {
    const changed = this.deck.lengthCm !== deck.lengthCm || this.deck.widthCm !== deck.widthCm || this.base !== spec.baseHeightCm
      || this.carrier.userData['kind'] !== kind || this.deck.usableCm !== deck.usableCm;
    this.deck = deck;
    this.base = spec.baseHeightCm;
    if (!changed && this.carrier.children.length) return;
    disposeTree(this.carrier);
    this.carrier.clear();
    this.carrier.userData['kind'] = kind;
    this.carrier.add(kind === 'kar' ? karModel(deck, this.base) : palletModel(deck, this.base, this.woodTexture));
    this.carrier.add(heightFrame(deck, this.base, this.accent));
    const reach = Math.max(deck.lengthCm, deck.widthCm);
    this.ground.scale.setScalar(reach * 2.4);
    const shadow = this.sun.shadow.camera;
    shadow.left = -reach * 1.6; shadow.right = reach * 1.6; shadow.top = reach * 1.6; shadow.bottom = -reach * 1.6;
    shadow.near = 10; shadow.far = 2400;
    shadow.updateProjectionMatrix();
    this.sun.position.set(reach * 1.1, 520, reach * 1.6);
    this.sun.target.position.set(0, 0, 0);
    this.frameView();
  }

  /** The look of each product's omdoos: geometry, edges and the six printed faces. */
  setItems(items: readonly BuilderItem[], photos: ReadonlyMap<number, HTMLImageElement>): void {
    const keep = new Set<number>();
    for (const item of items) {
      if (!(item.lengthCm > 0 && item.widthCm > 0 && item.heightCm > 0)) continue;
      keep.add(item.key);
      const photo = photos.get(item.key) ?? null;
      const signature = [item.lengthCm, item.widthCm, item.heightCm, item.colour, item.groupTitle, item.colourName, item.colourHex, photo?.src ?? ''].join('|');
      const known = this.looks.get(item.key);
      if (known?.signature === signature) continue;
      if (known) disposeLook(known);
      this.looks.set(item.key, this.look(item, signature, photo));
      for (const mesh of this.meshes.values()) if (mesh.userData['key'] === item.key) mesh.userData['signature'] = null;
    }
    for (const [key, look] of this.looks) if (!keep.has(key)) { disposeLook(look); this.looks.delete(key); }
    this.paintFocus();
    this.render();
  }

  /**
   * Colours in focus (the rest fades to a shadow of itself) and colours
   * marked (their boxes glow, edges in the product's colour); null for none.
   * A whole product is all its colours.
   */
  setFocus(focus: ReadonlySet<number> | null, marked: ReadonlySet<number> | null): void {
    const signature = `${focus ? [...focus].join(',') : '-'}|${marked ? [...marked].join(',') : '-'}`;
    if (signature === this.focusSignature) return;
    this.focusSignature = signature;
    this.focusKeys = focus;
    this.markedKeys = marked;
    this.paintFocus();
    this.render();
  }

  /** A light shell around the box under the mouse. */
  setHover(id: number | null): void {
    if (this.hoveredId === id) return;
    if (this.hovered) { this.hovered.removeFromParent(); disposeTree(this.hovered, false); this.hovered = null; }
    this.hoveredId = id;
    const mesh = id === null || id === this.pickedId ? undefined : this.meshes.get(id);
    const look = mesh ? this.looks.get(mesh.userData['key'] as number) : undefined;
    if (mesh && look) {
      this.hovered = shell(look.geometry, this.hoverFill, look.line);
      mesh.add(this.hovered);
    }
    this.render();
  }

  private paintFocus(): void {
    for (const look of this.looks.values()) {
      const faded = !!this.focusKeys && !this.focusKeys.has(look.key);
      if (faded !== look.faded) {
        look.faded = faded;
        for (const material of new Set(look.materials)) {
          material.transparent = faded;
          material.opacity = faded ? 0.14 : 1;
          material.depthWrite = !faded;
          material.needsUpdate = true;
        }
      }
      const marked = !faded && (!!this.markedKeys?.has(look.key) || !!this.focusKeys?.has(look.key));
      look.line.color.copy(marked ? look.colour : EDGE);
      look.line.opacity = faded ? 0.1 : marked ? 1 : EDGE_OPACITY;
      /* A marked product's cartons glow faintly in its colour, so all of them read at a glance. */
      for (const material of new Set(look.materials)) {
        material.emissive.copy(marked ? look.colour : BLACK);
        material.emissiveIntensity = marked ? 0.28 : 0;
      }
    }
    for (const mesh of this.meshes.values()) {
      const look = this.looks.get(mesh.userData['key'] as number);
      mesh.castShadow = !look?.faded;
    }
  }

  /** The next setBoxes moves these boxes smoothly to their new place and side (a turn, a tip, what stood on it). */
  animateNext(ids: ReadonlySet<number> | null): void {
    this.animateIds = ids;
  }

  /** The boxes as they stand now: meshes come, go and move to match. */
  setBoxes(boxes: readonly BuilderBox[], items: ReadonlyMap<number, BuilderItem>): void {
    const present = new Set<number>();
    const animate = this.calm ? null : this.animateIds;
    this.animateIds = null;
    for (const box of boxes) {
      const item = items.get(box.key);
      const look = this.looks.get(box.key);
      if (!item || !look) continue;
      present.add(box.id);
      let mesh = this.meshes.get(box.id);
      const known = !!mesh && mesh.userData['signature'] === look.signature;
      if (!mesh || !known) {
        if (mesh) this.dropMesh(box.id);
        mesh = new Mesh(look.geometry, look.materials);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.add(new LineSegments(look.edges, look.line));
        mesh.castShadow = !look.faded;
        mesh.userData['id'] = box.id;
        mesh.userData['key'] = box.key;
        mesh.userData['signature'] = look.signature;
        this.meshes.set(box.id, mesh);
        this.boxes.add(mesh);
      }
      const from = known && animate?.has(box.id) ? { at: mesh.position.clone(), turn: mesh.quaternion.clone() } : null;
      this.pose(mesh, extentOf(item, box.up, box.turned), box.x, box.y, box.z, box.up, box.turned);
      if (from && (from.at.distanceToSquared(mesh.position) > 1e-4 || from.turn.angleTo(mesh.quaternion) > 1e-4)) {
        this.tweens.set(box.id, { from: from.at, fromTurn: from.turn, to: mesh.position.clone(), toTurn: mesh.quaternion.clone(), start: performance.now() });
        mesh.position.copy(from.at);
        mesh.quaternion.copy(from.turn);
      } else {
        this.tweens.delete(box.id);
      }
      mesh.visible = box.id !== this.hiddenId;
    }
    for (const id of [...this.meshes.keys()]) if (!present.has(id)) this.dropMesh(id);
    for (const id of [...this.tweens.keys()]) if (!present.has(id)) this.tweens.delete(id);
    this.paintSpill();
    this.markPicked(this.pickedId);
    if (this.hoveredId !== null && !this.meshes.has(this.hoveredId)) this.setHover(null);
    this.render();
  }

  /** How far each box sticks out: an orange or red shell where it does. */
  setSpill(levels: ReadonlyMap<number, SpillLevel>): void {
    this.spillLevels = levels;
    this.paintSpill();
    this.render();
  }

  private paintSpill(): void {
    for (const [id, mesh] of this.meshes) {
      const level = this.spillLevels.get(id) ?? 'none';
      const current = mesh.userData['spill'] as { level: SpillLevel; shell: Group } | undefined;
      if ((current?.level ?? 'none') === level) continue;
      if (current) { current.shell.removeFromParent(); disposeTree(current.shell, false); mesh.userData['spill'] = undefined; }
      const look = this.looks.get(mesh.userData['key'] as number);
      if (level === 'none' || !look) continue;
      /* Just outside the chosen box's ring, so the orange or red reads even on the chosen box. */
      const box = shell(look.geometry, this.spillFill[level], this.spillLine[level], 1.6);
      mesh.add(box);
      mesh.userData['spill'] = { level, shell: box };
    }
  }

  /** The ring around the chosen box. */
  markPicked(id: number | null): void {
    if (this.picked) { this.picked.removeFromParent(); disposeTree(this.picked, false); this.picked = null; }
    this.pickedId = id;
    const mesh = id === null ? undefined : this.meshes.get(id);
    const look = mesh ? this.looks.get(mesh.userData['key'] as number) : undefined;
    if (mesh && look) {
      this.picked = shell(look.geometry, this.pickedFill, this.pickedLine);
      mesh.add(this.picked);
      if (this.hoveredId === id) this.setHover(null);
    }
    this.render();
  }

  /** A box being moved is drawn as its ghost only. */
  hide(id: number | null): void {
    this.hiddenId = id;
    for (const [boxId, mesh] of this.meshes) mesh.visible = boxId !== id;
    this.render();
  }

  /** The ghost of a box on its way: green where it fits, orange where it sticks out a little, red where too much; null hides it. */
  showGhost(item: BuilderItem | null, at: { x: number; y: number; z: number; up: CartonUp; turned: boolean } | null, level: SpillLevel): void {
    if (!item || !at) {
      if (this.ghost) this.ghost.visible = false;
      this.render();
      return;
    }
    const look = this.looks.get(item.key);
    if (!look) return;
    if (!this.ghost || this.ghostKey !== look.signature) {
      if (this.ghost) { this.ghost.removeFromParent(); this.ghost.clear(); }
      this.ghost = new Group();
      this.ghost.add(new Mesh(look.geometry, [...look.materials.map(() => this.ghostFill)]), new LineSegments(look.edges, this.ghostLine));
      this.ghostKey = look.signature;
      this.scene.add(this.ghost);
    }
    const colour = LEVEL_COLOUR[level];
    this.ghostFill.color.setHex(colour);
    this.ghostLine.color.setHex(colour);
    this.ghost.visible = true;
    this.pose(this.ghost, extentOf(item, at.up, at.turned), at.x, at.y, at.z, at.up, at.turned);
    this.render();
  }

  /** The box under the pointer, if any. */
  boxAt(clientX: number, clientY: number): number | null {
    this.ray(clientX, clientY);
    const hit = this.raycaster.intersectObjects([...this.meshes.values()].filter((mesh) => mesh.visible), false)[0];
    return hit ? (hit.object.userData['id'] as number) : null;
  }

  /**
   * Where the middle of a box of this size goes for the pointer: on top of
   * the box it points at, beside it when it points at a side, else where the
   * ray meets the floor. Null when the pointer is above the horizon.
   */
  aim(clientX: number, clientY: number, extent: Extent, solids: readonly Solid[], skip: number | null): Aim | null {
    this.ray(clientX, clientY);
    const targets = [...this.meshes.values()].filter((mesh) => mesh.visible && mesh.userData['id'] !== skip);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const halfL = this.deck.lengthCm / 2; const halfW = this.deck.widthCm / 2;
    if (hit) {
      const solid = solids.find((candidate) => candidate.id === hit.object.userData['id']);
      if (solid) {
        const px = hit.point.x + halfL; const py = hit.point.y - this.base; const pz = hit.point.z + halfW;
        const near = (a: number, b: number) => Math.abs(a - b) < 0.75;
        if (near(py, solid.y + solid.sy)) return { centreX: px, centreZ: pz };
        if (near(px, solid.x + solid.sx)) return { centreX: solid.x + solid.sx + extent.sx / 2, centreZ: pz };
        if (near(px, solid.x)) return { centreX: solid.x - extent.sx / 2, centreZ: pz };
        if (near(pz, solid.z + solid.sz)) return { centreX: px, centreZ: solid.z + solid.sz + extent.sz / 2 };
        if (near(pz, solid.z)) return { centreX: px, centreZ: solid.z - extent.sz / 2 };
        return { centreX: px, centreZ: pz };
      }
    }
    const point = new Vector3();
    if (!this.raycaster.ray.intersectPlane(new Plane(Y_AXIS, -this.base), point)) return null;
    return { centreX: point.x + halfL, centreZ: point.z + halfW };
  }

  /** Is this screen point over the canvas? */
  contains(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  /** Back to the view that shows the whole carrier. */
  frameView(): void {
    const { lengthCm, widthCm, usableCm } = this.deck;
    const top = this.base + usableCm;
    /* The whole carrier and its loading height in view, with room for the figures along the top. */
    const target = new Vector3(0, top * 0.47, 0);
    /* Height and floor are fitted apart, so a tall phone screen shows the load as large as a wide desk does. */
    const footprint = Math.sqrt(lengthCm * lengthCm + widthCm * widthCm) / 2;
    /* Fitted into the free part under the figures: the virtual image is taller than the canvas by the inset. */
    const height = Math.max(1, this.host.clientHeight);
    const inset = Math.min(this.insetTop, height * 0.4);
    const half = Math.tan(((this.camera.fov * Math.PI) / 180) / 2);
    const vertical = (half * (height - inset)) / (height + inset);
    const horizontal = half * this.camera.aspect;
    const distance = Math.max(top / 2 / vertical, footprint / horizontal) * 1.08 + footprint * 0.5;
    const direction = new Vector3(0.82, 0.52, 1).normalize();
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.target.copy(target);
    this.controls.update();
    this.moved = false;
    this.render();
  }

  render(): void {
    this.dirty = true;
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const look of this.looks.values()) disposeLook(look);
    this.looks.clear();
    disposeTree(this.carrier);
    if (this.picked) disposeTree(this.picked, false);
    if (this.hovered) disposeTree(this.hovered, false);
    this.ground.geometry.dispose();
    (this.ground.material as Material).dispose();
    [this.ghostFill, this.ghostLine, this.pickedFill, this.pickedLine, this.hoverFill, this.spillFill.little, this.spillFill.much,
      this.spillLine.little, this.spillLine.much].forEach((material) => material.dispose());
    this.woodTexture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private readonly tick = (): void => {
    this.frame = 0;
    if (this.disposed) return;
    const tweening = this.stepTweens();
    const moving = this.controls.update() || tweening;
    if (moving || this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
    if (moving) this.frame = requestAnimationFrame(this.tick);
  };

  /** One frame of the boxes on their way: eased out, the turn along the shortest arc. True while one still moves. */
  private stepTweens(): boolean {
    if (!this.tweens.size) return false;
    const now = performance.now();
    for (const [id, tween] of this.tweens) {
      const mesh = this.meshes.get(id);
      const t = Math.min(1, (now - tween.start) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      if (mesh) {
        mesh.position.lerpVectors(tween.from, tween.to, eased);
        mesh.quaternion.slerpQuaternions(tween.fromTurn, tween.toTurn, eased);
      }
      if (t >= 1 || !mesh) this.tweens.delete(id);
    }
    return true;
  }

  private resize(): void {
    this.renderer.setSize(Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight), false);
    this.applyView();
  }

  /**
   * The figures and the legend lie over the top of the view: the picture's
   * middle moves down by their height (a taller virtual image of which the
   * canvas shows the top), so the load centres in the free part below them.
   */
  setInsetTop(pixels: number): void {
    if (Math.abs(pixels - this.insetTop) < 1) return;
    this.insetTop = pixels;
    this.applyView();
    if (!this.moved) this.frameView();
  }

  private applyView(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const inset = Math.min(this.insetTop, height * 0.4);
    this.camera.aspect = width / (height + inset);
    if (inset > 0) this.camera.setViewOffset(width, height + inset, 0, 0, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private ray(clientX: number, clientY: number): void {
    /* The camera's and the boxes' matrices are fresh even when no frame was drawn yet (a page in the background draws none). */
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
  }

  /** A box's place: its middle above the floor's corner, turned onto its side and a quarter on the floor as asked. */
  private pose(object: Object3D, extent: Extent, x: number, y: number, z: number, up: CartonUp, turned: boolean): void {
    object.position.set(x + extent.sx / 2 - this.deck.lengthCm / 2, this.base + y + extent.sy / 2, z + extent.sz / 2 - this.deck.widthCm / 2);
    const tilt = new Quaternion();
    if (up === 'w') tilt.setFromAxisAngle(X_AXIS, Math.PI / 2);
    else if (up === 'l') tilt.setFromAxisAngle(Z_AXIS, Math.PI / 2);
    const yaw = new Quaternion();
    if (turned) yaw.setFromAxisAngle(Y_AXIS, Math.PI / 2);
    object.quaternion.copy(yaw.multiply(tilt));
  }

  private dropMesh(id: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    if (this.pickedId === id && this.picked) { this.picked.removeFromParent(); disposeTree(this.picked, false); this.picked = null; }
    if (this.hoveredId === id && this.hovered) { this.hovered.removeFromParent(); disposeTree(this.hovered, false); this.hovered = null; this.hoveredId = null; }
    const spill = mesh.userData['spill'] as { shell: Group } | undefined;
    if (spill) disposeTree(spill.shell, false);
    mesh.removeFromParent();
    this.meshes.delete(id);
  }

  /**
   * The omdoos in its own axes: x its length, y its height, z its width.
   * Faces in BoxGeometry's order: the two ends, top, bottom, the two long sides.
   */
  private look(item: BuilderItem, signature: string, photo: HTMLImageElement | null): Look {
    const geometry = new BoxGeometry(item.lengthCm, item.heightCm, item.widthCm);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const material = (canvas: HTMLCanvasElement) => {
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = anisotropy;
      return new MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 });
    };
    const seed = item.key * 7919;
    const end = material(face(item.widthCm, item.heightCm, 'end', this.inkLogo, item, photo, seed + 1));
    const top = material(face(item.lengthCm, item.widthCm, 'top', this.inkLogo, item, photo, seed + 2));
    const bottom = material(face(item.lengthCm, item.widthCm, 'bottom', this.inkLogo, item, photo, seed + 3));
    const side = material(face(item.lengthCm, item.heightCm, 'side', this.inkLogo, item, photo, seed + 4));
    return {
      signature, key: item.key, colour: new Color(item.colour), geometry, edges: new EdgesGeometry(geometry),
      materials: [end, end, top, bottom, side, side],
      line: new LineBasicMaterial({ color: EDGE, transparent: true, opacity: EDGE_OPACITY }), faded: false,
    };
  }
}

/* ---------------------------------------------------------------- printing */

/** The ENROSED logo (logo-ui.png, black) as brown ink. */
function inkedLogo(logo: HTMLImageElement): HTMLCanvasElement | null {
  if (!logo.naturalWidth || !logo.naturalHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = logo.naturalWidth;
  canvas.height = logo.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(logo, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = INK;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FaceKind = 'side' | 'end' | 'top' | 'bottom';

/**
 * One printed face of the omdoos, drawn to its own proportions: kraft with
 * fibres and a darker rim; the long sides carry the ENROSED mark, the ends a
 * smaller mark and a label with the product's colour and name, the top a
 * strip of tape in the product's colour.
 */
function face(
  widthCm: number, heightCm: number, kind: FaceKind, logo: HTMLCanvasElement | null, item: BuilderItem, photo: HTMLImageElement | null, seed: number,
): HTMLCanvasElement {
  const perCm = Math.min(10, Math.max(3, 512 / Math.max(widthCm, heightCm)));
  const width = Math.max(16, Math.round(widthCm * perCm));
  const height = Math.max(16, Math.round(heightCm * perCm));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const rand = random(seed);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#c99a69');
  gradient.addColorStop(1, KRAFT);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const fibres = Math.round((width * height) / 260);
  context.lineWidth = Math.max(1, perCm * 0.12);
  for (let index = 0; index < fibres; index++) {
    const x = rand() * width; const y = rand() * height; const length = (0.4 + rand() * 1.4) * perCm;
    const angle = (rand() - 0.5) * 0.9;
    context.strokeStyle = rand() < 0.55 ? 'rgb(110 72 36 / 9%)' : 'rgb(255 236 205 / 10%)';
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    context.stroke();
  }
  context.strokeStyle = 'rgb(90 58 28 / 22%)';
  context.lineWidth = Math.max(2, perCm * 0.5);
  context.strokeRect(0, 0, width, height);

  if (kind === 'top' || kind === 'bottom') {
    /* The flaps meet along the middle; the top is closed with tape in the product's colour. */
    const tape = Math.max(perCm * 4.5, height * 0.2);
    const y = (height - tape) / 2;
    if (kind === 'top') {
      /* The tape in the colour inside, the product's own mark where the colour has no swatch. */
      context.fillStyle = item.colourHex || item.colour;
      context.globalAlpha = 0.82;
      context.fillRect(0, y, width, tape);
      context.globalAlpha = 1;
      context.fillStyle = 'rgb(255 255 255 / 22%)';
      context.fillRect(0, y + tape * 0.12, width, tape * 0.1);
      context.fillStyle = 'rgb(0 0 0 / 12%)';
      context.fillRect(0, y + tape - Math.max(1, perCm * 0.2), width, Math.max(1, perCm * 0.2));
    } else {
      context.fillStyle = KRAFT_DARK;
      context.fillRect(0, height / 2 - Math.max(1, perCm * 0.15), width, Math.max(2, perCm * 0.3));
    }
    return canvas;
  }

  /* The mark in the upper part, the label under it: the product's colour, photo and name. */
  const logoCentre = height * (kind === 'side' ? 0.3 : 0.2);
  if (logo) {
    let logoWidth = width * (kind === 'side' ? 0.58 : 0.72);
    let logoHeight = logoWidth * (logo.height / logo.width);
    const maxHeight = height * (kind === 'side' ? 0.2 : 0.14);
    if (logoHeight > maxHeight) { logoHeight = maxHeight; logoWidth = logoHeight * (logo.width / logo.height); }
    context.globalAlpha = 0.88;
    context.drawImage(logo, (width - logoWidth) / 2, logoCentre - logoHeight / 2, logoWidth, logoHeight);
    context.globalAlpha = 1;
  } else {
    context.fillStyle = INK;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${Math.round(height * 0.12)}px Georgia, serif`;
    context.fillText('ENROSED', width / 2, logoCentre, width * 0.8);
  }
  const labelWidth = width * (kind === 'side' ? 0.7 : 0.86);
  const labelHeight = Math.min(height * (kind === 'side' ? 0.42 : 0.48), labelWidth * 0.62);
  drawLabel(context, item, photo, (width - labelWidth) / 2, height * (kind === 'side' ? 0.47 : 0.36), labelWidth, labelHeight, perCm);
  return canvas;
}

/** A white sticker: a band in the product's colour, its photo when there is one, its name as large as it fits. */
function drawLabel(
  context: CanvasRenderingContext2D, item: BuilderItem, photo: HTMLImageElement | null, x: number, y: number, width: number, height: number, perCm: number,
): void {
  context.fillStyle = '#fcfaf6';
  context.shadowColor = 'rgb(60 40 20 / 28%)';
  context.shadowBlur = perCm * 0.5;
  context.fillRect(x, y, width, height);
  context.shadowBlur = 0;
  const band = Math.max(3, width * 0.06);
  context.fillStyle = item.colour;
  context.fillRect(x, y, band, height);
  let textX = x + band + width * 0.04;
  if (photo && photo.naturalWidth && photo.naturalHeight && width > height * 1.6) {
    const size = height * 0.84;
    const top = y + (height - size) / 2;
    const crop = Math.min(photo.naturalWidth, photo.naturalHeight);
    try {
      context.drawImage(photo, (photo.naturalWidth - crop) / 2, (photo.naturalHeight - crop) / 2, crop, crop, textX, top, size, size);
      textX += size + width * 0.04;
    } catch { /* a photo the canvas may not read: the name alone */ }
  }
  const textWidth = x + width - textX - width * 0.03;
  if (!item.colourName) { writeLabel(context, item.groupTitle, textX, y, textWidth, height); return; }
  /* The name above, the colour under it: a swatch and its name. */
  writeLabel(context, item.groupTitle, textX, y, textWidth, height * 0.64);
  const size = Math.max(6, Math.min(height * 0.2, textWidth / 6));
  const lineY = y + height * 0.62;
  const dot = size * 0.8;
  context.fillStyle = item.colourHex || '#d9cfc4';
  context.beginPath();
  context.arc(textX + dot / 2, lineY + size * 0.55, dot / 2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgb(0 0 0 / 25%)';
  context.lineWidth = Math.max(1, size * 0.06);
  context.stroke();
  context.fillStyle = '#4a3b30';
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.font = `600 ${Math.round(size)}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  context.fillText(item.colourName, textX + dot + size * 0.4, lineY, textWidth - dot - size * 0.4);
}

/** The product's name on the label, on at most three lines, as large as it fits. */
function writeLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number): void {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = Math.floor(height * 0.36); size >= 6; size--) {
    context.font = `700 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= width || !line) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const fits = lines.length * size * 1.15 <= height * 0.82 && lines.every((candidate) => context.measureText(candidate).width <= width);
    if (fits || size === 6) {
      context.fillStyle = '#2b211b';
      context.textBaseline = 'top';
      context.textAlign = 'left';
      const top = y + (height - lines.length * size * 1.15) / 2;
      lines.slice(0, 3).forEach((candidate, index) => context.fillText(candidate, x, top + index * size * 1.15, width));
      return;
    }
  }
}

/** Pine with a grain along the board. */
function woodTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#dcc093';
    context.fillRect(0, 0, 256, 64);
    const rand = random(97);
    for (let line = 0; line < 26; line++) {
      const y = rand() * 64;
      context.strokeStyle = rand() < 0.5 ? 'rgb(150 105 55 / 22%)' : 'rgb(255 240 210 / 25%)';
      context.lineWidth = 0.6 + rand() * 1.6;
      context.beginPath();
      for (let x = 0; x <= 256; x += 8) context.lineTo(x, y + Math.sin(x / (18 + rand() * 30) + line) * 1.6);
      context.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/* ---------------------------------------------------------------- carriers */

function block(group: Group, material: Material, x0: number, y0: number, z0: number, sx: number, sy: number, sz: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x0 + sx / 2, y0 + sy / 2, z0 + sz / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Spread n pieces of this size over a length, the outer ones at the edges. */
function spread(length: number, size: number, count: number): number[] {
  if (count <= 1) return [(length - size) / 2];
  return Array.from({ length: count }, (_, index) => (index * (length - size)) / (count - 1));
}

/**
 * A wooden pallet of this floor, its wood as high as the base: deck boards
 * along the length, three cross boards, nine blocks, three bottom boards
 * (the europallet's build, scaled to the blokpallet and the halve pallet).
 */
function palletModel(deck: Deck, base: number, grain: CanvasTexture): Group {
  const group = new Group();
  const { lengthCm: length, widthCm: width } = deck;
  const board = Math.min(2.2, base / 6.5);
  const blockHeight = base - board * 3;
  const tones = ['#e2c79c', '#d8bb8d', '#ddc296'].map((colour) => new MeshStandardMaterial({ color: colour, map: grain, roughness: 0.88 }));
  const blockWood = new MeshStandardMaterial({ color: '#c9a675', map: grain, roughness: 0.9 });
  const deckBoards = width <= 60 ? 4 : width <= 85 ? 5 : 7;
  const deckBoard = (width * 0.74) / deckBoards;
  spread(width, deckBoard, deckBoards).forEach((z, index) =>
    block(group, tones[index % tones.length], 0, base - board, z, length, board, deckBoard));
  const blockLength = Math.min(14.5, length * 0.12);
  const blockWidth = Math.min(14.5, width * 0.15);
  for (const x of spread(length, blockLength, 3)) {
    block(group, tones[1], x, base - board * 2, 0, blockLength, board, width);
    for (const z of spread(width, blockWidth, 3)) block(group, blockWood, x, board, z, blockLength, blockHeight, blockWidth);
  }
  spread(width, blockWidth, 3).forEach((z, index) => block(group, tones[(index + 2) % tones.length], 0, 0, z, length, board, blockWidth));
  group.position.set(-length / 2, 0, -deck.widthCm / 2);
  return group;
}

/**
 * The Deense kar (CC Container): a galvanised base plate on four castors,
 * the floor between the posts, two ladder ends with a post at each corner
 * up to 190 cm. Shelves are not drawn: the load stands on the base plate.
 */
function karModel(deck: Deck, base: number): Group {
  const group = new Group();
  const { lengthCm: length, widthCm: width } = deck;
  const steel = new MeshStandardMaterial({ color: '#c3cace', metalness: 0.25, roughness: 0.42 });
  const plate = new MeshStandardMaterial({ color: '#aeb6bb', metalness: 0.2, roughness: 0.55 });
  const rubber = new MeshStandardMaterial({ color: '#2d2b2a', roughness: 0.8 });
  const post = 4; const side = 1; const plateHeight = 3.5;
  block(group, plate, -post, base - plateHeight, -side, length + post * 2, plateHeight, width + side * 2);
  /* The rim of the plate. */
  block(group, steel, -post, base - plateHeight - 1.5, -side, length + post * 2, 1.5, 2.2);
  block(group, steel, -post, base - plateHeight - 1.5, width + side - 2.2, length + post * 2, 1.5, 2.2);
  const wheel = Math.min(6.25, (base - plateHeight) / 2.1);
  for (const x of [6, length - 6]) {
    for (const z of [5, width - 5]) {
      const tyre = new Mesh(new CylinderGeometry(wheel, wheel, 3.4, 24), rubber);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(x, wheel, z);
      tyre.castShadow = true;
      group.add(tyre);
      block(group, steel, x - 2.4, wheel, z - 2.6, 4.8, base - plateHeight - 1.5 - wheel, 5.2);
    }
  }
  const postTop = 190;
  for (const x of [-post, length]) {
    for (const z of [-side, width + side - 3]) block(group, steel, x, base - plateHeight, z, post, postTop - base + plateHeight, 3);
    /* The ladder end: a top bar and three rungs. */
    for (const y of [postTop - 2.5, 140, 90, 40]) block(group, steel, x + 0.6, y, -side + 3, post - 1.2, 2.2, width + side * 2 - 6);
  }
  group.position.set(-length / 2, 0, -width / 2);
  return group;
}

/** The loading height as a dashed frame above the floor's edges. */
function heightFrame(deck: Deck, base: number, accent: Color): LineSegments {
  const { lengthCm: length, widthCm: width, usableCm } = deck;
  const top = base + usableCm;
  const x0 = -length / 2; const x1 = length / 2; const z0 = -width / 2; const z1 = width / 2;
  const points = [
    x0, top, z0, x1, top, z0, x1, top, z0, x1, top, z1, x1, top, z1, x0, top, z1, x0, top, z1, x0, top, z0,
    x0, base, z0, x0, top, z0, x1, base, z0, x1, top, z0, x1, base, z1, x1, top, z1, x0, base, z1, x0, top, z1,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const lines = new LineSegments(geometry, new LineDashedMaterial({ color: accent, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6 }));
  lines.computeLineDistances();
  return lines;
}

/** A shell a little larger than the box (margin in cm), drawn with these materials. */
function shell(geometry: BoxGeometry, fill: Material, line: LineBasicMaterial, margin = 0.8): Group {
  const { width, height, depth } = geometry.parameters;
  const outer = new BoxGeometry(width + margin, height + margin, depth + margin);
  const group = new Group();
  group.add(new Mesh(outer, fill), new LineSegments(new EdgesGeometry(outer), line));
  return group;
}

function disposeLook(look: Look): void {
  look.geometry.dispose();
  look.edges.dispose();
  look.line.dispose();
  for (const material of new Set(look.materials)) { material.map?.dispose(); material.dispose(); }
}

/** Frees the geometries (and the materials, unless they are shared) under an object. */
function disposeTree(root: Object3D, materials = true): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (materials && mesh.material) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
  });
}
