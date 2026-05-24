const DEFAULT_WORDS = [
  { id: 1,  word: "KATZE",   hint: "Haustier, das miaut",                  category: "Tiere",    difficulty: "easy",   emoji: "🐱" },
  { id: 2,  word: "HUND",    hint: "Bester Freund des Menschen",            category: "Tiere",    difficulty: "easy",   emoji: "🐶" },
  { id: 3,  word: "SCHULE",  hint: "Ort zum Lernen",                        category: "Orte",     difficulty: "medium", emoji: "🏫" },
  { id: 4,  word: "APFEL",   hint: "Rotes oder grünes Obst",                category: "Essen",    difficulty: "easy",   emoji: "🍎" },
  { id: 5,  word: "FAHRRAD", hint: "Fortbewegungsmittel mit zwei Rädern",   category: "Verkehr",  difficulty: "medium", emoji: "🚲" },
  { id: 6,  word: "SOMMER",  hint: "Wärmste Jahreszeit",                    category: "Natur",    difficulty: "easy",   emoji: "☀️" },
  { id: 7,  word: "WINTER",  hint: "Kälteste Jahreszeit",                   category: "Natur",    difficulty: "easy",   emoji: "❄️" },
  { id: 8,  word: "BLUME",   hint: "Wächst im Garten",                      category: "Natur",    difficulty: "easy",   emoji: "🌸" },
  { id: 9,  word: "BUTTER",  hint: "Kommt von der Kuh, aufs Brot",          category: "Essen",    difficulty: "medium", emoji: "🧈" },
  { id: 10, word: "DRACHEN", hint: "Fliegt am Himmel bei Wind",             category: "Spielzeug",difficulty: "medium", emoji: "🪁" }
];

function loadWords() {
  const stored = localStorage.getItem('racingWords');
  if (!stored) {
    localStorage.setItem('racingWords', JSON.stringify(DEFAULT_WORDS));
    return DEFAULT_WORDS;
  }
  return JSON.parse(stored);
}

function saveWords(words) {
  localStorage.setItem('racingWords', JSON.stringify(words));
}

function getNextId(words) {
  if (words.length === 0) return 1;
  return Math.max(...words.map(w => w.id)) + 1;
}
