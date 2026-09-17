import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const FLOOR = 100;
const GRID = FLOOR;
const MARGIN = 10;

const LANE_MIN_X = -FLOOR / 2 + MARGIN;
const LANE_MAX_X = FLOOR / 2 - MARGIN;

const Z_MIN = -FLOOR / 2 + 3;
const Z_MAX = FLOOR / 2 - 3;

const CANVAS_PX = 512;
const PX_PER_M = CANVAS_PX / FLOOR;

const VACUUM_SWATH = 1.5;
const MODEL_SCALE = 1.7;

// ------------------------------------------------------------
// Роборуки
// ------------------------------------------------------------

const ARM_BELT_X = 2.0;
const ARM_BELT_START_Z = -5.85;
const ARM_BELT_END_Z = 5.85;
const ARM_PICKUP_Z = 0;
const ARM_LENGTH = 2.0;

const BOX_GAP = 0.85;

const ARM_LEFT_ANGLE = Math.PI;
const ARM_RIGHT_ANGLE = 0;
const ARM_CENTER_ANGLE = 0;

const ARM_PICKUP_Y = -0.92;
const ARM_CARRY_Y = -0.15;

// ------------------------------------------------------------
// Насыщенная пастельная палитра
// ------------------------------------------------------------

const PALETTE = {
  chunkA: "#E7C8C3",
  chunkB: "#9CCBC5",

  storage: "#37394F",
  armZone: "#4C5070",
  pad: "#8B78C7",

  crateA: "#E5A13F",
  crateB: "#C85E70",
  crateC: "#5D9E96",

  robotBody: "#FFF1DC",

  vacuumCaps: [
    "#E5A13F",
    "#C85E70",
    "#4F9B90",
    "#8B78C7",
    "#D98279",
    "#E5A13F",
    "#C85E70",
    "#4F9B90",
  ],

  armAccents: [
    "#8B78C7",
    "#C85E70",
    "#4F9B90",
    "#E5A13F",
    "#8B78C7",
    "#C85E70",
  ],

  trail: "rgba(255,238,198,0.40)",

  belt: "#292B3D",
  beltStripe: "#D4B96F",
};

const ISO_ELEV = Math.atan(1 / Math.sqrt(2));

// ============================================================
// Утилиты
// ============================================================

function computeChunks(count, zoneWidth, zoneOffsetX) {
  const zoneLength = Z_MAX - Z_MIN;

  const cols = Math.max(
    1,
    Math.round(
      Math.sqrt(
        (count * zoneWidth) /
          zoneLength
      )
    )
  );

  const fullRows = Math.floor(
    count / cols
  );

  const remainder =
    count -
    fullRows * cols;

  const totalRows =
    fullRows +
    (remainder > 0 ? 1 : 0);

  const rowHeight =
    zoneLength /
    totalRows;

  const chunks = [];

  for (
    let row = 0;
    row < totalRows;
    row++
  ) {
    const colsInRow =
      row < fullRows
        ? cols
        : remainder;

    if (colsInRow <= 0) {
      continue;
    }

    const colWidth =
      zoneWidth /
      colsInRow;

    for (
      let c = 0;
      c < colsInRow;
      c++
    ) {
      chunks.push({
        xMin:
          zoneOffsetX +
          c * colWidth,

        xMax:
          zoneOffsetX +
          (c + 1) *
            colWidth,

        zMin:
          Z_MIN +
          row * rowHeight,

        zMax:
          Z_MIN +
          (row + 1) *
            rowHeight,

        row,
        col: c,
      });
    }
  }

  return chunks;
}

function buildRowCenters(chunk) {
  const width =
    chunk.xMax -
    chunk.xMin;

  const numRows =
    Math.max(
      1,
      Math.ceil(
        width /
          VACUUM_SWATH
      )
    );

  const centers = [];

  for (
    let i = 0;
    i < numRows;
    i++
  ) {
    let rx =
      chunk.xMin +
      VACUUM_SWATH *
        (i + 0.5);

    if (
      rx >
      chunk.xMax -
        VACUUM_SWATH / 2
    ) {
      rx =
        chunk.xMax -
        VACUUM_SWATH / 2;
    }

    centers.push(rx);
  }

  return centers;
}

function easeInOut(t) {
  return t < 0.5
    ? 2 * t * t
    : 1 -
      Math.pow(
        -2 * t + 2,
        2
      ) /
        2;
}

// ------------------------------------------------------------
// Цветовой pipeline Three.js r186
// ------------------------------------------------------------

function applyColorSpace(
  target,
  isRenderer
) {
  if (isRenderer) {
    target.outputColorSpace =
      THREE.SRGBColorSpace;
  } else {
    target.colorSpace =
      THREE.SRGBColorSpace;
  }
}

// ============================================================
// Основной компонент
// ============================================================

