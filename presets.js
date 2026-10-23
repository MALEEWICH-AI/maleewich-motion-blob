// Presets & Procedural Composition Generator for Motion Blob Studio
window.BlobStudio = window.BlobStudio || {};

window.BlobStudio.BLOB_TYPES = [
    { id: 0, name: 'Двухслойный блоб (Стекло + Зеленый)', short: 'Стекло+Ядро', color: '#a8ff00' },
    { id: 1, name: 'Прозрачная капля / Купол стекла', short: 'Капля/Купол', color: '#7dd3fc' },
    { id: 2, name: 'Внутреннее зеленое ядро', short: 'Зеленое ядро', color: '#4ade80' },
    { id: 3, name: 'Черная глянцевая сфера внутри (Вакуоль)', short: 'Черная сфера', color: '#f43f5e' }
];

window.BlobStudio.PRESETS = {
    reference: {
        id: 'reference',
        name: 'Референс (motionRef.mp4)',
        description: 'Octane-реконструкция: левая сфера с упругой перетяжкой к правому кластеру, глянцевые черные сферы-вакуоли внутри, капли и колотый базальт.',
        aspect: '9:16',
        params: {
            smoothGlass: 0.22,
            smoothGreen: 0.20,
            smoothCavity: 0.045,
            glassIOR: 1.50,
            glassDispersion: 0.38,
            fresnelIntensity: 1.35,
            bubbleDensity: 1.15,
            coreDetail: 1.0,
            greenColor: '#9be600',
            greenDeepColor: '#142600',
            bgTopColor: '#020302',
            bgGlowColor: '#101510',
            rockEnabled: true,
            rockHeight: -0.56,
            rockRoughness: 1.15,
            mossIntensity: 1.15,
            loopDuration: 15.0,
            camZoom: 1.0,
            camPanX: 0.0,
            camPanY: 0.0
        },
        blobs: [
            // 0: Left main dual-layer sphere
            { name: 'Левая сфера (Основа)', x: -0.34, y: -0.20, z: 0.02, radius: 0.255, type: 0, greenRatio: 0.86, animAmp: 0.65, animPhase: 0.10 },
            // 1: Hyperbolic Catenary Bridge Waist (greenRatio = 0.52 creates clear glass bridge center with lime edge caustics)
            { name: 'Тонкая перетяжка (Мост)', x: 0.02, y: -0.17, z: 0.01, radius: 0.044, type: 0, greenRatio: 0.52, animAmp: 0.55, animPhase: 0.42 },
            // 2: Right upper-middle dual lobe (Bridge anchor & green arch)
            { name: 'Правый верхний узел', x: 0.48, y: 0.00, z: 0.0, radius: 0.245, type: 0, greenRatio: 0.80, animAmp: 0.70, animPhase: 0.65 },
            // 3: Right lower dual lobe
            { name: 'Правый нижний узел', x: 0.48, y: -0.23, z: 0.02, radius: 0.225, type: 0, greenRatio: 0.80, animAmp: 0.70, animPhase: 0.88 },
            // 4: Right upper transparent glass dome (creates the thick clear glass cap at top of right cluster)
            { name: 'Правый купол стекла', x: 0.48, y: 0.11, z: 0.02, radius: 0.265, type: 1, greenRatio: 0.0, animAmp: 0.55, animPhase: 0.60 },
            // 5: Top-right large dark glass sphere filled with sparkling micro-bubbles
            { name: 'Верхняя угловая сфера', x: 0.46, y: 0.90, z: -0.02, radius: 0.390, type: 1, greenRatio: 0.0, animAmp: 0.35, animPhase: 0.22 },
            // 6: Bottom-right foreground glass dome over the rocks
            { name: 'Нижняя сфера (Передний план)', x: 0.41, y: -0.92, z: 0.22, radius: 0.355, type: 1, greenRatio: 0.0, animAmp: 0.32, animPhase: 0.55 },
            // 7: Floating clear glass droplet (Center-upper hero droplet)
            { name: 'Капля 1 (Центр)', x: 0.08, y: 0.00, z: 0.10, radius: 0.048, type: 1, greenRatio: 0.0, animAmp: 1.05, animPhase: 0.15 },
            // 8: Floating clear glass droplet (Upper-right small)
            { name: 'Капля 2 (Малая сверху)', x: 0.16, y: 0.16, z: -0.04, radius: 0.028, type: 1, greenRatio: 0.0, animAmp: 1.15, animPhase: 0.72 },
            // 9: Floating clear glass droplet (Below left neck)
            { name: 'Капля 3 (Нижняя малая)', x: -0.12, y: -0.39, z: 0.12, radius: 0.023, type: 1, greenRatio: 0.0, animAmp: 1.10, animPhase: 0.37 },
            // 10: Left sphere — outer-left circular glass window
            { name: 'Окно-линза (Левое внешнее)', x: -0.47, y: -0.21, z: 0.14, radius: 0.118, type: 3, greenRatio: 0.0, animAmp: 0.70, animPhase: 0.12 },
            // 11: Left sphere — inner-right circular glass window (at bridge root)
            { name: 'Окно-линза (У моста слева)', x: -0.19, y: -0.19, z: 0.14, radius: 0.104, type: 3, greenRatio: 0.0, animAmp: 0.65, animPhase: 0.10 },
            // 12: Right cluster — lower-left dark chamber (right of bridge)
            { name: 'Окно-линза (У моста справа)', x: 0.22, y: -0.18, z: 0.14, radius: 0.088, type: 3, greenRatio: 0.0, animAmp: 0.65, animPhase: 0.68 },
            // 13: Right cluster — central oval hole
            { name: 'Окно-линза (Правый центр)', x: 0.41, y: -0.16, z: 0.14, radius: 0.056, type: 3, greenRatio: 0.0, animAmp: 0.70, animPhase: 0.65 },
            // 14: Right cluster — upper-right large dark chamber
            { name: 'Окно-линза (Правое верхнее)', x: 0.50, y: 0.01, z: 0.14, radius: 0.106, type: 3, greenRatio: 0.0, animAmp: 0.68, animPhase: 0.62 },
            // 15: Right cluster — lower small hole
            { name: 'Окно-линза (Правое нижнее)', x: 0.51, y: -0.34, z: 0.14, radius: 0.062, type: 3, greenRatio: 0.0, animAmp: 0.70, animPhase: 0.72 }
        ],
        textLayers: [
            {
                id: 't1',
                text: 'BIO—SYNTHESIS',
                subtext: 'ORGANICA // VOL. 04',
                x: 0.08,
                y: 0.10,
                fontSize: 54,
                subFontSize: 18,
                fontFamily: 'Syne, Inter, sans-serif',
                color: '#ffffff',
                opacity: 0.0, // Hidden by default on pure reference, 1-click toggleable!
                behindGlass: false,
                align: 'left'
            }
        ]
    },

    vertical_symbiosis: {
        id: 'vertical_symbiosis',
        name: 'Вертикальный симбиоз (Reels / Stories)',
        description: 'Вертикальная цепочка перетекающих био-капсул с крупной типографикой за стеклом.',
        aspect: '9:16',
        params: {
            smoothGlass: 0.28,
            smoothGreen: 0.25,
            smoothCavity: 0.09,
            glassIOR: 1.52,
            glassDispersion: 0.45,
            fresnelIntensity: 1.35,
            bubbleDensity: 1.15,
            coreDetail: 1.0,
            greenColor: '#a8ff00',
            greenDeepColor: '#102400',
            bgTopColor: '#030403',
            bgGlowColor: '#131d12',
            rockEnabled: true,
            rockHeight: -0.66,
            rockRoughness: 0.95,
            mossIntensity: 1.15,
            loopDuration: 15.0,
            camZoom: 1.0,
            camPanX: 0.0,
            camPanY: 0.0
        },
        blobs: [
            { name: 'Верхнее ядро', x: 0.04, y: 0.42, z: 0.0, radius: 0.27, type: 0, greenRatio: 0.80, animAmp: 0.9, animPhase: 0.1 },
            { name: 'Вертикальный мост', x: -0.02, y: 0.08, z: 0.01, radius: 0.056, type: 0, greenRatio: 0.58, animAmp: 0.75, animPhase: 0.45 },
            { name: 'Нижнее ядро', x: 0.02, y: -0.26, z: 0.0, radius: 0.29, type: 0, greenRatio: 0.83, animAmp: 0.85, animPhase: 0.75 },
            { name: 'Левый спутник', x: -0.32, y: 0.18, z: 0.08, radius: 0.14, type: 0, greenRatio: 0.65, animAmp: 1.0, animPhase: 0.3 },
            { name: 'Капля 1', x: 0.26, y: 0.15, z: 0.12, radius: 0.06, type: 1, greenRatio: 0.0, animAmp: 1.3, animPhase: 0.6 },
            { name: 'Капля 2', x: -0.22, y: -0.08, z: 0.14, radius: 0.045, type: 1, greenRatio: 0.0, animAmp: 1.4, animPhase: 0.2 },
            { name: 'Черная сфера верхняя', x: 0.08, y: 0.44, z: 0.12, radius: 0.12, type: 3, greenRatio: 0.0, animAmp: 1.2, animPhase: 0.5 },
            { name: 'Черная сфера нижняя', x: -0.05, y: -0.24, z: 0.13, radius: 0.13, type: 3, greenRatio: 0.0, animAmp: 1.1, animPhase: 0.85 }
        ],
        textLayers: [
            {
                id: 't1',
                text: 'MORPH\nLABS',
                subtext: 'GENERATIVE BIO-DESIGN // 2026',
                x: 0.50,
                y: 0.18,
                fontSize: 96,
                subFontSize: 20,
                fontFamily: 'Syne, Inter, sans-serif',
                color: '#f0fdf4',
                opacity: 0.92,
                behindGlass: true,
                align: 'center'
            }
        ]
    },

    editorial_post: {
        id: 'editorial_post',
        name: 'Дизайн-пост 4:5 (Диагональный мост)',
        description: 'Асимметричная композиция для ленты (4:5 или 9:16) с чистым пространством под заголовок поста.',
        aspect: '4:5',
        params: {
            smoothGlass: 0.24,
            smoothGreen: 0.21,
            smoothCavity: 0.08,
            glassIOR: 1.49,
            glassDispersion: 0.40,
            fresnelIntensity: 1.30,
            bubbleDensity: 0.95,
            coreDetail: 1.0,
            greenColor: '#9be600',
            greenDeepColor: '#152800',
            bgTopColor: '#040504',
            bgGlowColor: '#151c14',
            rockEnabled: true,
            rockHeight: -0.62,
            rockRoughness: 1.0,
            mossIntensity: 0.95,
            loopDuration: 15.0,
            camZoom: 0.95,
            camPanX: 0.0,
            camPanY: 0.0
        },
        blobs: [
            { name: 'Левый нижний блоб', x: -0.35, y: -0.22, z: 0.02, radius: 0.28, type: 0, greenRatio: 0.82, animAmp: 0.8, animPhase: 0.15 },
            { name: 'Диагональная перетяжка', x: -0.01, y: -0.03, z: 0.0, radius: 0.055, type: 0, greenRatio: 0.58, animAmp: 0.75, animPhase: 0.45 },
            { name: 'Правый верхний блоб', x: 0.34, y: 0.16, z: -0.02, radius: 0.30, type: 0, greenRatio: 0.84, animAmp: 0.85, animPhase: 0.75 },
            { name: 'Правый малый узел', x: 0.42, y: -0.18, z: 0.06, radius: 0.18, type: 0, greenRatio: 0.75, animAmp: 0.9, animPhase: 0.30 },
            { name: 'Капля стекло 1', x: -0.16, y: 0.18, z: 0.12, radius: 0.065, type: 1, greenRatio: 0.0, animAmp: 1.2, animPhase: 0.60 },
            { name: 'Капля стекло 2', x: 0.12, y: -0.28, z: 0.14, radius: 0.042, type: 1, greenRatio: 0.0, animAmp: 1.3, animPhase: 0.90 },
            { name: 'Черная сфера левая', x: -0.38, y: -0.20, z: 0.12, radius: 0.125, type: 3, greenRatio: 0.0, animAmp: 1.1, animPhase: 0.25 },
            { name: 'Черная сфера правая', x: 0.32, y: 0.18, z: 0.12, radius: 0.135, type: 3, greenRatio: 0.0, animAmp: 1.15, animPhase: 0.65 }
        ],
        textLayers: [
            {
                id: 't1',
                text: 'LIQUID\nMATTER',
                subtext: 'MOTION SYSTEM // 01',
                x: 0.08,
                y: 0.12,
                fontSize: 72,
                subFontSize: 18,
                fontFamily: 'Syne, Inter, sans-serif',
                color: '#ffffff',
                opacity: 0.95,
                behindGlass: false,
                align: 'left'
            }
        ]
    },

    mitosis_ring: {
        id: 'mitosis_ring',
        name: 'Клеточное деление (Тройной узел)',
        description: 'Три крупных био-узла, образующих живую мембрану с внутренними вакуолями и мелкими сферами.',
        aspect: '9:16',
        params: {
            smoothGlass: 0.27,
            smoothGreen: 0.24,
            smoothCavity: 0.09,
            glassIOR: 1.50,
            glassDispersion: 0.38,
            fresnelIntensity: 1.28,
            bubbleDensity: 1.1,
            coreDetail: 1.0,
            greenColor: '#9be600',
            greenDeepColor: '#142600',
            bgTopColor: '#020302',
            bgGlowColor: '#121912',
            rockEnabled: true,
            rockHeight: -0.60,
            rockRoughness: 1.05,
            mossIntensity: 1.05,
            loopDuration: 15.0,
            camZoom: 1.0,
            camPanX: 0.0,
            camPanY: 0.0
        },
        blobs: [
            { name: 'Левый узел', x: -0.30, y: 0.08, z: 0.0, radius: 0.25, type: 0, greenRatio: 0.81, animAmp: 0.9, animPhase: 0.0 },
            { name: 'Правый узел', x: 0.30, y: 0.12, z: 0.0, radius: 0.26, type: 0, greenRatio: 0.81, animAmp: 0.9, animPhase: 0.33 },
            { name: 'Нижний центральный узел', x: 0.02, y: -0.26, z: 0.04, radius: 0.25, type: 0, greenRatio: 0.80, animAmp: 0.9, animPhase: 0.66 },
            { name: 'Верхний купол', x: -0.35, y: 0.82, z: -0.1, radius: 0.34, type: 0, greenRatio: 0.55, animAmp: 0.4, animPhase: 0.2 },
            { name: 'Центральная капля', x: 0.0, y: 0.02, z: 0.14, radius: 0.062, type: 1, greenRatio: 0.0, animAmp: 1.2, animPhase: 0.5 },
            { name: 'Малая капля', x: 0.04, y: 0.32, z: 0.08, radius: 0.036, type: 1, greenRatio: 0.0, animAmp: 1.4, animPhase: 0.8 },
            { name: 'Полость 1', x: -0.32, y: 0.08, z: 0.16, radius: 0.13, type: 3, greenRatio: 0.0, animAmp: 1.15, animPhase: 0.15 },
            { name: 'Полость 2', x: 0.32, y: 0.12, z: 0.16, radius: 0.13, type: 3, greenRatio: 0.0, animAmp: 1.15, animPhase: 0.55 },
            { name: 'Полость 3', x: 0.02, y: -0.28, z: 0.18, radius: 0.13, type: 3, greenRatio: 0.0, animAmp: 1.15, animPhase: 0.85 }
        ],
        textLayers: [
            {
                id: 't1',
                text: 'CELLULAR',
                subtext: 'ORGANIC MOTION SERIES',
                x: 0.50,
                y: 0.10,
                fontSize: 58,
                subFontSize: 16,
                fontFamily: 'Syne, Inter, sans-serif',
                color: '#ffffff',
                opacity: 0.0,
                behindGlass: false,
                align: 'center'
            }
        ]
    }
};

