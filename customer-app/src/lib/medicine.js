// Infer category from medicine name/generic name
export function inferCategory(medicine) {
  const s = `${medicine.name} ${medicine.generic_name}`.toLowerCase();
  if (/amoxicillin|azithromycin|ciprofloxacin|antibiotic|ampicillin|doxycycline/.test(s)) return 'Antibiotics';
  if (/paracetamol|ibuprofen|aspirin|diclofenac|naproxen|pain|analgesic/.test(s)) return 'Pain Relief';
  if (/vitamin|supplement|calcium|iron|zinc|b12|omega|folic/.test(s)) return 'Vitamins';
  if (/loratadine|cetirizine|antihistamine|fexofenadine|allergy/.test(s)) return 'Allergy';
  if (/metformin|insulin|glipizide|diabetes|gluco/.test(s)) return 'Diabetes';
  if (/omeprazole|pantoprazole|ranitidine|esomeprazole|antacid|digestive/.test(s)) return 'Digestive';
  if (/amlodipine|atenolol|lisinopril|metoprolol|heart|blood pressure|cardiac/.test(s)) return 'Heart';
  return 'General';
}

export const CATEGORIES = ['All', 'Pain Relief', 'Antibiotics', 'Vitamins', 'Allergy', 'Digestive', 'Heart', 'Diabetes', 'General'];

export const CATEGORY_ICONS = {
  'All':        '💊',
  'Pain Relief':'🩹',
  'Antibiotics':'🦠',
  'Vitamins':   '🌿',
  'Allergy':    '🌸',
  'Digestive':  '🫁',
  'Heart':      '❤️',
  'Diabetes':   '🩸',
  'General':    '🔬',
};

// Simulated medicine details for rich modal display
export function getMedicineDetails(medicine) {
  const cat = inferCategory(medicine);
  const details = {
    'Pain Relief': {
      composition: `${medicine.generic_name} USP`,
      usage: 'Take 1–2 tablets every 4–6 hours as needed. Do not exceed 8 tablets in 24 hours.',
      sideEffects: 'Nausea, stomach upset, dizziness. Rare: allergic reactions, liver issues with overdose.',
      precautions: 'Avoid alcohol. Consult doctor if you have liver disease. Not for children under 12 without medical advice.',
      manufacturer: 'Sun Pharma Ltd.',
    },
    'Antibiotics': {
      composition: `${medicine.generic_name} 500mg`,
      usage: 'Take as prescribed by your doctor. Complete the full course even if you feel better.',
      sideEffects: 'Diarrhea, nausea, vomiting, skin rash. May cause yeast infections.',
      precautions: 'Inform doctor of penicillin allergy. Do not use without prescription.',
      manufacturer: 'Cipla Ltd.',
    },
    'Vitamins': {
      composition: `${medicine.generic_name} — Natural source`,
      usage: 'Take 1 tablet/capsule daily with food or as directed by your physician.',
      sideEffects: 'Generally well tolerated. Excess intake may cause hypervitaminosis.',
      precautions: 'Keep out of reach of children. Store in a cool, dry place.',
      manufacturer: 'Abbott Healthcare.',
    },
    'Digestive': {
      composition: `${medicine.generic_name} 20mg gastro-resistant`,
      usage: 'Take 1 capsule 30–60 minutes before meals. Swallow whole, do not chew.',
      sideEffects: 'Headache, diarrhea, nausea. Long-term use: vitamin B12 deficiency risk.',
      precautions: 'Not suitable for children under 1 year. Inform doctor if taking other medication.',
      manufacturer: 'Dr. Reddys Laboratories.',
    },
    'default': {
      composition: `${medicine.generic_name}`,
      usage: 'Use as directed by your physician or pharmacist.',
      sideEffects: 'May vary. Consult your doctor if you experience any adverse effects.',
      precautions: 'Keep out of reach of children. Store as per label instructions.',
      manufacturer: 'Lupin Ltd.',
    },
  };
  return details[cat] ?? details.default;
}

// Simulated ratings (deterministic from id)
export function getMedicineRating(medicine) {
  const seed = medicine.id.charCodeAt(medicine.id.length - 1);
  const rating = (3.8 + (seed % 12) * 0.1).toFixed(1);
  const reviews = 50 + (seed % 200);
  return { rating, reviews };
}
