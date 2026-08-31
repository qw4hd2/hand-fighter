// Playable roster. speed/power are multipliers, hp is the health pool.
// Visual fields: skin, hair+hairStyle, pants, glove, optional top (vest),
// build scales the whole body.
export const CHARACTERS = [
  {
    id: 'blaze', name: 'Blaze',
    color: '#ff5533', accent: '#ffd166',
    skin: '#e8ac7e', hair: '#2b2020', hairStyle: 'spiky',
    pants: '#c03018', glove: '#d8262a', top: null, build: 1.0,
    speed: 1.12, power: 1.0, hp: 100,
    desc: 'Balanced striker',
  },
  {
    id: 'frost', name: 'Frost',
    color: '#3fb8f5', accent: '#e0f7ff',
    skin: '#f0c9a2', hair: '#e8e8f0', hairStyle: 'buzz',
    pants: '#2277b8', glove: '#1e5f96', top: '#2d8fd0', build: 1.06,
    speed: 0.95, power: 0.9, hp: 120,
    desc: 'Tanky defender',
  },
  {
    id: 'volt', name: 'Volt',
    color: '#ffd91f', accent: '#8c6bff',
    skin: '#c98d5a', hair: '#f5e33d', hairStyle: 'mohawk',
    pants: '#b89b10', glove: '#e0b90f', top: null, build: 0.94,
    speed: 1.35, power: 0.82, hp: 88,
    desc: 'Lightning fast',
  },
  {
    id: 'onyx', name: 'Onyx',
    color: '#9b6bff', accent: '#ffd166',
    skin: '#7a4a28', hair: '#151018', hairStyle: 'bald',
    pants: '#5b3aa8', glove: '#3a2470', top: null, build: 1.14,
    speed: 0.88, power: 1.28, hp: 96,
    desc: 'Heavy hitter',
  },
  {
    id: 'kira', name: 'Kira',
    color: '#ff5fa2', accent: '#2de1c2',
    skin: '#f2c9a0', hair: '#7a2f1d', hairStyle: 'ponytail',
    pants: '#c2308a', glove: '#8f2368', top: '#e8447f', build: 0.9,
    speed: 1.25, power: 0.88, hp: 92,
    desc: 'Agile duelist',
  },
  {
    id: 'sensei', name: 'Sensei',
    color: '#d9d2c5', accent: '#8c2f22',
    skin: '#d8a77a', hair: '#cfcabe', hairStyle: 'topknot', beard: true,
    pants: '#b8b09c', glove: '#6b6152', top: null, build: 1.02,
    speed: 0.98, power: 1.15, hp: 108,
    desc: 'Old master',
  },
];