// Procedural generator for creating brand-new blob arrangements in the same visual style
window.BlobStudio.generateRandomComposition = function(style = 'bridge') {
    const blobs = [];
    const rand = (min, max) => min + Math.random() * (max - min);

    if (style === 'bridge') {
        // Two main clusters connected by a stretched bridge + corner domes + droplets + cavities
        const angle = rand(-0.45, 0.45);
        const dist = rand(0.32, 0.38);
        const lx = -Math.cos(angle) * dist;
        const ly = -Math.sin(angle) * dist - 0.04;
        const rx = Math.cos(angle) * dist;
        const ry = Math.sin(angle) * dist - 0.02;

        blobs.push({
            name: 'Кластер А',
            x: Number(lx.toFixed(2)),
            y: Number(ly.toFixed(2)),
            z: 0.0,
            radius: Number(rand(0.24, 0.29).toFixed(2)),
            type: 0,
            greenRatio: Number(rand(0.76, 0.84).toFixed(2)),
            animAmp: 0.85,
            animPhase: Number(rand(0, 1).toFixed(2))
        });

        blobs.push({
            name: 'Тонкая перетяжка (Мост)',
            x: Number(((lx + rx) * 0.5 + rand(-0.03, 0.03)).toFixed(2)),
            y: Number(((ly + ry) * 0.5 + rand(-0.03, 0.03)).toFixed(2)),
            z: 0.0,
            radius: Number(rand(0.048, 0.065).toFixed(3)),
            type: 0,
            greenRatio: 0.58,
            animAmp: 0.70,
            animPhase: Number(rand(0, 1).toFixed(2))
        });

        blobs.push({
            name: 'Кластер Б (Верх)',
            x: Number(rx.toFixed(2)),
            y: Number((ry + 0.11).toFixed(2)),
            z: 0.0,
            radius: Number(rand(0.24, 0.28).toFixed(2)),
            type: 0,
            greenRatio: Number(rand(0.78, 0.84).toFixed(2)),
            animAmp: 0.85,
            animPhase: Number(rand(0, 1).toFixed(2))
        });

        blobs.push({
            name: 'Кластер Б (Низ)',
            x: Number((rx + rand(-0.06, 0.06)).toFixed(2)),
            y: Number((ry - 0.16).toFixed(2)),
            z: 0.04,
            radius: Number(rand(0.21, 0.26).toFixed(2)),
            type: 0,
            greenRatio: Number(rand(0.75, 0.82).toFixed(2)),
            animAmp: 0.80,
            animPhase: Number(rand(0, 1).toFixed(2))
        });

        // Corner accent dome
        const cornerSide = Math.random() > 0.5 ? 1 : -1;
        blobs.push({
            name: 'Угловой купол',
            x: Number((cornerSide * rand(0.32, 0.42)).toFixed(2)),
            y: Number(rand(0.72, 0.84).toFixed(2)),
            z: -0.08,
            radius: Number(rand(0.32, 0.38).toFixed(2)),
            type: 0,
            greenRatio: 0.55,
            animAmp: 0.45,
            animPhase: Number(rand(0, 1).toFixed(2))
        });

        // 3 Floating glass droplets
        for (let i = 0; i < 3; i++) {
            blobs.push({
                name: `Капля стекла ${i + 1}`,
                x: Number(rand(-0.26, 0.26).toFixed(2)),
                y: Number(rand(-0.24, 0.32).toFixed(2)),
                z: Number(rand(0.06, 0.16).toFixed(2)),
                radius: Number(rand(0.028, 0.065).toFixed(3)),
                type: 1,
                greenRatio: 0.0,
                animAmp: Number(rand(1.1, 1.4).toFixed(2)),
                animPhase: Number(rand(0, 1).toFixed(2))
            });
        }

        // 3 Glossy Black Internal Vacuoles inside the main lobes
        blobs.push({
            name: 'Черная сфера А',
            x: Number((lx + rand(-0.10, 0.06)).toFixed(2)),
            y: Number((ly + rand(-0.04, 0.04)).toFixed(2)),
            z: 0.11,
            radius: Number(rand(0.105, 0.130).toFixed(3)),
            type: 3,
            greenRatio: 0.0,
            animAmp: 1.15,
            animPhase: Number(rand(0, 1).toFixed(2))
        });
        blobs.push({
            name: 'Черная сфера Б1',
            x: Number((rx + rand(-0.06, 0.08)).toFixed(2)),
            y: Number((ry + 0.06).toFixed(2)),
            z: 0.12,
            radius: Number(rand(0.10, 0.125).toFixed(3)),
            type: 3,
            greenRatio: 0.0,
            animAmp: 1.15,
            animPhase: Number(rand(0, 1).toFixed(2))
        });
        blobs.push({
            name: 'Черная сфера Б2',
            x: Number((rx + rand(-0.06, 0.08)).toFixed(2)),
            y: Number((ry - 0.14).toFixed(2)),
            z: 0.12,
            radius: Number(rand(0.095, 0.120).toFixed(3)),
            type: 3,
            greenRatio: 0.0,
            animAmp: 1.15,
            animPhase: Number(rand(0, 1).toFixed(2))
        });
    }

    return blobs;
}