export default function WarehouseRoboticsSim() {
  const mountRef =
    useRef(null);

  const st =
    useRef({}).current;

  const [mode, setMode] =
    useState("both");

  const [
    vacuumCount,
    setVacuumCount,
  ] = useState(4);

  const [
    vacuumProd,
    setVacuumProd,
  ] = useState(3000);

  const [
    armCount,
    setArmCount,
  ] = useState(3);

  const [
    armProd,
    setArmProd,
  ] = useState(15);

  const [
    running,
    setRunning,
  ] = useState(true);

  const [
    resetKey,
    setResetKey,
  ] = useState(0);

  const [
    coverage,
    setCoverage,
  ] = useState(0);

  const [
    opsDone,
    setOpsDone,
  ] = useState(0);

  const [
    simSeconds,
    setSimSeconds,
  ] = useState(0);

  const [
    doneCount,
    setDoneCount,
  ] = useState(0);

  const [
    camZoom,
    setCamZoom,
  ] = useState(40);

  const [
    speedMult,
    setSpeedMult,
  ] = useState(1);

  const useVacuum =
    mode === "vacuum" ||
    mode === "both";

  const useArm =
    mode === "arm" ||
    mode === "both";

  const usableWidth =
    LANE_MAX_X -
    LANE_MIN_X;

  const vacuumZoneWidth =
    mode === "vacuum"
      ? usableWidth
      : mode === "arm"
        ? 0
        : usableWidth * 0.55;

  const armZoneWidth =
    mode === "arm"
      ? usableWidth
      : mode === "vacuum"
        ? 0
        : usableWidth * 0.45;

  const zoneSplitX =
    LANE_MIN_X +
    vacuumZoneWidth;

  const vacuumSpeed =
    useVacuum
      ? vacuumProd /
        (VACUUM_SWATH * 3600)
      : 0;

  const vacuumZoneAreaM2 =
    Math.round(
      vacuumZoneWidth *
        (Z_MAX - Z_MIN)
    );

  const armCycleHz =
    useArm
      ? armProd / 60
      : 0;

  const totalOpsCapacity =
    useArm
      ? armCount * armProd
      : 0;

  // ==========================================================
  // СЦЕНА
  // ==========================================================

  useEffect(() => {
    const mount =
      mountRef.current;

    if (!mount) return;

    const width =
      mount.clientWidth;

    const height = 460;

    const scene =
      new THREE.Scene();

    scene.fog =
      new THREE.Fog(
        0x77798f,
        145,
        245
      );

    // ==========================================================
    // Освещение
    // ==========================================================

    const hemisphereLight =
      new THREE.HemisphereLight(
        0xe9e3ff,
        0x35384e,
        3
      );

    scene.add(
      hemisphereLight
    );

    const ambientLight =
      new THREE.AmbientLight(
        0x777b9d,
        0.17
      );

    scene.add(
      ambientLight
    );

    const keyLight =
      new THREE.DirectionalLight(
        0xffdca2,
        3
      );

    keyLight.position.set(
      38,
      90,
      32
    );

    keyLight.castShadow =
      true;

    keyLight.shadow.camera.left =
      -70;

    keyLight.shadow.camera.right =
      70;

    keyLight.shadow.camera.top =
      70;

    keyLight.shadow.camera.bottom =
      -70;

    keyLight.shadow.camera.near =
      1;

    keyLight.shadow.camera.far =
      230;

    keyLight.shadow.mapSize.width =
      2048;

    keyLight.shadow.mapSize.height =
      2048;

    keyLight.shadow.bias =
      -0.00012;

    keyLight.shadow.normalBias =
      0.035;

    keyLight.shadow.radius =
      4;

    scene.add(
      keyLight
    );

    const fillLight =
      new THREE.DirectionalLight(
        0x8498d4,
        0.30
      );

    fillLight.position.set(
      -45,
      48,
      -42
    );

    scene.add(
      fillLight
    );

    const rimLight =
      new THREE.DirectionalLight(
        0xffb36f,
        0.26
      );

    rimLight.position.set(
      -25,
      34,
      58
    );

    scene.add(
      rimLight
    );

    // ==========================================================
    // Текстура пола
    // ==========================================================

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      CANVAS_PX;

    canvas.height =
      CANVAS_PX;

    const ctx =
      canvas.getContext(
        "2d"
      );

    const texture =
      new THREE.CanvasTexture(
        canvas
      );

    texture.anisotropy = 8;

    applyColorSpace(
      texture,
      false
    );

    // ==========================================================
    // Пол
    // ==========================================================

    const floorMaterial =
      new THREE.MeshStandardMaterial(
        {
          map: texture,

          flatShading: true,

          roughness: 0.68,
          metalness: 0.04,
        }
      );

    const floorTop =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          FLOOR,
          2,
          FLOOR
        ),
        floorMaterial
      );

    floorTop.position.y =
      -1;

    floorTop.receiveShadow =
      true;

    scene.add(
      floorTop
    );

    const floorBaseMaterial =
      new THREE.MeshStandardMaterial(
        {
          color: 0x27293b,

          flatShading: true,

          roughness: 0.92,
          metalness: 0.0,
        }
      );

    const floorBase =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          FLOOR + 6,
          6,
          FLOOR + 6
        ),
        floorBaseMaterial
      );

    floorBase.position.y =
      -5.35;

    floorBase.receiveShadow =
      true;

    scene.add(
      floorBase
    );

    // ==========================================================
    // Боковые складские блоки
    // ==========================================================

    const crateColors = [
      PALETTE.crateA,
      PALETTE.crateB,
      PALETTE.crateC,
    ];

    [-1, 1].forEach(
      (side) => {
        for (
          let i = 0;
          i < 5;
          i++
        ) {
          const h =
            3 +
            ((i * 7) % 5);

          const material =
            new THREE.MeshStandardMaterial(
              {
                color:
                  crateColors[
                    i %
                      crateColors.length
                  ],

                flatShading:
                  true,

                roughness: 0.60,
                metalness: 0.0,
              }
            );

          const crate =
            new THREE.Mesh(
              new THREE.BoxGeometry(
                MARGIN - 3,
                h,
                6
              ),
              material
            );

          crate.position.set(
            side *
              (FLOOR / 2 -
                MARGIN / 2),

            h / 2,

            -40 +
              i * 18
          );

          crate.castShadow =
            true;

          crate.receiveShadow =
            true;

          scene.add(
            crate
          );

          const edge =
            new THREE.Mesh(
              new THREE.BoxGeometry(
                MARGIN -
                  3.05,
                0.08,
                6.05
              ),
              new THREE.MeshStandardMaterial(
                {
                  color: 0xffffff,

                  transparent:
                    true,

                  opacity: 0.13,

                  roughness: 0.58,

                  metalness: 0,
                }
              )
            );

          edge.position.y =
            h / 2 +
            0.05;

          crate.add(
            edge
          );
        }
      }
    );

    // ==========================================================
    // Текстура конвейеров
    // ==========================================================

    const beltCanvas =
      document.createElement(
        "canvas"
      );

    beltCanvas.width = 128;
    beltCanvas.height = 32;

    const bctx =
      beltCanvas.getContext(
        "2d"
      );

    bctx.fillStyle =
      PALETTE.belt;

    bctx.fillRect(
      0,
      0,
      128,
      32
    );

    bctx.fillStyle =
      PALETTE.beltStripe;

    for (
      let i = -32;
      i < 128;
      i += 24
    ) {
      bctx.beginPath();

      bctx.moveTo(
        i,
        32
      );

      bctx.lineTo(
        i + 12,
        0
      );

      bctx.lineTo(
        i + 17,
        0
      );

      bctx.lineTo(
        i + 5,
        32
      );

      bctx.fill();
    }

    const beltTexture =
      new THREE.CanvasTexture(
        beltCanvas
      );

    beltTexture.wrapS =
      THREE.RepeatWrapping;

    beltTexture.wrapT =
      THREE.RepeatWrapping;

    beltTexture.repeat.set(
      3,
      1
    );

    beltTexture.anisotropy = 8;

    applyColorSpace(
      beltTexture,
      false
    );

    // ==========================================================
    // Camera
    // ==========================================================

    const camDist = 108;

    const camera =
      new THREE.OrthographicCamera(
        -1,
        1,
        1,
        -1,
        0.1,
        500
      );

    // ==========================================================
    // Renderer
    // ==========================================================

    const renderer =
      new THREE.WebGLRenderer(
        {
          antialias: true,

          alpha: true,

          powerPreference:
            "high-performance",
        }
      );

    renderer.setClearColor(
      0x000000,
      0
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2
      )
    );

    renderer.setSize(
      width,
      height
    );

    applyColorSpace(
      renderer,
      true
    );

    renderer.toneMapping =
      THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure =
      0.92;

    renderer.shadowMap.enabled =
      true;

    renderer.shadowMap.type =
      THREE.PCFSoftShadowMap;

    mount.appendChild(
      renderer.domElement
    );

    // ==========================================================
    // Groups
    // ==========================================================

    const vacuumGroup =
      new THREE.Group();

    const armGroup =
      new THREE.Group();

    scene.add(
      vacuumGroup,
      armGroup
    );

    // ==========================================================
    // State
    // ==========================================================

    Object.assign(st, {
      scene,
      renderer,
      camera,

      ctx,
      texture,
      canvas,

      camDist,
      beltTexture,

      vacuumGroup,
      armGroup,

      vacuums: [],
      arms: [],

      clock:
        new THREE.Timer(),

      grid:
        new Uint8Array(
          GRID * GRID
        ),

      raf: null,

      theta:
        Math.PI / 4,

      thetaTarget:
        Math.PI / 4,

      opsAcc: 0,
      simAcc: 0,
      lastDone: 0,

      camZoom: 40,

      keyLight,
    });

    // ==========================================================
    // Camera
    // ==========================================================

    const updateCamera =
      () => {
        const t =
          st.theta;

        const d =
          st.camDist;

        camera.position.set(
          d *
            Math.cos(
              ISO_ELEV
            ) *
            Math.sin(t),

          d *
            Math.sin(
              ISO_ELEV
            ),

          d *
            Math.cos(
              ISO_ELEV
            ) *
            Math.cos(t)
        );

        camera.lookAt(
          0,
          0,
          0
        );
      };

    const applyFrustum =
      () => {
        const w =
          mount.clientWidth;

        const h = 460;

        const a =
          w / h;

        const hh =
          st.camZoom;

        camera.left =
          -hh * a;

        camera.right =
          hh * a;

        camera.top =
          hh;

        camera.bottom =
          -hh;

        camera.updateProjectionMatrix();
      };

    st.updateCamera =
      updateCamera;

    st.applyFrustum =
      applyFrustum;

    updateCamera();
    applyFrustum();

    // ==========================================================
    // Resize
    // ==========================================================

    const onResize =
      () => {
        renderer.setSize(
          mount.clientWidth,
          460
        );

        applyFrustum();
      };

    window.addEventListener(
      "resize",
      onResize
    );

    // ==========================================================
    // Cleanup
    // ==========================================================

    return () => {
      window.removeEventListener(
        "resize",
        onResize
      );

      cancelAnimationFrame(
        st.raf
      );

      renderer.dispose();

      if (
        renderer.domElement
          .parentNode ===
        mount
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Zoom
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    st.camZoom =
      camZoom;

    st.applyFrustum();
  }, [camZoom]);

  // ============================================================
  // Пересборка роботов
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    st.vacuumGroup.clear();
    st.armGroup.clear();

    st.vacuums = [];
    st.arms = [];

    let vacuumChunks = [];

    // ----------------------------------------------------------
    // Пылесосы
    // ----------------------------------------------------------

    if (useVacuum) {
      vacuumChunks =
        computeChunks(
          vacuumCount,
          vacuumZoneWidth,
          LANE_MIN_X
        );

      vacuumChunks.forEach(
        (chunk, i) => {
          const rowCenters =
            buildRowCenters(
              chunk
            );

          const g =
            makeVacuumRobot(
              PALETTE
                .vacuumCaps[
                i %
                  PALETTE
                    .vacuumCaps
                    .length
              ]
            );

          g.scale.setScalar(
            MODEL_SCALE
          );

          g.position.set(
            rowCenters[0],
            0.5,
            chunk.zMin
          );

          st.vacuumGroup.add(
            g
          );

          st.vacuums.push({
            group: g,

            chunk,

            rowCenters,

            rowIdx: 0,

            x: rowCenters[0],

            z: chunk.zMin,

            // Последняя позиция нужна только
            // для построения цельного визуального следа
            lastX: rowCenters[0],
            lastZ: chunk.zMin,

            dirZ: 1,

            bob:
              Math.random() *
              10,

            done: false,
          });
        }
      );
    }

    // ----------------------------------------------------------
    // Роборуки
    // ----------------------------------------------------------

    if (useArm) {
      const armX =
        zoneSplitX +
        armZoneWidth / 2;

      const spacing =
        (Z_MAX - Z_MIN) /
        armCount;

      for (
        let i = 0;
        i < armCount;
        i++
      ) {
        const z =
          Z_MIN +
          spacing *
            (i + 0.5);

        const built =
          makeArmRobot(
            PALETTE
              .armAccents[
              i %
                PALETTE
                  .armAccents
                  .length
            ],
            st.beltTexture
          );

        built.group.position.set(
          armX,
          0,
          z
        );

        built.group.scale.setScalar(
          MODEL_SCALE
        );

        st.armGroup.add(
          built.group
        );

        st.arms.push({
          ...built,

          phase:
            Math.random(),

          transferBox:
            null,

          lastGoingRight:
            undefined,
        });
      }
    }

    // ----------------------------------------------------------
    // Пол
    // ----------------------------------------------------------

    st.grid.fill(0);

    drawBaseFloor(
      st.ctx,
      {
        vacuumZoneWidth,
        armZoneWidth,
        zoneSplitX,
        armCount,
        vacuumChunks,
      }
    );

    st.texture.needsUpdate =
      true;

    st.opsAcc = 0;
    st.simAcc = 0;
    st.lastDone = 0;

    setCoverage(0);
    setOpsDone(0);
    setSimSeconds(0);
    setDoneCount(0);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    vacuumCount,
    armCount,
    resetKey,
  ]);

  // ============================================================
  // Анимация
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    const EPS =
      1e-6;

    const MARK_RADIUS =
      (VACUUM_SWATH / 2) *
      1.2;

    // ----------------------------------------------------------
    // Пылесос
    // ----------------------------------------------------------

    const advanceVacuum =
      (dt) => {
        let newly = 0;

        for (
          const r of st.vacuums
        ) {
          if (!r.done) {
            r.z +=
              r.dirZ *
              vacuumSpeed *
              dt;

            const atMax =
              r.dirZ > 0 &&
              r.z >=
                r.chunk.zMax;

            const atMin =
              r.dirZ < 0 &&
              r.z <=
                r.chunk.zMin;

            if (
              atMax ||
              atMin
            ) {
              r.z =
                atMax
                  ? r.chunk.zMax
                  : r.chunk.zMin;

              r.rowIdx++;

              if (
                r.rowIdx >=
                r.rowCenters
                  .length
              ) {
                r.done =
                  true;
              } else {
                r.dirZ *= -1;

                r.x =
                  r.rowCenters[
                    r.rowIdx
                  ];
              }
            }

            r.bob +=
              dt * 4;

            r.group.position.set(
              r.x,

              0.5 +
                Math.sin(
                  r.bob
                ) *
                  0.05,

              r.z
            );

            r.group.rotation.y =
              r.dirZ > 0
                ? 0
                : Math.PI;
          }

          // ----------------------------------------------------
          // ЕДИНЫЙ СЛЕД ПЫЛЕСОСА
          // ----------------------------------------------------
          //
          // Важно:
          // здесь больше НЕТ рисования следа по клеткам.
          // Клетки ниже используются только для расчёта
          // процента покрытия.
          //
          // Визуально след строится как непрерывная
          // закруглённая полоса между предыдущей и текущей
          // координатой робота.
          // ----------------------------------------------------

          if (
            Math.abs(
              r.x -
                r.lastX
            ) > 0.0001 ||
            Math.abs(
              r.z -
                r.lastZ
            ) > 0.0001
          ) {
            const px =
              (r.lastX +
                FLOOR / 2) *
              PX_PER_M;

            const pz =
              (r.lastZ +
                FLOOR / 2) *
              PX_PER_M;

            const cx =
              (r.x +
                FLOOR / 2) *
              PX_PER_M;

            const cz =
              (r.z +
                FLOOR / 2) *
              PX_PER_M;

            const ctx =
              st.ctx;

            ctx.save();

            ctx.lineCap =
              "round";

            ctx.lineJoin =
              "round";

            // ------------------------------------------------
            // Мягкая внешняя часть.
            // Она немного шире самого робота и делает
            // переходы между сегментами визуально цельными.
            // ------------------------------------------------

            ctx.strokeStyle =
              "rgba(255,248,225,0.22)";

            ctx.lineWidth =
              VACUUM_SWATH *
              PX_PER_M *
              0.95;

            ctx.beginPath();

            ctx.moveTo(
              px,
              pz
            );

            ctx.lineTo(
              cx,
              cz
            );

            ctx.stroke();

            // ------------------------------------------------
            // Основная часть следа.
            // ------------------------------------------------

            ctx.strokeStyle =
              PALETTE.trail;

            ctx.lineWidth =
              VACUUM_SWATH *
              PX_PER_M *
              0.72;

            ctx.beginPath();

            ctx.moveTo(
              px,
              pz
            );

            ctx.lineTo(
              cx,
              cz
            );

            ctx.stroke();

            // ------------------------------------------------
            // Очень мягкий центральный блик.
            // ------------------------------------------------

            ctx.strokeStyle =
              "rgba(255,252,238,0.10)";

            ctx.lineWidth =
              VACUUM_SWATH *
              PX_PER_M *
              0.28;

            ctx.beginPath();

            ctx.moveTo(
              px,
              pz
            );

            ctx.lineTo(
              cx,
              cz
            );

            ctx.stroke();

            ctx.restore();

            r.lastX =
              r.x;

            r.lastZ =
              r.z;

            st.texture.needsUpdate =
              true;
          }

          // ----------------------------------------------------
          // Расчёт покрытия
          // ----------------------------------------------------

          const c =
            r.chunk;

          const minGX =
            Math.max(
              0,
              Math.floor(
                Math.max(
                  r.x -
                    MARK_RADIUS,
                  c.xMin
                ) +
                  FLOOR / 2
              )
            );

          const maxGX =
            Math.min(
              GRID - 1,
              Math.ceil(
                Math.min(
                  r.x +
                    MARK_RADIUS,
                  c.xMax
                ) +
                  FLOOR / 2
              )
            );

          const minGZ =
            Math.max(
              0,
              Math.floor(
                Math.max(
                  r.z -
                    MARK_RADIUS,
                  c.zMin
                ) +
                  FLOOR / 2
              )
            );

          const maxGZ =
            Math.min(
              GRID - 1,
              Math.ceil(
                Math.min(
                  r.z +
                    MARK_RADIUS,
                  c.zMax
                ) +
                  FLOOR / 2
              )
            );

          for (
            let gx = minGX;
            gx <= maxGX;
            gx++
          ) {
            for (
              let gz = minGZ;
              gz <= maxGZ;
              gz++
            ) {
              const wx =
                gx -
                FLOOR / 2 +
                0.5;

              const wz =
                gz -
                FLOOR / 2 +
                0.5;

              if (
                wx <
                  c.xMin -
                    EPS ||
                wx >
                  c.xMax +
                    EPS ||
                wz <
                  c.zMin -
                    EPS ||
                wz >
                  c.zMax +
                    EPS
              ) {
                continue;
              }

              if (
                (wx - r.x) **
                    2 +
                  (wz - r.z) **
                    2 <=
                MARK_RADIUS **
                  2
              ) {
                const idx =
                  gz * GRID +
                  gx;

                if (
                  !st.grid[idx]
                ) {
                  st.grid[idx] =
                    1;

                  newly++;
                }
              }
            }
          }
        }

        return newly;
      };

    // ----------------------------------------------------------
    // Поиск коробки
    // ----------------------------------------------------------

    const findWaitingBox =
      (a) => {
        let best = null;
        let bestDistance =
          Infinity;

        for (
          const box of a.boxes
        ) {
          if (
            box.userData
              .state !==
            "waiting"
          ) {
            continue;
          }

          const distance =
            Math.abs(
              box.userData.z -
                ARM_PICKUP_Z
            );

          if (
            distance <
            bestDistance
          ) {
            bestDistance =
              distance;

            best = box;
          }
        }

        return best;
      };

    // ----------------------------------------------------------
    // Входная лента
    // ----------------------------------------------------------

    const advanceInputQueue =
      (
        boxesSide,
        dt,
        rate
      ) => {
        const queue =
          boxesSide.filter(
            (b) =>
              b.userData
                .state ===
                "input" ||
              b.userData
                .state ===
                "waiting"
          );

        queue.sort(
          (a, b) =>
            b.userData.z -
            a.userData.z
        );

        let limit =
          ARM_PICKUP_Z;

        queue.forEach(
          (box) => {
            let z =
              box.userData.z +
              rate * dt;

            if (
              z > limit
            ) {
              z = limit;
            }

            box.userData.z =
              z;

            box.position.set(
              -ARM_BELT_X,
              0.82,
              z
            );

            box.userData.state =
              z >=
              ARM_PICKUP_Z -
                1e-3
                ? "waiting"
                : "input";

            limit =
              z - BOX_GAP;
          }
        );
      };

    // ----------------------------------------------------------
    // Выходная лента
    // ----------------------------------------------------------

    const advanceOutputQueue =
      (
        boxesSide,
        dt,
        rate
      ) => {
        const queue =
          boxesSide.filter(
            (b) =>
              b.userData
                .state ===
              "output"
          );

        queue.sort(
          (a, b) =>
            a.userData.z -
            b.userData.z
        );

        let limit =
          -Infinity;

        queue.forEach(
          (box) => {
            let z =
              box.userData.z +
              rate * dt;

            if (
              z < limit
            ) {
              z = limit;
            }

            box.userData.z =
              z;

            box.position.set(
              ARM_BELT_X,
              0.82,
              z
            );

            box.rotation.y +=
              dt * 0.8;

            limit =
              z + BOX_GAP;

            if (
              box.userData.z >=
              ARM_BELT_END_Z
            ) {
              box.userData.state =
                "input";

              box.userData.side =
                -1;

              box.userData.z =
                ARM_BELT_START_Z;

              box.position.set(
                -ARM_BELT_X,
                0.82,
                ARM_BELT_START_Z
              );

              box.rotation.set(
                0,
                0,
                0
              );
            }
          }
        );
      };

    // ----------------------------------------------------------
    // Роборука
    // ----------------------------------------------------------

    const advanceArm =
      (dt) => {
        for (
          const a of st.arms
        ) {
          const cycleDuration =
            1 /
            Math.max(
              armCycleHz,
              0.001
            );

          a.phase =
            (a.phase +
              dt /
                cycleDuration) %
            1;

          if (
            a.phase < 0
          ) {
            a.phase += 1;
          }

          const phase =
            a.phase;

          const goingRight =
            phase < 0.5;

          const legPhase =
            goingRight
              ? phase * 2
              : (phase - 0.5) *
                2;

          const eased =
            easeInOut(
              legPhase
            );

          const ARM_RIGHT_FAR =
            ARM_RIGHT_ANGLE +
            Math.PI * 2;

          const angle =
            goingRight
              ? ARM_LEFT_ANGLE +
                (ARM_RIGHT_FAR -
                  ARM_LEFT_ANGLE) *
                  eased
              : ARM_RIGHT_FAR -
                (ARM_RIGHT_FAR -
                  ARM_LEFT_ANGLE) *
                  eased;

          const dip =
            Math.cos(
              Math.PI *
                legPhase
            ) ** 2;

          const clawY =
            ARM_CARRY_Y +
            (ARM_PICKUP_Y -
              ARM_CARRY_Y) *
              dip;

          a.pivot.rotation.y =
            angle;

          a.claw.position.y =
            clawY;

          const boxes =
            a.boxes;

          if (
            !boxes?.length
          ) {
            continue;
          }

          const rate =
            1.45 *
            Math.max(
              1,
              armProd / 15
            );

          const inputSide =
            boxes.filter(
              (b) =>
                b.userData
                  .side ===
                  -1 &&
                b.userData
                  .state !==
                  "carried"
            );

          const outputSide =
            boxes.filter(
              (b) =>
                b.userData
                  .side ===
                  1 &&
                b.userData
                  .state !==
                  "carried"
            );

          advanceInputQueue(
            inputSide,
            dt,
            rate
          );

          advanceOutputQueue(
            outputSide,
            dt,
            rate
          );

          if (
            a.lastGoingRight ===
            undefined
          ) {
            a.lastGoingRight =
              goingRight;
          }

          // ----------------------------------------------------
          // Передача
          // ----------------------------------------------------

          if (
            a.lastGoingRight &&
            !goingRight
          ) {
            if (
              a.transferBox
            ) {
              const box =
                a.transferBox;

              a.claw.remove(
                box
              );

              box.userData.state =
                "output";

              box.userData.side =
                1;

              box.userData.z =
                ARM_PICKUP_Z;

              box.rotation.set(
                0,
                0,
                0
              );

              box.position.set(
                ARM_BELT_X,
                0.82,
                ARM_PICKUP_Z
              );

              a.group.add(
                box
              );

              a.transferBox =
                null;

              st.opsAcc += 1;
            }
          }

          // ----------------------------------------------------
          // Захват
          // ----------------------------------------------------

          if (
            !a.lastGoingRight &&
            goingRight
          ) {
            if (
              !a.transferBox
            ) {
              const pickupBox =
                findWaitingBox(
                  a
                );

              if (
                pickupBox
              ) {
                a.transferBox =
                  pickupBox;

                pickupBox.userData.state =
                  "carried";

                a.claw.add(
                  pickupBox
                );

                pickupBox.position.set(
                  0,
                  -0.34,
                  0
                );

                pickupBox.rotation.set(
                  0,
                  0,
                  0
                );
              }
            }
          }

          a.lastGoingRight =
            goingRight;
        }
      };

    // ==========================================================
    // Render loop
    // ==========================================================

    const tick =
      (timestamp) => {
        st.raf =
          requestAnimationFrame(
            tick
          );

        st.clock.update(
          timestamp
        );

        const realDt =
          Math.min(
            st.clock.getDelta(),
            0.1
          );

        st.theta +=
          (st.thetaTarget -
            st.theta) *
          0.12;

        st.updateCamera();

        if (running) {
          const mult =
            speedMult;

          if (
            st.beltTexture
          ) {
            st.beltTexture.offset.y -=
              0.45 *
              realDt *
              mult;
          }

          let newlyTotal = 0;

          st.simAcc +=
            realDt * mult;

          for (
            let step = 0;
            step < mult;
            step++
          ) {
            if (
              useVacuum
            ) {
              newlyTotal +=
                advanceVacuum(
                  realDt
                );
            }

            if (useArm) {
              advanceArm(
                realDt
              );
            }
          }

          setSimSeconds(
            st.simAcc
          );

          if (useVacuum) {
            if (
              newlyTotal > 0
            ) {
              st.texture.needsUpdate =
                true;

              let total = 0;

              for (
                let i = 0;
                i <
                st.grid.length;
                i++
              ) {
                total +=
                  st.grid[i];
              }

              setCoverage(
                vacuumZoneAreaM2 >
                  0
                  ? Math.min(
                      100,
                      (total /
                        vacuumZoneAreaM2) *
                        100
                    )
                  : 0
              );
            }

            const nowDone =
              st.vacuums.filter(
                (r) =>
                  r.done
              ).length;

            if (
              nowDone !==
              st.lastDone
            ) {
              st.lastDone =
                nowDone;

              setDoneCount(
                nowDone
              );
            }
          }

          if (useArm) {
            setOpsDone(
              Math.floor(
                st.opsAcc
              )
            );
          }
        }

        st.renderer.render(
          st.scene,
          st.camera
        );
      };

    tick();

    return () =>
      cancelAnimationFrame(
        st.raf
      );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    running,
    vacuumSpeed,
    armCycleHz,
    useVacuum,
    useArm,
    armCount,
    armProd,
    vacuumZoneAreaM2,
    speedMult,
  ]);

  // ============================================================
  // Controls
  // ============================================================

  const rotate =
    (dir) => {
      st.thetaTarget +=
        dir *
        (Math.PI / 2);
    };

  const zoomBy =
    (delta) =>
      setCamZoom(
        (z) =>
          Math.max(
            22,
            Math.min(
              55,
              z + delta
            )
          )
      );

  const fmtTime =
    (s) =>
      `${Math.floor(
        s / 60
      )}:${Math.floor(
        s % 60
      )
        .toString()
        .padStart(2, "0")}`;

  const allVacuumsDone =
    useVacuum &&
    doneCount ===
      vacuumCount;

  // ============================================================
  // UI
  // ============================================================

  return (
    <div
      className="w-full rounded-2xl p-4"
      style={{
        background:
          "linear-gradient(160deg, #CBB8E8 0%, #E3B7C9 35%, #F3CDAE 65%, #FBE6C9 100%)",

        fontFamily:
          "'Baloo 2', ui-rounded, 'Segoe UI Rounded', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700&display=swap');

        input[type="range"].pretty-range {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: rgba(63, 65, 89, 0.18);
        }

        input[type="range"].pretty-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #E8B15A;
          border: 2px solid #FBF3E7;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
          cursor: pointer;
        }

        input[type="range"].pretty-range::-moz-range-track {
          height: 6px;
          border-radius: 999px;
          background: rgba(63, 65, 89, 0.18);
        }

        input[type="range"].pretty-range::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #E8B15A;
          border: 2px solid #FBF3E7;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
          cursor: pointer;
        }
      `}</style>

      <div className="flex items-baseline justify-between mb-3 px-1">
        <div>
          <h2 className="text-xl font-bold text-[#3F4159]">
            Склад мечты · пылесосы и роборуки
          </h2>

          <p className="text-xs text-[#6b5f7a]">
            100 × 100 м · 10 000 м²
          </p>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() =>
              zoomBy(6)
            }
            className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
          >
            −
          </button>

          <button
            onClick={() =>
              zoomBy(-6)
            }
            className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
          >
            +
          </button>

          <button
            onClick={() =>
              rotate(-1)
            }
            className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
          >
            ↺
          </button>

          <button
            onClick={() =>
              rotate(1)
            }
            className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-3 px-1">
        {[
          {
            id: "vacuum",
            label: "🧹 Пылесосы",
          },
          {
            id: "arm",
            label: "🦾 Роборуки",
          },
          {
            id: "both",
            label: "Оба типа",
          },
        ].map(
          (opt) => (
            <button
              key={opt.id}
              onClick={() =>
                setMode(
                  opt.id
                )
              }
              className={`text-xs px-3 py-1.5 rounded-full font-semibold transition ${
                mode === opt.id
                  ? "bg-[#3F4159] text-white"
                  : "bg-white/60 text-[#3F4159] hover:bg-white"
              }`}
            >
              {opt.label}
            </button>
          )
        )}
      </div>

      <div
        ref={mountRef}
        className="w-full rounded-xl overflow-hidden"
        style={{
          height: 460,
        }}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        {useVacuum && (
          <Stat
            label="Отполировано"
            value={`${coverage.toFixed(
              1
            )}%`}
          />
        )}

        {useVacuum && (
          <Stat
            label="Роботов закончило"
            value={`${doneCount}/${vacuumCount}`}
          />
        )}

        {useArm && (
          <Stat
            label="Обработано, шт"
            value={opsDone}
          />
        )}

        {useArm && (
          <Stat
            label="Темп рук"
            value={`${totalOpsCapacity.toFixed(
              0
            )} оп/мин`}
          />
        )}

        <Stat
          label="Время"
          value={fmtTime(
            simSeconds
          )}
        />
      </div>

      {allVacuumsDone && (
        <p className="text-xs text-[#2C6E49] font-semibold mt-2 px-1">
          🎉 Все пылесосы закончили свои участки — зона убрана на{" "}
          {coverage.toFixed(0)}%.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 px-1">
        {useVacuum && (
          <div className="bg-white/40 rounded-xl p-3 space-y-3">
            <div className="text-xs font-bold text-[#3F4159]">
              🧹 Пылесосы — свой чанк на каждого
            </div>

            <Stepper
              label="Количество"
              value={vacuumCount}
              min={1}
              max={8}
              onChange={
                setVacuumCount
              }
            />

            <Slider
              label="Производительность, м²/ч"
              value={vacuumProd}
              min={500}
              max={6000}
              step={100}
              onChange={
                setVacuumProd
              }
              fmt={(v) => v}
            />
          </div>
        )}

        {useArm && (
          <div className="bg-white/40 rounded-xl p-3 space-y-3">
            <div className="text-xs font-bold text-[#3F4159]">
              🦾 Роборуки · две параллельные ленты
            </div>

            <Stepper
              label="Количество"
              value={armCount}
              min={1}
              max={6}
              onChange={
                setArmCount
              }
            />

            <Slider
              label="Производительность, оп/мин"
              value={armProd}
              min={5}
              max={40}
              step={1}
              onChange={
                setArmProd
              }
              fmt={(v) => v}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4 px-1 items-center">
        <button
          onClick={() =>
            setRunning(
              !running
            )
          }
          className="text-sm px-4 py-2 rounded-full bg-[#E8B15A] hover:brightness-105 text-[#3F4159] font-bold shadow-sm transition"
        >
          {running
            ? "⏸ Пауза"
            : "▶ Дальше"}
        </button>

        <button
          onClick={() =>
            setResetKey(
              (k) => k + 1
            )
          }
          className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
        >
          ↺ Сброс
        </button>

        <div className="flex gap-1 ml-1 flex-wrap">
          {[1, 2, 4, 8, 18, 32].map(
            (m) => (
              <button
                key={m}
                onClick={() =>
                  setSpeedMult(m)
                }
                className={`text-xs px-3 py-2 rounded-full font-bold transition ${
                  speedMult === m
                    ? "bg-[#3F4159] text-white"
                    : "bg-white/70 hover:bg-white text-[#3F4159]"
                }`}
              >
                {m}×
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// UI components
// ============================================================

function Stat({
  label,
  value,
}) {
  return (
    <div className="bg-white/60 rounded-xl p-2.5">
      <div className="text-[10px] text-[#6b5f7a] font-semibold">
        {label}
      </div>

      <div className="text-base text-[#3F4159] font-bold">
        {value}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}) {
  return (
    <label className="text-xs block">
      <div className="flex justify-between mb-1 text-[#3F4159] font-semibold">
        <span>{label}</span>

        <span>
          {fmt(value)}
        </span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(
            Number(
              e.target.value
            )
          )
        }
        className="w-full pretty-range"
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}) {
  return (
    <div className="text-xs">
      <div className="flex justify-between mb-1.5 text-[#3F4159] font-semibold">
        <span>{label}</span>

        <span className="font-mono">
          {value}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            onChange(
              Math.max(
                min,
                value - 1
              )
            )
          }
          disabled={
            value <= min
          }
          className="w-8 h-8 flex-none rounded-full bg-white/80 hover:bg-white disabled:opacity-30 text-[#3F4159] font-bold shadow-sm transition flex items-center justify-center text-base"
        >
          −
        </button>

        <div className="flex-1 flex items-center justify-center gap-1.5">
          {Array.from(
            {
              length: max,
            },
            (_, i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full transition"
                style={{
                  background:
                    i < value
                      ? "#E8B15A"
                      : "rgba(63, 65, 89, 0.35)",
                }}
              />
            )
          )}
        </div>

        <button
          onClick={() =>
            onChange(
              Math.min(
                max,
                value + 1
              )
            )
          }
          disabled={
            value >= max
          }
          className="w-8 h-8 flex-none rounded-full bg-white/80 hover:bg-white text-[#3F4159] font-bold shadow-sm transition flex items-center justify-center text-base"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Пол
// ============================================================

function drawBaseFloor(
  ctx,
  {
    vacuumZoneWidth,
    armZoneWidth,
    zoneSplitX,
    armCount,
    vacuumChunks,
  }
) {
  ctx.clearRect(
    0,
    0,
    CANVAS_PX,
    CANVAS_PX
  );

  ctx.fillStyle =
    PALETTE.storage;

  ctx.fillRect(
    0,
    0,
    CANVAS_PX,
    CANVAS_PX
  );

  // ----------------------------------------------------------
  // Зона пылесосов
  // ----------------------------------------------------------

  if (
    vacuumZoneWidth > 0
  ) {
    vacuumChunks.forEach(
      (chunk) => {
        ctx.fillStyle =
          (chunk.row +
            chunk.col) %
            2 ===
          0
            ? PALETTE.chunkA
            : PALETTE.chunkB;

        const x0 =
          ((chunk.xMin +
            FLOOR / 2) /
            FLOOR) *
          CANVAS_PX;

        const x1 =
          ((chunk.xMax +
            FLOOR / 2) /
            FLOOR) *
          CANVAS_PX;

        const z0 =
          ((chunk.zMin +
            FLOOR / 2) /
            FLOOR) *
          CANVAS_PX;

        const z1 =
          ((chunk.zMax +
            FLOOR / 2) /
            FLOOR) *
          CANVAS_PX;

        ctx.fillRect(
          x0,
          z0,
          x1 - x0,
          z1 - z0
        );

        ctx.strokeStyle =
          "rgba(255,255,255,0.23)";

        ctx.lineWidth = 2.5;

        ctx.strokeRect(
          x0,
          z0,
          x1 - x0,
          z1 - z0
        );
      }
    );
  }

  // ----------------------------------------------------------
  // Зона роборуки
  // ----------------------------------------------------------

  if (
    armZoneWidth > 0
  ) {
    const startPx =
      ((zoneSplitX +
        FLOOR / 2) /
        FLOOR) *
      CANVAS_PX;

    const widthPx =
      (armZoneWidth /
        FLOOR) *
      CANVAS_PX;

    ctx.fillStyle =
      PALETTE.armZone;

    ctx.fillRect(
      startPx,
      0,
      widthPx,
      CANVAS_PX
    );

    const centerXpx =
      startPx +
      widthPx / 2;

    const spacing =
      CANVAS_PX /
      armCount;

    ctx.fillStyle =
      PALETTE.pad;

    for (
      let i = 0;
      i < armCount;
      i++
    ) {
      ctx.beginPath();

      ctx.arc(
        centerXpx,
        spacing *
          (i + 0.5),
        widthPx * 0.32,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }
  }

  // ----------------------------------------------------------
  // Сетка
  // ----------------------------------------------------------

  ctx.strokeStyle =
    "rgba(255,255,255,0.04)";

  ctx.lineWidth = 1;

  const gridStep =
    CANVAS_PX / 10;

  for (
    let i = 0;
    i <= 10;
    i++
  ) {
    const p =
      i * gridStep;

    ctx.beginPath();

    ctx.moveTo(
      p,
      0
    );

    ctx.lineTo(
      p,
      CANVAS_PX
    );

    ctx.stroke();

    ctx.beginPath();

    ctx.moveTo(
      0,
      p
    );

    ctx.lineTo(
      CANVAS_PX,
      p
    );

    ctx.stroke();
  }

  // ----------------------------------------------------------
  // Внешняя граница
  // ----------------------------------------------------------

  ctx.strokeStyle =
    "rgba(255,255,255,0.13)";

  ctx.lineWidth = 3;

  ctx.strokeRect(
    1.5,
    1.5,
    CANVAS_PX - 3,
    CANVAS_PX - 3
  );
}

// ============================================================
// Vacuum Robot
// ============================================================

function makeVacuumRobot(
  capColor
) {
  const group =
    new THREE.Group();

  const bodyMat =
    new THREE.MeshStandardMaterial(
      {
        color:
          PALETTE.robotBody,

        flatShading: true,

        roughness: 0.58,
        metalness: 0.0,
      }
    );

  const capMat =
    new THREE.MeshStandardMaterial(
      {
        color: capColor,

        flatShading: true,

        roughness: 0.48,
        metalness: 0.0,
      }
    );

  const darkMat =
    new THREE.MeshStandardMaterial(
      {
        color:
          PALETTE.storage,

        flatShading: true,

        roughness: 0.60,
        metalness: 0.0,
      }
    );

  // Нижняя юбка
  const skirt =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.75,
        0.85,
        0.35,
        16
      ),
      capMat
    );

  skirt.position.y =
    0.05;

  skirt.castShadow =
    true;

  skirt.receiveShadow =
    true;

  group.add(
    skirt
  );

  // Корпус
  const body =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.55,
        0.6,
        0.6,
        16
      ),
      bodyMat
    );

  body.position.y =
    0.5;

  body.castShadow =
    true;

  body.receiveShadow =
    true;

  group.add(
    body
  );

  // Купол
  const dome =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.5,
        20,
        12,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2
      ),
      capMat
    );

  dome.position.y =
    0.8;

  dome.castShadow =
    true;

  dome.receiveShadow =
    true;

  group.add(
    dome
  );

  // Глаз
  const eye =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.08,
        12,
        12
      ),
      darkMat
    );

  eye.position.set(
    0,
    0.85,
    0.45
  );

  eye.castShadow =
    true;

  group.add(
    eye
  );

  // Декоративный обод
  const ringMat =
    new THREE.MeshStandardMaterial(
      {
        color: 0xffffff,

        emissive:
          new THREE.Color(
            capColor
          ),

        emissiveIntensity:
          0.28,

        roughness: 0.48,
        metalness: 0.0,

        flatShading: true,
      }
    );

  const ring =
    new THREE.Mesh(
      new THREE.TorusGeometry(
        0.61,
        0.035,
        8,
        32
      ),
      ringMat
    );

  ring.rotation.x =
    Math.PI / 2;

  ring.position.y =
    0.72;

  group.add(
    ring
  );

  return group;
}

// ============================================================
// Robotic Arm
// ============================================================

function makeArmRobot(
  accentColor,
  beltTexture
) {
  const group =
    new THREE.Group();

  const baseMat =
    new THREE.MeshStandardMaterial(
      {
        color:
          PALETTE.robotBody,

        flatShading: true,

        roughness: 0.56,
        metalness: 0.0,
      }
    );

  const accentMat =
    new THREE.MeshStandardMaterial(
      {
        color: accentColor,

        flatShading: true,

        roughness: 0.48,
        metalness: 0.0,
      }
    );

  const darkMat =
    new THREE.MeshStandardMaterial(
      {
        color:
          PALETTE.storage,

        flatShading: true,

        roughness: 0.60,
        metalness: 0.0,
      }
    );

  const beltMat =
    new THREE.MeshStandardMaterial(
      {
        map: beltTexture,

        flatShading: true,

        roughness: 0.70,
        metalness: 0.0,
      }
    );

  // Основание
  const base =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.9,
        1,
        1.1,
        16
      ),
      baseMat
    );

  base.position.y =
    0.55;

  base.castShadow =
    true;

  base.receiveShadow =
    true;

  group.add(
    base
  );

  // Кольцо
  const collar =
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.55,
        0.55,
        0.3,
        16
      ),
      accentMat
    );

  collar.position.y =
    1.25;

  collar.castShadow =
    true;

  collar.receiveShadow =
    true;

  group.add(
    collar
  );

  // Pivot
  const pivot =
    new THREE.Group();

  pivot.position.y =
    1.4;

  group.add(
    pivot
  );

  // Рука
  const arm =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        ARM_LENGTH,
        0.35,
        0.35
      ),
      accentMat
    );

  arm.position.x =
    ARM_LENGTH / 2;

  arm.castShadow =
    true;

  arm.receiveShadow =
    true;

  pivot.add(
    arm
  );

  // Захват
  const claw =
    new THREE.Mesh(
      new THREE.BoxGeometry(
        0.5,
        0.5,
        0.5
      ),
      darkMat
    );

  claw.position.set(
    ARM_LENGTH,
    ARM_CARRY_Y,
    0
  );

  claw.castShadow =
    true;

  claw.receiveShadow =
    true;

  pivot.add(
    claw
  );

  // Кончик
  const tipMat =
    new THREE.MeshStandardMaterial(
      {
        color: 0xffffff,

        emissive:
          new THREE.Color(
            accentColor
          ),

        emissiveIntensity:
          0.52,

        roughness: 0.45,
        metalness: 0.0,

        flatShading: true,
      }
    );

  const tip =
    new THREE.Mesh(
      new THREE.SphereGeometry(
        0.11,
        12,
        12
      ),
      tipMat
    );

  tip.position.set(
    ARM_LENGTH,
    ARM_CARRY_Y,
    0.27
  );

  pivot.add(
    tip
  );

  // Конвейеры
  const boxes = [];

  [-1, 1].forEach(
    (side) => {
      const x =
        side *
        ARM_BELT_X;

      // Каркас
      const frame =
        new THREE.Mesh(
          new THREE.BoxGeometry(
            1.45,
            0.45,
            12
          ),
          new THREE.MeshStandardMaterial(
            {
              color: 0x202236,

              flatShading:
                true,

              roughness: 0.68,
              metalness: 0.0,
            }
          )
        );

      frame.position.set(
        x,
        0.0,
        0
      );

      frame.castShadow =
        true;

      frame.receiveShadow =
        true;

      group.add(
        frame
      );

      // Лента
      const belt =
        new THREE.Mesh(
          new THREE.BoxGeometry(
            1.1,
            0.22,
            11.7
          ),
          beltMat
        );

      belt.position.set(
        x,
        0.32,
        0
      );

      belt.castShadow =
        true;

      belt.receiveShadow =
        true;

      group.add(
        belt
      );

      // Направляющие
      [-0.58, 0.58].forEach(
        (offset) => {
          const rail =
            new THREE.Mesh(
              new THREE.BoxGeometry(
                0.08,
                0.35,
                11.8
              ),
              new THREE.MeshStandardMaterial(
                {
                  color:
                    0x85899f,

                  flatShading:
                    true,

                  roughness:
                    0.58,

                  metalness: 0.05,
                }
              )
            );

          rail.position.set(
            x + offset,
            0.48,
            0
          );

          rail.castShadow =
            true;

          rail.receiveShadow =
            true;

          group.add(
            rail
          );
        }
      );
    }
  );

  // Коробки
  const colors = [
    PALETTE.crateA,
    PALETTE.crateB,
    PALETTE.crateC,
  ];

  for (
    let i = 0;
    i < 5;
    i++
  ) {
    const material =
      new THREE.MeshStandardMaterial(
        {
          color:
            colors[
              i %
                colors.length
            ],

          flatShading:
            true,

          roughness: 0.60,
          metalness: 0.0,
        }
      );

    const box =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.68,
          0.68,
          0.68
        ),
        material
      );

    const startZ =
      ARM_BELT_START_Z +
      0.5 +
      i * BOX_GAP;

    box.position.set(
      -ARM_BELT_X,
      0.82,
      startZ
    );

    box.castShadow =
      true;

    box.receiveShadow =
      true;

    box.userData = {
      state: "input",

      z: startZ,

      side: -1,

      transferT: 0,
    };

    group.add(
      box
    );

    boxes.push(
      box
    );
  }

  return {
    group,
    pivot,
    claw,
    boxes,
  };
}