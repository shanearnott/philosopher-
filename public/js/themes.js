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
};

const patterns = Object.fromEntries(
  Object.entries(THEMES).map(([k, t]) => [k, new RegExp(`\\b(${t.words.join("|")})\\b`, "i")]),
);

export function tagThemes(text) {
  return Object.keys(THEMES).filter((k) => patterns[k].test(text));
}
