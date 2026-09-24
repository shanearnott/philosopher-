// Themes for Themed mix, Echo and Daily Mix. A passage carries a theme when it
// uses at least one of the theme's words (whole words, case-insensitive).
// Tagging is done once at ingest and is deliberately simple and inspectable.

export const THEMES = {
  fame: { label: "Fame and recognition", words: ["fame", "famous", "praise", "praised", "glory", "reputation", "renown", "honour", "honours", "applause", "approbation", "praiseworthy", "posterity", "remembered"] },
  leadership: { label: "Leadership under pressure", words: ["prince", "princes", "ruler", "rulers", "govern", "government", "command", "commander", "general", "generals", "statesman", "king", "leader", "sovereign", "magistrate"] },
  death: { label: "Death and time", words: ["death", "die", "dies", "dying", "dead", "mortal", "mortality", "grave", "tomb", "old age", "shortness"] },
  simplicity: { label: "Simplicity", words: ["simple", "simplicity", "frugal", "frugality", "luxury", "superfluous", "few things", "wants", "content", "contented", "plain", "little"] },
  war: { label: "War and strategy", words: ["war", "wars", "army", "armies", "enemy", "enemies", "battle", "soldier", "soldiers", "victory", "strategy", "troops", "siege"] },
  others: { label: "Other people", words: ["friend", "friends", "friendship", "neighbour", "neighbours", "anger", "angry", "forgive", "kindness", "wrongdoer", "offend", "offended", "brother", "companions"] },
  control: { label: "What is in your control", words: ["opinion", "opinions", "power", "judgement", "desire", "aversion", "impressions", "appearances", "disturbed", "hindrance"] },
  duty: { label: "Work and duty", words: ["duty", "duties", "work", "labour", "business", "office", "industry", "task"] },
  // subjects the world traditions share with the philosophers
  faith: { label: "Faith and prayer", words: ["prayer", "prayers", "pray", "prayed", "praying", "worship", "worshipped", "faith", "faithful", "devotion", "devout", "God", "Lord", "Allah", "holy", "sacred", "divine", "heaven", "psalm", "sabbath", "temple"] },
  love: { label: "Love and compassion", words: ["love", "loved", "loveth", "loving", "compassion", "compassionate", "mercy", "merciful", "charity", "alms", "generous", "generosity", "orphan", "orphans", "widow", "widows", "goodwill", "loving-kindness"] },
  justice: { label: "Justice and right action", words: ["justice", "unjust", "injustice", "righteous", "righteousness", "commandment", "commandments", "statutes", "dharma", "sin", "sins", "wicked", "wickedness", "evil-doer", "judgment"] },
  soul: { label: "The self and the soul", words: ["soul", "souls", "spirit", "self", "selves", "atman", "brahman", "ego", "not-self", "immortal", "eternal", "rebirth"] },
  stillness: { label: "Stillness and the mind", words: ["meditation", "meditate", "mindful", "mindfulness", "stillness", "calm", "tranquil", "tranquillity", "tranquility", "peace", "peaceful", "quiet", "silence", "silent", "serene", "repose"] },
  suffering: { label: "Suffering and hardship", words: ["suffering", "suffer", "suffers", "suffered", "pain", "pains", "grief", "sorrow", "sorrows", "affliction", "afflicted", "misfortune", "misfortunes", "adversity", "hardship", "hardships", "dukkha"] },
};

const patterns = Object.fromEntries(
  Object.entries(THEMES).map(([k, t]) => [k, new RegExp(`\\b(${t.words.join("|")})\\b`, "i")]),
);

export function tagThemes(text) {
  return Object.keys(THEMES).filter((k) => patterns[k].test(text));
}
