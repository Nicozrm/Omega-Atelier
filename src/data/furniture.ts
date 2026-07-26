import type { FurnitureCatalogEntry } from '@/types'

/**
 * Furniture catalog — representative selection (extend freely).
 * Sizes in cm: [width, depth]. Height is not needed for 2D top-down editor.
 */
export const FURNITURE: FurnitureCatalogEntry[] = [
  // Seating
  { id: 'sofa-2seat',     name: 'Sofa 2-Sitzer',       category: 'sofa',    size: [180, 90] },
  { id: 'sofa-3seat',     name: 'Sofa 3-Sitzer',       category: 'sofa',    size: [220, 95] },
  { id: 'sofa-corner',    name: 'Ecksofa',             category: 'sofa',    size: [280, 220] },
  { id: 'armchair',       name: 'Sessel',              category: 'sofa',    size: [90, 90] },
  { id: 'lounge-chair',   name: 'Loungesessel',        category: 'sofa',    size: [80, 80] },
  { id: 'chair-dining',   name: 'Esszimmerstuhl',      category: 'chair',   size: [45, 50] },
  { id: 'barstool',       name: 'Barhocker',           category: 'chair',   size: [40, 40] },
  { id: 'office-chair',   name: 'Bürostuhl',           category: 'chair',   size: [65, 65] },

  // Beds
  { id: 'bed-90',         name: 'Einzelbett 90',       category: 'bed',     size: [95, 200] },
  { id: 'bed-140',        name: 'Bett 140',            category: 'bed',     size: [145, 200] },
  { id: 'bed-180',        name: 'Queen Bett 180',      category: 'bed',     size: [185, 210] },
  { id: 'bed-200',        name: 'King Bett 200',       category: 'bed',     size: [205, 215] },
  { id: 'crib',           name: 'Babybett',            category: 'bed',     size: [70, 140] },

  // Tables
  { id: 'table-dining-4', name: 'Esstisch 4 Pers.',    category: 'table',   size: [140, 80] },
  { id: 'table-dining-6', name: 'Esstisch 6 Pers.',    category: 'table',   size: [200, 90] },
  { id: 'table-dining-8', name: 'Esstisch 8 Pers.',    category: 'table',   size: [260, 100] },
  { id: 'table-coffee',   name: 'Couchtisch',          category: 'table',   size: [110, 60] },
  { id: 'table-side',     name: 'Beistelltisch',       category: 'table',   size: [45, 45] },
  { id: 'desk-160',       name: 'Schreibtisch 160',    category: 'table',   size: [160, 80] },
  { id: 'desk-180',       name: 'Schreibtisch 180',    category: 'table',   size: [180, 80] },

  // Storage
  { id: 'wardrobe-200',   name: 'Kleiderschrank 200',  category: 'storage', size: [200, 60] },
  { id: 'wardrobe-300',   name: 'Kleiderschrank 300',  category: 'storage', size: [300, 60] },
  { id: 'bookshelf',      name: 'Bücherregal',         category: 'storage', size: [120, 35] },
  { id: 'tv-sideboard',   name: 'TV-Sideboard',        category: 'storage', size: [200, 45] },
  { id: 'dresser',        name: 'Kommode',             category: 'storage', size: [110, 45] },
  { id: 'nightstand',     name: 'Nachttisch',          category: 'storage', size: [45, 40] },
  { id: 'shoe-rack',      name: 'Schuhregal',          category: 'storage', size: [90, 30] },

  // Kitchen
  { id: 'kitchen-island', name: 'Kücheninsel',         category: 'kitchen', size: [240, 90] },
  { id: 'kitchen-row',    name: 'Küchenzeile',         category: 'kitchen', size: [300, 60] },
  { id: 'fridge',         name: 'Kühlschrank',         category: 'kitchen', size: [60, 65] },
  { id: 'oven',           name: 'Ofen',                category: 'kitchen', size: [60, 60] },
  { id: 'dishwasher',     name: 'Geschirrspüler',      category: 'kitchen', size: [60, 60] },
  { id: 'sink',           name: 'Spüle',               category: 'kitchen', size: [80, 50] },

  // Bath
  { id: 'bathtub',        name: 'Badewanne',           category: 'bath',    size: [170, 75] },
  { id: 'shower',         name: 'Dusche',              category: 'bath',    size: [90, 90] },
  { id: 'toilet',         name: 'Toilette',            category: 'bath',    size: [40, 70] },
  { id: 'bidet',          name: 'Bidet',               category: 'bath',    size: [40, 60] },
  { id: 'sink-bath',      name: 'Waschbecken',         category: 'bath',    size: [60, 45] },
  { id: 'washer',         name: 'Waschmaschine',       category: 'bath',    size: [60, 60] },

  // Decor / Misc
  { id: 'rug-small',      name: 'Teppich 160×230',     category: 'decor',   size: [160, 230] },
  { id: 'rug-medium',     name: 'Teppich 200×300',     category: 'decor',   size: [200, 300] },
  { id: 'rug-large',      name: 'Teppich 250×350',     category: 'decor',   size: [250, 350] },
  { id: 'plant',          name: 'Zimmerpflanze',       category: 'decor',   size: [50, 50] },
  { id: 'piano-upright',  name: 'Klavier',             category: 'decor',   size: [150, 60] },
  { id: 'grand-piano',    name: 'Flügel',              category: 'decor',   size: [155, 200] },
  { id: 'fireplace',      name: 'Kamin',               category: 'decor',   size: [120, 40] },

  // Outdoor
  { id: 'outdoor-table',  name: 'Outdoor-Tisch',       category: 'outdoor', size: [180, 90] },
  { id: 'grill',          name: 'Grill',               category: 'outdoor', size: [130, 60] },
  { id: 'pool-small',     name: 'Pool 4×2 m',          category: 'outdoor', size: [400, 200] },
  { id: 'sunbed',         name: 'Sonnenliege',         category: 'outdoor', size: [200, 75] },

  // v18 — extended library
  { id: 'sofa-corner',     name: 'Eck-Sofa',           category: 'sofa',    size: [280, 220] },
  { id: 'sofa-2seat',      name: 'Sofa 2-Sitzer',      category: 'sofa',    size: [160, 95] },
  { id: 'armchair',        name: 'Sessel',             category: 'sofa',    size: [85, 90] },
  { id: 'table-dining-6',  name: 'Esstisch 6-Pers.',   category: 'table',   size: [180, 90] },
  { id: 'table-dining-8',  name: 'Esstisch 8-Pers.',   category: 'table',   size: [240, 100] },
  { id: 'table-side',      name: 'Beistelltisch',      category: 'table',   size: [50, 50] },
  { id: 'desk-office',     name: 'Schreibtisch',       category: 'table',   size: [160, 80] },
  { id: 'desk-corner',     name: 'Eck-Schreibtisch',   category: 'table',   size: [180, 160] },
  { id: 'chair-office',    name: 'Bürostuhl',          category: 'chair',   size: [60, 60] },
  { id: 'bookshelf',       name: 'Bücherregal',        category: 'storage', size: [80, 30] },
  { id: 'bookshelf-wide',  name: 'Bücherregal breit',  category: 'storage', size: [200, 35] },
  { id: 'tv-stand',        name: 'TV-Stand',           category: 'storage', size: [140, 40] },
  { id: 'crib',            name: 'Babybett',           category: 'bed',     size: [140, 70] },
  { id: 'bed-90',          name: 'Bett 90×200',        category: 'bed',     size: [90, 200] },
  { id: 'bed-140',         name: 'Bett 140×200',       category: 'bed',     size: [140, 200] },
  { id: 'piano-upright',   name: 'Klavier',            category: 'other',   size: [150, 60] },
  { id: 'plant-large',     name: 'Pflanze groß',       category: 'other',   size: [50, 50] },
  { id: 'plant-tall',      name: 'Zimmerpflanze',      category: 'other',   size: [40, 40] },
  { id: 'bathtub',         name: 'Badewanne',          category: 'bath',    size: [170, 80] },
  { id: 'shower',          name: 'Dusche',             category: 'bath',    size: [90, 90] },
  { id: 'toilet',          name: 'Toilette',           category: 'bath',    size: [40, 70] },
  { id: 'sink-bath',       name: 'Waschbecken',        category: 'bath',    size: [60, 50] },
  { id: 'towel-rail',      name: 'Handtuchhalter',     category: 'bath',    size: [62, 8] },
  { id: 'bath-mat',        name: 'Badematte',          category: 'bath',    size: [70, 50] },
  { id: 'towel-radiator',  name: 'Handtuchheizkörper', category: 'bath',    size: [60, 10] },
  { id: 'bath-cabinet',    name: 'Hochschrank Bad',    category: 'bath',    size: [40, 24] },
  { id: 'washing-machine', name: 'Waschmaschine',      category: 'kitchen', size: [60, 60] },
  { id: 'fridge',          name: 'Kühlschrank',        category: 'kitchen', size: [60, 65] },
  // Wall decor — hung at eye height (thin depth = against the wall)
  { id: 'wall-art',        name: 'Wandbild',           category: 'decor',   size: [90, 4] },
  { id: 'wall-art-wide',   name: 'Wandbild breit',     category: 'decor',   size: [140, 4] },
  { id: 'wall-shelf',      name: 'Wandregal beleuchtet', category: 'storage', size: [130, 24] },
  { id: 'mirror',          name: 'Spiegel',            category: 'decor',   size: [60, 4] },
  { id: 'vase-floor',      name: 'Bodenvase',          category: 'decor',   size: [30, 30] },
  // v53 — photo-faithful detail pieces for the demo clone
  { id: 'branch-lights',   name: 'Lichterzweige',      category: 'decor',   size: [32, 32] },
  { id: 'pendant-lamp',    name: 'Pendelleuchte',      category: 'decor',   size: [34, 34] },
  { id: 'gym-rings',       name: 'Gymnastikringe',     category: 'other',   size: [40, 20] },
  { id: 'wall-screen',     name: 'Beamer-Projektion',  category: 'decor',   size: [180, 4] },
  // v54 — exact Eingang (entrance) clone pieces
  { id: 'entrance-door',   name: 'Wohnungstür',        category: 'other',   size: [96, 5] },
  { id: 'shoe-bench',      name: 'Schuhbank (LED)',    category: 'storage', size: [95, 34] },
  { id: 'coat-rail',       name: 'Garderobenleiste',   category: 'storage', size: [90, 6] },
  { id: 'neon-sign',       name: 'Neon-Schild',        category: 'decor',   size: [34, 4] },
  { id: 'dome-lamp',       name: 'Tischlampe Dome',    category: 'decor',   size: [20, 20] },
  { id: 'jordan-box',      name: 'Schuhkarton',        category: 'decor',   size: [34, 20] },
  { id: 'intercom',        name: 'Türsprechanlage',    category: 'decor',   size: [12, 4] },
  { id: 'fur-rug',         name: 'Fell-Teppich',       category: 'decor',   size: [110, 85] },
  { id: 'moss-wall-art',   name: 'Mooswand (beleuchtet)', category: 'decor', size: [72, 6] },
  { id: 'ceiling-panel',   name: 'LED-Deckenpanel',    category: 'decor',   size: [42, 42] },
]
