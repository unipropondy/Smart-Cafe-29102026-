const fs = require('fs');
const path = require('path');

function main() {
  const baseDir = path.join(__dirname, '../assets/avatars');
  const categories = ['male', 'female', 'chef', 'waiter', 'manager', 'cashier', 'bartender', 'marvel'];

  // Replicate options configuration logic from generate_avatars.js to map correct tags & categories
  const getAvatarFeaturesAndCategories = (cat, i) => {
    const features = [];
    const cats = [];
    
    // Primary Category
    if (cat === 'male') {
      cats.push('Male');
      const top = ['shortWaved', 'shortFlat', 'shortRound', 'theCaesar', 'theCaesarAndSidePart', 'shavedSides', 'dreads01'][i % 7];
      features.push('hair', 'short hair', top.toLowerCase());
      
      const acc = i % 4 === 0 ? ['prescription01', 'prescription02', 'round', 'sunglasses'][i % 4] : null;
      if (acc) {
        features.push('glasses', 'spectacles', acc.toLowerCase());
        if (acc === 'sunglasses') features.push('shades');
      }
      
      const facial = i % 3 === 0 ? ['beardLight', 'beardMajestic', 'beardMedium', 'moustacheFancy', 'moustacheMagnum'][i % 5] : null;
      if (facial) {
        features.push('beard', 'mustache', 'facial hair', facial.toLowerCase());
      }
      
      const cloth = ['blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'shirtCrewNeck', 'shirtVNeck'][i % 7];
      features.push('dress', 'clothing', cloth.toLowerCase());

      // Map to secondary display categories
      if (cloth === 'graphicShirt' || cloth === 'hoodie') {
        cats.push('Modern Casual');
      }
      if (cloth === 'blazerAndShirt' || cloth === 'blazerAndSweater') {
        cats.push('Business Professional', 'Formal');
      }
      if (cloth === 'collarAndSweater' || cloth === 'shirtCrewNeck') {
        cats.push('Office Staff');
      }
    } 
    
    else if (cat === 'female') {
      cats.push('Female');
      const top = ['longButNotTooLong', 'bob', 'bun', 'curly', 'curvy', 'dreads', 'frida', 'fro', 'froBand', 'miaWallace', 'straight01', 'straight02'][i % 12];
      features.push('hair', 'long hair', top.toLowerCase());
      if (['bob', 'bun', 'curly', 'dreads', 'fro'].includes(top)) {
        features.push(top);
      }
      
      const acc = i % 5 === 0 ? ['prescription01', 'prescription02', 'round', 'sunglasses'][i % 4] : null;
      if (acc) {
        features.push('glasses', 'spectacles', acc.toLowerCase());
      }
      
      const cloth = ['blazerAndShirt', 'blazerAndSweater', 'collarAndSweater', 'graphicShirt', 'hoodie', 'shirtScoopNeck', 'shirtVNeck'][i % 7];
      features.push('dress', 'clothing', cloth.toLowerCase());

      // Map to secondary display categories
      if (cloth === 'graphicShirt' || cloth === 'hoodie') {
        cats.push('Modern Casual');
      }
      if (cloth === 'blazerAndShirt' || cloth === 'blazerAndSweater') {
        cats.push('Business Professional', 'Formal');
      }
      if (cloth === 'collarAndSweater' || cloth === 'shirtScoopNeck') {
        cats.push('Office Staff');
      }
      if (i % 3 === 0) {
        cats.push('Receptionist');
      }
    }
    
    else if (cat === 'chef') {
      cats.push('Chef');
      features.push('chef hat', 'cook', 'kitchen', 'apron', 'white', 'dress', 'hat');
    }
    
    else if (cat === 'waiter') {
      cats.push('Waiter');
      const top = ['shortWaved', 'bob', 'bun'][i % 3];
      features.push('hair', top.toLowerCase());
      features.push('apron', 'neat', 'waiter', 'server', 'dress');
      if (i % 2 === 0) {
        cats.push('Modern Casual');
      }
    }
    
    else if (cat === 'manager') {
      cats.push('Manager', 'Business Professional', 'Formal', 'Office Staff');
      const top = ['shortFlat', 'straight02', 'bun'][i % 3];
      features.push('hair', top.toLowerCase());
      if (i % 3 === 0) features.push('glasses');
      features.push('suit', 'tie', 'blazer', 'professional', 'dress');
    }
    
    else if (cat === 'cashier') {
      cats.push('Cashier', 'Office Staff');
      const top = ['theCaesar', 'bob', 'curly'][i % 3];
      features.push('hair', top.toLowerCase());
      features.push('glasses', 'headset', 'counter', 'dress');
      if (i % 2 === 0) {
        cats.push('Receptionist');
      }
    }
    
    else if (cat === 'bartender') {
      cats.push('Bartender');
      const top = ['shaggy', 'longButNotTooLong', 'dreads'][i % 3];
      features.push('hair', top.toLowerCase());
      features.push('beard', 'mustache', 'facial hair');
      features.push('apron', 'bar', 'dress');
    }
    
    else if (cat === 'marvel') {
      cats.push('Marvel');
      const heroesList = ['iron man', 'hulk', 'spider-man', 'captain america', 'thor', 'black widow', 'doctor strange', 'wolverine'];
      const hero = heroesList[i % heroesList.length];
      features.push('marvel', 'superhero', 'hero', hero, 'avengers');
      if (hero === 'iron man' || hero === 'spider-man') {
        features.push('robot', 'mask');
      }
      if (hero === 'thor' || hero === 'wolverine' || hero === 'doctor strange') {
        features.push('beard', 'facial hair');
      }
    }

    features.push('smile', 'smiling');
    return { features, cats };
  };

  const tagMap = {
    male: ["male", "man", "boy", "gentleman"],
    female: ["female", "woman", "girl", "lady"],
    chef: ["chef", "cook", "staff"],
    waiter: ["waiter", "waitress", "server", "staff"],
    manager: ["manager", "supervisor", "admin"],
    cashier: ["cashier", "clerk", "staff"],
    bartender: ["bartender", "barman", "staff"],
    marvel: ["marvel", "superhero", "hero", "avengers"]
  };

  const categoryNameMap = {
    male: ["Male"],
    female: ["Female"],
    chef: ["Chef"],
    waiter: ["Waiter"],
    manager: ["Manager"],
    cashier: ["Cashier"],
    bartender: ["Bartender"],
    marvel: ["Marvel"]
  };

  let requireLines = [];
  let avatarItems = [];

  categories.forEach(cat => {
    const catDir = path.join(baseDir, cat);
    if (!fs.existsSync(catDir)) return;

    const files = fs.readdirSync(catDir).filter(f => f.endsWith('.png')).sort();
    
    files.forEach((file, index) => {
      const nameWithoutExt = path.basename(file, '.png');
      
      // Store static require path
      requireLines.push(`  "${nameWithoutExt}": require("../assets/avatars/${cat}/${file}"),`);

      // Index is base 0 from readdirSync, but filenames are base 1.
      // E.g. male_001.png is index 0. So we use index + 1 for features matching generator.
      const itemNum = index + 1;
      const { features, cats } = getAvatarFeaturesAndCategories(cat, itemNum);
      const combinedTags = [...tagMap[cat], ...features];

      avatarItems.push({
        id: nameWithoutExt,
        url: `local:${nameWithoutExt}`,
        categories: cats,
        tags: Array.from(new Set(combinedTags.map(t => t.toLowerCase())))
      });
    });
  });

  const content = `// This file is auto-generated. Do not edit manually.
export interface AvatarItem {
  id: string;
  url: string;
  categories: string[];
  tags: string[];
}

export const LOCAL_AVATAR_MAP: Record<string, any> = {
${requireLines.join('\n')}
};

export function getAvatarSource(url: string | null) {
  if (!url) return null;
  if (url.startsWith("local:")) {
    const key = url.replace("local:", "");
    return LOCAL_AVATAR_MAP[key] || require("../assets/avatars/default.png");
  }
  return { uri: url };
}

export const AVATARS: AvatarItem[] = ${JSON.stringify(avatarItems, null, 2)};
`;

  fs.writeFileSync(path.join(__dirname, '../constants/avatars.ts'), content, 'utf8');
  console.log('Successfully generated avatars.ts constant with 500 static require paths and smart tags/categories!');
}

main();
